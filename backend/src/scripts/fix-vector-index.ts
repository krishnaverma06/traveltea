import 'dotenv/config';
import mongoose from 'mongoose';
import {
  VECTOR_COLLECTION_NAME,
  VECTOR_INDEX_NAME,
  EMBEDDING_DIMENSIONS,
} from '../vector/types/vector.constants.js';

/**
 * Repairs the RAG layer. Two independent causes, both required:
 *
 *  1. The Atlas vector index omitted `archived` and `expiresAt`, which the
 *     retrieval service uses in its $vectorSearch pre-filter. Atlas rejects the
 *     whole query when a filtered path isn't indexed as a filter, and
 *     searchLayer swallows that into an empty result — so retrieval returned
 *     nothing while looking healthy.
 *  2. Documents written before those fields existed have no sourceType /
 *     archived / expiresAt. Mongoose defaults apply on write only, so they
 *     could never match an equality pre-filter — which is why there was no
 *     global_knowledge layer at all despite 39 seeded guides being present.
 *
 * Idempotent: safe to re-run. Pass --dry-run to preview without writing.
 *
 * Run: npm run fix:vector        (or: npm run fix:vector -- --dry-run)
 */

const DRY_RUN = process.argv.includes('--dry-run');

// Must stay in sync with vector/services/vector-retrieval.service.ts's filter
// object and with the definition printed by vector/scripts/seed-knowledge.ts.
const INDEX_DEFINITION = {
  fields: [
    { type: 'vector', path: 'embedding', numDimensions: EMBEDDING_DIMENSIONS, similarity: 'cosine' },
    { type: 'filter', path: 'category' },
    { type: 'filter', path: 'country' },
    { type: 'filter', path: 'city' },
    { type: 'filter', path: 'tags' },
    { type: 'filter', path: 'sourceType' },
    { type: 'filter', path: 'userId' },
    { type: 'filter', path: 'archived' },
    { type: 'filter', path: 'expiresAt' },
  ],
};

const REQUIRED_FILTER_PATHS = ['sourceType', 'userId', 'archived', 'expiresAt'];
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Block until the index reports status READY with every required filter path.
 *
 * Deliberately does NOT trust `queryable`: Atlas keeps serving the OLD
 * definition (queryable: true) throughout a rebuild, and `latestDefinition`
 * flips to the new one immediately — so both look healthy while queries are
 * still being rejected against the old index. READY is the only real signal.
 */
async function waitForReady(col: any, label: string): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const idx = ((await col.listSearchIndexes().toArray()) as any[]).find(
      (i) => i.name === VECTOR_INDEX_NAME,
    );
    const paths = (idx?.latestDefinition?.fields || [])
      .filter((f: any) => f.type === 'filter')
      .map((f: any) => f.path);
    const hasAll = REQUIRED_FILTER_PATHS.every((p) => paths.includes(p));
    if (idx?.status === 'READY' && hasAll) return true;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`    ...${label} status=${idx?.status} filtersApplied=${hasAll} (${elapsed}s)`);
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const col = mongoose.connection.db!.collection(VECTOR_COLLECTION_NAME);

  console.log('='.repeat(70));
  console.log(`Repairing RAG layer${DRY_RUN ? '  (DRY RUN — no writes)' : ''}`);
  console.log(`cluster db: ${mongoose.connection.db!.databaseName}   collection: ${VECTOR_COLLECTION_NAME}`);
  console.log('='.repeat(70));

  // ── Step 1: index definition ───────────────────────────────────────────────
  console.log('\n[1/3] Atlas vector index');

  const existing = (await col.listSearchIndexes().toArray()) as any[];
  const current = existing.find((i) => i.name === VECTOR_INDEX_NAME);

  if (!current) {
    console.log(`  index "${VECTOR_INDEX_NAME}" not found — creating it`);
    if (!DRY_RUN) {
      await col.createSearchIndex({
        name: VECTOR_INDEX_NAME,
        type: 'vectorSearch',
        definition: INDEX_DEFINITION,
      } as any);
    }
  } else {
    const currentPaths = (current.latestDefinition?.fields || [])
      .filter((f: any) => f.type === 'filter')
      .map((f: any) => f.path);
    const missing = REQUIRED_FILTER_PATHS.filter((p) => !currentPaths.includes(p));

    console.log(`  current filter paths: ${currentPaths.join(', ') || '(none)'}`);

    if (missing.length === 0) {
      console.log('  already has every required filter path — nothing to change');
    } else {
      console.log(`  missing: ${missing.join(', ')}`);
      if (DRY_RUN) {
        console.log('  would call updateSearchIndex with the full definition');
      } else {
        await col.updateSearchIndex(VECTOR_INDEX_NAME, INDEX_DEFINITION as any);
        console.log('  updateSearchIndex submitted — Atlas will rebuild');

        const ready = await waitForReady(col, 'rebuild');
        console.log(ready ? '  index rebuilt and queryable' : '  TIMED OUT waiting for rebuild');
        if (!ready) process.exitCode = 1;
      }
    }
  }

  // ── Step 2: backfill legacy documents ──────────────────────────────────────
  console.log('\n[2/3] Backfill documents predating the filter fields');

  const legacyFilter = { sourceType: { $exists: false } };
  const legacyCount = await col.countDocuments(legacyFilter);
  console.log(`  documents missing sourceType: ${legacyCount}`);

  if (legacyCount === 0) {
    console.log('  nothing to backfill');
  } else if (DRY_RUN) {
    console.log("  would set { sourceType: 'global_knowledge', archived: false, expiresAt: null, userId: null }");
  } else {
    // These are exactly the schema's own declared defaults — materialising
    // them, not inventing values. Embeddings are untouched, so this costs
    // nothing in API calls.
    const res = await col.updateMany(legacyFilter, {
      $set: { sourceType: 'global_knowledge', archived: false, expiresAt: null, userId: null },
    });
    console.log(`  matched ${res.matchedCount}, modified ${res.modifiedCount}`);
  }

  // Any stragglers that have sourceType but are still missing the newer flags.
  for (const [field, value] of [
    ['archived', false],
    ['expiresAt', null],
  ] as const) {
    const n = await col.countDocuments({ [field]: { $exists: false } });
    if (n > 0) {
      console.log(`  documents still missing "${field}": ${n}`);
      if (!DRY_RUN) {
        const r = await col.updateMany({ [field]: { $exists: false } }, { $set: { [field]: value } });
        console.log(`    backfilled ${r.modifiedCount}`);
      }
    }
  }

  // ── Step 3: verify ─────────────────────────────────────────────────────────
  console.log('\n[3/3] Verification');

  const finalIdx = ((await col.listSearchIndexes().toArray()) as any[]).find(
    (i) => i.name === VECTOR_INDEX_NAME,
  );
  const finalPaths = (finalIdx?.latestDefinition?.fields || [])
    .filter((f: any) => f.type === 'filter')
    .map((f: any) => f.path);

  let ok = true;
  const check = (cond: boolean, label: string) => {
    if (!cond) ok = false;
    console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${label}`);
  };

  check(finalIdx?.status === 'READY', `index READY (status=${finalIdx?.status}, queryable=${finalIdx?.queryable})`);
  for (const p of REQUIRED_FILTER_PATHS) {
    check(finalPaths.includes(p), `filter path "${p}"`);
  }
  for (const f of ['sourceType', 'archived', 'expiresAt']) {
    const missing = await col.countDocuments({ [f]: { $exists: false } });
    check(missing === 0, `documents missing "${f}": ${missing}`);
  }

  const bySource = await col
    .aggregate([{ $group: { _id: '$sourceType', n: { $sum: 1 } } }, { $sort: { n: -1 } }])
    .toArray();
  console.log(`  layers: ${JSON.stringify(bySource)}`);
  check(bySource.some((b: any) => b._id === 'global_knowledge'), 'global_knowledge layer present');

  // A real query is the only proof that Atlas accepts the pre-filter.
  if (!DRY_RUN && finalIdx?.status === 'READY') {
    console.log('\n  live $vectorSearch probe (the actual retrieval pre-filter):');
    try {
      const probe = await col
        .aggregate([
          {
            $vectorSearch: {
              index: VECTOR_INDEX_NAME,
              path: 'embedding',
              queryVector: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01),
              numCandidates: 50,
              limit: 3,
              filter: {
                sourceType: 'global_knowledge',
                archived: { $ne: true },
                $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
              },
            },
          },
          { $project: { title: 1, city: 1, sourceType: 1 } },
        ])
        .toArray();
      console.log(`  OK    query accepted, ${probe.length} hit(s)`);
      probe.forEach((d: any) => console.log(`          - ${d.title} (${d.city})`));
      if (probe.length === 0) {
        ok = false;
        console.log('  FAIL  query ran but matched nothing');
      }
    } catch (e: any) {
      ok = false;
      console.log(`  FAIL  query rejected: ${e.message}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(DRY_RUN ? 'DRY RUN COMPLETE' : ok ? 'RAG REPAIRED' : 'STILL BROKEN — see failures above');
  console.log('='.repeat(70));

  await mongoose.disconnect();
  process.exit(DRY_RUN || ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error('fix-vector-index failed:', e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
