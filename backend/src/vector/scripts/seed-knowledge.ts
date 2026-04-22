/**
 * Seed Knowledge Script
 *
 * Seeds the MongoDB Atlas vector_documents collection with a realistic
 * travel knowledge base for Jaipur, Goa, and Manali.
 *
 * Usage:
 *   npx tsx src/vector/scripts/seed-knowledge.ts
 *
 * This script is idempotent — it uses upsert operations, so it is
 * safe to re-run without creating duplicates.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { ingestFromJSON } from '../ingestion/ingestion.pipeline.js';
import type { BulkIngestionResult } from '../types/vector.types.js';
import { VECTOR_COLLECTION_NAME, VECTOR_INDEX_NAME, EMBEDDING_DIMENSIONS } from '../types/vector.constants.js';

// ─── Setup ─────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// ─── Seed Files ────────────────────────────────────────────────────────────────

const SEED_FILES = [
  { name: 'Jaipur', path: path.resolve(__dirname, '../seed-data/jaipur.json') },
  { name: 'Goa', path: path.resolve(__dirname, '../seed-data/goa.json') },
  { name: 'Manali', path: path.resolve(__dirname, '../seed-data/manali.json') },
];

// ─── Main ──────────────────────────────────────────────────────────────────────

async function seedKnowledge() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/tripwhat';

  console.log('🌱 TravelTea Knowledge Base Seeder');
  console.log('='.repeat(60));
  console.log('');
  console.log('🔗 Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB\n');

  const totalResult: BulkIngestionResult = {
    total: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    duration: 0,
  };

  const startTime = Date.now();

  for (const seedFile of SEED_FILES) {
    console.log(`\n📂 Ingesting: ${seedFile.name}`);
    console.log('-'.repeat(40));

    try {
      const result = await ingestFromJSON(seedFile.path);

      console.log(`  ✅ Inserted: ${result.inserted}`);
      console.log(`  🔄 Updated:  ${result.updated}`);
      console.log(`  ⏭️  Skipped:  ${result.skipped}`);
      console.log(`  ❌ Failed:   ${result.failed}`);
      console.log(`  ⏱️  Duration: ${result.duration}ms`);

      totalResult.total += result.total;
      totalResult.inserted += result.inserted;
      totalResult.updated += result.updated;
      totalResult.skipped += result.skipped;
      totalResult.failed += result.failed;
      totalResult.errors.push(...result.errors);

      if (result.errors.length > 0) {
        console.log(`  ⚠️  Errors:`);
        for (const err of result.errors) {
          console.log(`     - ${err.title}: ${err.error}`);
        }
      }
    } catch (error: any) {
      console.error(`  ❌ Failed to ingest ${seedFile.name}: ${error.message}`);
      totalResult.failed++;
      totalResult.errors.push({ title: seedFile.name, error: error.message });
    }
  }

  totalResult.duration = Date.now() - startTime;

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('📊 SEEDING COMPLETE');
  console.log('='.repeat(60));
  console.log(`  📁 Total documents:  ${totalResult.total}`);
  console.log(`  ✅ Inserted:         ${totalResult.inserted}`);
  console.log(`  🔄 Updated:          ${totalResult.updated}`);
  console.log(`  ⏭️  Skipped:          ${totalResult.skipped}`);
  console.log(`  ❌ Failed:           ${totalResult.failed}`);
  console.log(`  ⏱️  Total duration:   ${totalResult.duration}ms`);

  // ── Atlas Vector Search Index Instructions ─────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('🔍 ATLAS VECTOR SEARCH INDEX SETUP');
  console.log('='.repeat(60));
  console.log(`
To enable vector search, create a Search Index in MongoDB Atlas:

1. Go to: Atlas Dashboard → Your Cluster → Search → Create Search Index
2. Select "JSON Editor" and use the following definition:
3. Index Name: "${VECTOR_INDEX_NAME}"
4. Collection: "${VECTOR_COLLECTION_NAME}"
5. Index Definition:

{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": ${EMBEDDING_DIMENSIONS},
      "similarity": "cosine"
    },
    { "type": "filter", "path": "category" },
    { "type": "filter", "path": "country" },
    { "type": "filter", "path": "city" },
    { "type": "filter", "path": "tags" },
    { "type": "filter", "path": "sourceType" },
    { "type": "filter", "path": "userId" },
    { "type": "filter", "path": "archived" },
    { "type": "filter", "path": "expiresAt" }
  ]
}

IMPORTANT: every field referenced in vector-retrieval.service.ts's
$vectorSearch pre-filter (sourceType, userId, archived, expiresAt) MUST be
declared as a "filter" field here, or Atlas rejects the query — which this
app silently downgrades to "0 results", indistinguishable from a legitimate
empty result. Keep this list in sync with that file's filter object.

Note: The index may take a few minutes to build after creation.
`);

  await mongoose.disconnect();
  console.log('🔌 Disconnected from MongoDB');
}

// ─── Run ───────────────────────────────────────────────────────────────────────

seedKnowledge().catch((err) => {
  console.error('Fatal error during seeding:', err);
  process.exit(1);
});
