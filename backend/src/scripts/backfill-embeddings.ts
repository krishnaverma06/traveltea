/**
 * Backfill Embeddings Script
 * 
 * One-time migration script to generate embeddings for all existing
 * saved trips that don't have one yet.
 * 
 * Usage:
 *   npx tsx src/scripts/backfill-embeddings.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import SavedTrip from '../models/SavedTrip.js';
import { generateEmbedding, buildTripSummary } from '../services/embedding.js';

// Small delay between API calls to avoid rate limiting
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function backfillEmbeddings() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/tripwhat';

  console.log('🔗 Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB\n');

  // Find all trips that don't have an embedding yet
  // Use +embedding to override select: false
  const tripsWithoutEmbeddings = await SavedTrip.find({
    $or: [
      { embedding: { $exists: false } },
      { embedding: { $size: 0 } },
      { embedding: null },
    ],
  }).select('+embedding');

  console.log(`📊 Found ${tripsWithoutEmbeddings.length} trips without embeddings\n`);

  if (tripsWithoutEmbeddings.length === 0) {
    console.log('✅ All trips already have embeddings. Nothing to do!');
    await mongoose.disconnect();
    return;
  }

  let success = 0;
  let failed = 0;

  for (let i = 0; i < tripsWithoutEmbeddings.length; i++) {
    const trip = tripsWithoutEmbeddings[i];
    const progress = `[${i + 1}/${tripsWithoutEmbeddings.length}]`;

    try {
      const summary = buildTripSummary(trip);
      const embedding = await generateEmbedding(summary);

      await SavedTrip.updateOne(
        { _id: trip._id },
        { $set: { embedding, searchSummary: summary } }
      );

      console.log(`${progress} ✅ ${trip.title} (${embedding.length} dims)`);
      success++;
    } catch (err: any) {
      console.error(`${progress} ❌ ${trip.title}: ${err.message}`);
      failed++;
    }

    // Rate limit: wait 200ms between API calls
    if (i < tripsWithoutEmbeddings.length - 1) {
      await delay(200);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`📊 Backfill complete:`);
  console.log(`   ✅ Success: ${success}`);
  console.log(`   ❌ Failed:  ${failed}`);
  console.log(`   📁 Total:   ${tripsWithoutEmbeddings.length}`);
  console.log('='.repeat(50));

  await mongoose.disconnect();
  console.log('\n🔌 Disconnected from MongoDB');
}

backfillEmbeddings().catch((err) => {
  console.error('Fatal error during backfill:', err);
  process.exit(1);
});
