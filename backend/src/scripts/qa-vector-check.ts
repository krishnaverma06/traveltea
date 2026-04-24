import 'dotenv/config';
import mongoose from 'mongoose';
import {
  VECTOR_COLLECTION_NAME,
  VECTOR_INDEX_NAME,
  EMBEDDING_DIMENSIONS,
} from '../vector/types/vector.constants.js';

/**
 * Health check for the RAG layer.
 *
 * Two independent things can silently disable retrieval, and both fail the same
 * way — `searchLayer` logs and returns [], which is indistinguishable from a
 * legitimately empty result:
 *
 *  1. The Atlas vector index omits a field used in the $vectorSearch
 *     pre-filter. Atlas then rejects the whole query
 *     ("Path 'archived' needs to be indexed as filter").
 *  2. Documents predate a filter field. Mongoose defaults apply on write only,
 *     so rows already in the collection have no sourceType/archived/expiresAt
 *     and can never match an equality pre-filter.
 *
 * Run: npm run qa:vector
 */

// Every path the retrieval service puts in its $vectorSearch filter.
// Keep in sync with vector/services/vector-retrieval.service.ts.
const REQUIRED_FILTER_PATHS = ['sourceType', 'userId', 'archived', 'expiresAt'];

await mongoose.connect(process.env.MONGODB_URI as string);
const col = mongoose.connection.db!.collection(VECTOR_COLLECTION_NAME);

let problems = 0;
const say = (ok: boolean, msg: string) => {
  if (!ok) problems++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${msg}`);
};

console.log('='.repeat(70));
console.log('RAG health check');
console.log('='.repeat(70));

// ── 1. index definition ──────────────────────────────────────────────────────
console.log('\n[1] Atlas vector index');
let indexes: any[] = [];
try {
  indexes = await col.listSearchIndexes().toArray();
} catch (e: any) {
  console.log(`  could not list search indexes: ${e.message}`);
}

const vIdx = indexes.find((i) => i.name === VECTOR_INDEX_NAME);
say(!!vIdx, `index "${VECTOR_INDEX_NAME}" exists`);

if (vIdx) {
  say(vIdx.queryable === true, `queryable (status=${vIdx.status})`);
  const fields: any[] = vIdx.latestDefinition?.fields || [];
  const vec = fields.find((f) => f.type === 'vector');
  say(
    vec?.numDimensions === EMBEDDING_DIMENSIONS,
    `vector dimensions = ${vec?.numDimensions} (code expects ${EMBEDDING_DIMENSIONS})`,
  );
  const filterPaths = fields.filter((f) => f.type === 'filter').map((f) => f.path);
  for (const p of REQUIRED_FILTER_PATHS) {
    say(filterPaths.includes(p), `filter path "${p}" declared`);
  }
  const missing = REQUIRED_FILTER_PATHS.filter((p) => !filterPaths.includes(p));
  if (missing.length) {
    console.log(`\n  → Atlas will REJECT every retrieval query until these are added: ${missing.join(', ')}`);
  }
}

// ── 2. document field coverage ───────────────────────────────────────────────
console.log('\n[2] Document field coverage');
const total = await col.countDocuments();
console.log(`  total documents: ${total}`);
for (const p of ['sourceType', 'archived', 'expiresAt']) {
  const missing = await col.countDocuments({ [p]: { $exists: false } });
  say(missing === 0, `documents missing "${p}": ${missing}`);
}
const noEmbedding = await col.countDocuments({
  $or: [{ embedding: { $exists: false } }, { embedding: { $size: 0 } }],
});
say(noEmbedding === 0, `documents without an embedding: ${noEmbedding}`);

const bySource = await col
  .aggregate([{ $group: { _id: '$sourceType', n: { $sum: 1 } } }, { $sort: { n: -1 } }])
  .toArray();
console.log(`  by sourceType: ${JSON.stringify(bySource)}`);
const haveGlobal = bySource.some((b: any) => b._id === 'global_knowledge');
say(haveGlobal, 'a global_knowledge layer exists');

console.log('\n' + '='.repeat(70));
console.log(problems === 0 ? 'RAG LOOKS HEALTHY' : `${problems} PROBLEM(S) FOUND`);
console.log('='.repeat(70));

await mongoose.disconnect();
process.exit(problems === 0 ? 0 : 1);
