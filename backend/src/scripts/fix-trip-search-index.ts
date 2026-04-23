import 'dotenv/config';
import mongoose from 'mongoose';
import { EMBEDDING_DIMENSIONS } from '../vector/types/vector.constants.js';
import { generateEmbedding, buildTripSummary } from '../services/embedding.js';

/**
 * Creates the Atlas vector index that `semanticSearchTrips` queries, and
 * backfills embeddings for any trip missing one.
 *
 * The index simply did not exist. `$vectorSearch` against a missing index
 * throws, and the controller catches that into a regex fallback — so saved-trip
 * search silently degraded to substring matching on title/description/tags and
 * looked like it "sort of worked", while never doing anything semantic.
 * "beach trip" matched nothing because no title contains that substring.
 *
 * `user` must be indexed as a filter path: Atlas rejects the entire query when
 * a $vectorSearch pre-filter references an unindexed path — the same failure
 * mode fix-vector-index.ts documents for the RAG collection.
 *
 * Idempotent. Pass --dry-run to preview.
 *
 * Run: npm run fix:trip-index
 */

const DRY_RUN = process.argv.includes('--dry-run');
const COLLECTION = 'savedtrips';
const INDEX_NAME = 'trip_semantic_search';
const REQUIRED_FILTER_PATHS = ['user'];

const INDEX_DEFINITION = {
  fields: [
    { type: 'vector', path: 'embedding', numDimensions: EMBEDDING_DIMENSIONS, similarity: 'cosine' },
    { type: 'filter', path: 'user' },
  ],
};

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** READY is the only trustworthy signal — see fix-vector-index.ts's note. */
async function waitForReady(col: any): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const idx = ((await col.listSearchIndexes().toArray()) as any[]).find((i) => i.name === INDEX_NAME);
    const paths = (idx?.latestDefinition?.fields || [])
      .filter((f: any) => f.type === 'filter')
      .map((f: any) => f.path);
    if (idx?.status === 'READY' && REQUIRED_FILTER_PATHS.every((p) => paths.includes(p))) return true;
    console.log(`    ...status=${idx?.status ?? 'building'} (${Math.round((Date.now() - startedAt) / 1000)}s)`);
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const db = mongoose.connection.db!;
  const col = db.collection(COLLECTION);

  console.log('='.repeat(70));
  console.log(`Saved-trip semantic search${DRY_RUN ? '  (DRY RUN)' : ''}`);
  console.log(`db: ${db.databaseName}   collection: ${COLLECTION}   index: ${INDEX_NAME}`);
  console.log('='.repeat(70));

  console.log('\n[1/3] Atlas vector index');
  const existing = (await col.listSearchIndexes().toArray()) as any[];
  const current = existing.find((i) => i.name === INDEX_NAME);

  if (!current) {
    console.log('  not found — creating');
    if (!DRY_RUN) {
      await col.createSearchIndex({ name: INDEX_NAME, type: 'vectorSearch', definition: INDEX_DEFINITION } as any);
      console.log(ready(await waitForReady(col)));
    }
  } else {
    const paths = (current.latestDefinition?.fields || [])
      .filter((f: any) => f.type === 'filter')
      .map((f: any) => f.path);
    const missing = REQUIRED_FILTER_PATHS.filter((p) => !paths.includes(p));
    console.log(`  exists, filter paths: ${paths.join(', ') || '(none)'}`);
    if (missing.length === 0) {
      console.log('  already correct');
    } else if (!DRY_RUN) {
      console.log(`  missing ${missing.join(', ')} — updating`);
      await col.updateSearchIndex(INDEX_NAME, INDEX_DEFINITION as any);
      console.log(ready(await waitForReady(col)));
    }
  }

  console.log('\n[2/3] Backfill missing embeddings');
  const missingEmb = await col
    .find({ $or: [{ embedding: { $exists: false } }, { embedding: null }, { embedding: { $size: 0 } }] })
    .toArray();
  console.log(`  trips without an embedding: ${missingEmb.length}`);
  for (const trip of missingEmb) {
    if (DRY_RUN) {
      console.log(`  would embed "${trip.title}"`);
      continue;
    }
    try {
      const summary = buildTripSummary(trip as any);
      const embedding = await generateEmbedding(summary);
      await col.updateOne({ _id: trip._id }, { $set: { embedding, searchSummary: summary } });
      console.log(`  embedded "${trip.title}"`);
    } catch (err: any) {
      console.log(`  FAILED "${trip.title}": ${err.message}`);
    }
  }

  console.log('\n[3/3] Live probe (the only proof Atlas accepts the pre-filter)');
  const sample: any = await col.findOne({ embedding: { $exists: true, $ne: null } });
  if (!sample) {
    console.log('  no embedded trip to probe with');
  } else if (!DRY_RUN) {
    const emb = await generateEmbedding('beach holiday by the sea');
    const hits = await col
      .aggregate([
        {
          $vectorSearch: {
            index: INDEX_NAME, path: 'embedding', queryVector: emb,
            numCandidates: 50, limit: 10, filter: { user: sample.user },
          },
        },
        { $addFields: { score: { $meta: 'vectorSearchScore' } } },
        { $project: { title: 1, score: 1 } },
      ])
      .toArray();
    console.log(`  "beach holiday by the sea" -> ${hits.length} hits`);
    hits.slice(0, 5).forEach((h: any) => console.log(`    ${h.score.toFixed(3)}  ${h.title}`));
    if (hits.length === 0) process.exitCode = 1;
  }

  await mongoose.disconnect();
}

const ready = (ok: boolean) => (ok ? '  index READY' : '  TIMED OUT waiting for READY');

main().catch((e) => { console.error(e); process.exit(1); });
