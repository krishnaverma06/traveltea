/**
 * Trip Knowledge Service
 *
 * Automatically ingests rich semantic knowledge documents whenever users save itineraries.
 * Implements Semantic Chunking: splits a large trip into Summary, Days, Hotels, and Activities
 * for precise retrieval in future RAG systems.
 *
 * Runs asynchronously (fire-and-forget) — never blocks the save response.
 */

import { VectorDocument } from '../models/VectorDocument.js';
import { VectorDocumentCategory, KnowledgeSourceType, ChunkType } from '../types/vector.types.js';
import type { TripKnowledgeInput } from '../types/vector.types.js';
import { generateContentHash } from '../utils/content.utils.js';
import { inferBudgetTier } from '../utils/metadata.utils.js';
import { generateDocumentEmbedding } from './vector-embedding.service.js';
import Logger from '../../utils/logger.js';

const logger = new Logger('TripKnowledge');

// ─── Document Builders ─────────────────────────────────────────────────────────

interface TripChunk {
  chunkType: ChunkType;
  chunkIndex: number;
  title: string;
  category: VectorDocumentCategory;
  content: string;
}

/**
 * Split a trip into semantic chunks (Summary, Days, Hotels, Activities).
 */
function buildTripChunks(input: TripKnowledgeInput): TripChunk[] {
  const trip = input.tripDoc;
  const chunks: TripChunk[] = [];
  let chunkIndex = 0;

  const budgetTier = inferBudgetTier(trip.budget);

  // 1. Summary Chunk
  const summaryParts = [
    `Trip Summary: ${trip.title}.`,
    trip.description ? `Description: ${trip.description}.` : '',
    `Travel Type: ${trip.travelType}.`,
    `People: ${trip.people}. Duration: ${trip.totalDays} days. Budget: ${budgetTier}.`,
  ];
  if (trip.cities && trip.cities.length > 0) {
    const cityList = trip.cities.map((c: any) => `${c.name} (${c.country || 'Unknown'})`).join(', ');
    summaryParts.push(`Destinations: ${cityList}.`);
  }
  chunks.push({
    chunkType: ChunkType.SUMMARY,
    chunkIndex: chunkIndex++,
    title: `${trip.title} - Summary`,
    category: VectorDocumentCategory.ITINERARY,
    content: summaryParts.filter(Boolean).join('\n'),
  });

  if (!trip.generatedItinerary || !trip.generatedItinerary.days) {
    return chunks;
  }

  const allHotels = new Set<string>();
  const allActivities = new Set<string>();

  // 2. Daily Chunks
  trip.generatedItinerary.days.forEach((day: any) => {
    const dayParts = [`Day ${day.dayNumber} in ${day.city}:`];
    
    if (day.hotel && day.hotel.name) {
      dayParts.push(`Accommodation: ${day.hotel.name}.`);
      allHotels.add(day.hotel.name);
    }

    if (day.activities && day.activities.length > 0) {
      dayParts.push('Activities:');
      day.activities.forEach((a: any) => {
        dayParts.push(`- ${a.name} (${a.category})`);
        allActivities.add(`${a.name} (${a.category})`);
      });
    }

    chunks.push({
      chunkType: ChunkType.ITINERARY_DAY,
      chunkIndex: chunkIndex++,
      title: `${trip.title} - Day ${day.dayNumber}`,
      category: VectorDocumentCategory.ITINERARY,
      content: dayParts.join('\n'),
    });
  });

  // 3. Hotel Chunk (if multiple)
  if (allHotels.size > 0) {
    chunks.push({
      chunkType: ChunkType.HOTEL,
      chunkIndex: chunkIndex++,
      title: `${trip.title} - Accommodations`,
      category: VectorDocumentCategory.HOTEL,
      content: `Accommodations booked for this trip:\n` + Array.from(allHotels).map(h => `- ${h}`).join('\n'),
    });
  }

  // 4. Activities Chunk (if multiple)
  if (allActivities.size > 0) {
    chunks.push({
      chunkType: ChunkType.ACTIVITY,
      chunkIndex: chunkIndex++,
      title: `${trip.title} - Activities`,
      category: VectorDocumentCategory.ACTIVITY,
      content: `All activities planned for this trip:\n` + Array.from(allActivities).map(a => `- ${a}`).join('\n'),
    });
  }

  return chunks;
}

/**
 * Build searchable tags from the trip document.
 */
function buildTripTags(input: TripKnowledgeInput): string[] {
  const trip = input.tripDoc;
  const tags = new Set<string>();

  tags.add('user trip');
  tags.add(trip.travelType?.toLowerCase() || 'travel');
  tags.add(inferBudgetTier(trip.budget).toLowerCase());

  if (trip.tags) {
    trip.tags.forEach((t: string) => tags.add(t.toLowerCase()));
  }

  if (trip.cities) {
    trip.cities.forEach((c: any) => {
      if (c.name) tags.add(c.name.toLowerCase());
      if (c.country) tags.add(c.country.toLowerCase());
    });
  }

  return Array.from(tags);
}

// ─── Main Entry Points ─────────────────────────────────────────────────────────

/**
 * Ingest trip knowledge from a newly saved trip.
 * This is called fire-and-forget after the response is sent to the user.
 *
 * @param tripDoc - The SavedTrip MongoDB document
 * @param userId - The ID of the user who owns the trip
 */
export async function ingestTripKnowledge(tripDoc: any, userId: string): Promise<void> {
  try {
    const input: TripKnowledgeInput = { tripDoc, userId };
    const chunks = buildTripChunks(input);
    const tags = buildTripTags(input);

    const mainCity = tripDoc.cities && tripDoc.cities.length > 0 ? tripDoc.cities[0].name : 'Multiple';
    const mainCountry = tripDoc.cities && tripDoc.cities.length > 0 ? tripDoc.cities[0].country || 'Unknown' : 'Multiple';

    let parentDocumentId: any = null;

    // We process chunks sequentially to establish parent-child relationship.
    // Each chunk is its own try/catch: a unique-index collision (or any
    // other single-chunk failure) shouldn't abort ingestion for the rest of
    // the trip's chunks — that previously meant one bad chunk silently
    // dropped a trip's knowledge entirely.
    let ingestedCount = 0;
    for (const chunk of chunks) {
      try {
        const contentHash = generateContentHash(chunk.content);

        const embedding = await generateDocumentEmbedding({
          title: chunk.title,
          category: chunk.category,
          country: mainCountry,
          city: mainCity,
          tags,
          content: chunk.content,
          source: 'user_trip',
        });

        const doc = await VectorDocument.create({
          title: chunk.title,
          category: chunk.category,
          country: mainCountry,
          city: mainCity,
          tags,
          content: chunk.content,
          contentHash,
          embedding,
          source: 'user_trip',
          sourceType: KnowledgeSourceType.USER_TRIPS,
          userId: userId,
          tripId: tripDoc._id.toString(),
          privacy: tripDoc.isPublic ? 'public' : 'private',
          version: 1,
          chunkType: chunk.chunkType,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunks.length,
          parentDocument: chunk.chunkType === ChunkType.SUMMARY ? null : parentDocumentId,
          metadata: {
            travelTypes: [tripDoc.travelType],
            estimatedCost: inferBudgetTier(tripDoc.budget),
            duration: `${tripDoc.totalDays} days`,
          },
        });

        // The summary chunk is always first and acts as the parent
        if (chunk.chunkType === ChunkType.SUMMARY) {
          parentDocumentId = doc._id;
        }
        ingestedCount++;
      } catch (chunkError: any) {
        logger.error(`Trip knowledge chunk failed for trip ${tripDoc._id} (chunkType: ${chunk.chunkType}): ${chunkError.message}`);
      }
    }

    logger.info(`Trip knowledge ingested for trip: "${tripDoc.title}" (${tripDoc._id}) — ${ingestedCount}/${chunks.length} chunks.`);
  } catch (error: any) {
    logger.error(`Trip knowledge ingestion failed for trip ${tripDoc._id}: ${error.message}`);
  }
}

/**
 * Update existing trip knowledge when a user edits their saved trip.
 * Smart update: deletes old chunks and re-ingests, but reuses embeddings if hash matches.
 */
export async function updateTripKnowledge(tripId: string, tripDoc: any): Promise<void> {
  try {
    const existingChunks = await VectorDocument.find({
      tripId,
      sourceType: KnowledgeSourceType.USER_TRIPS,
    });

    if (existingChunks.length === 0) {
      logger.warn(`Trip knowledge not found for update (tripId: ${tripId}). Falling back to ingest.`);
      await ingestTripKnowledge(tripDoc, tripDoc.user.toString());
      return;
    }

    const userId = existingChunks[0].userId ? existingChunks[0].userId.toString() : tripDoc.user.toString();
    const input: TripKnowledgeInput = { tripDoc, userId };
    const newChunks = buildTripChunks(input);
    const tags = buildTripTags(input);

    const mainCity = tripDoc.cities && tripDoc.cities.length > 0 ? tripDoc.cities[0].name : 'Multiple';
    const mainCountry = tripDoc.cities && tripDoc.cities.length > 0 ? tripDoc.cities[0].country || 'Unknown' : 'Multiple';

    // Delete old chunks first
    await VectorDocument.deleteMany({ tripId, sourceType: KnowledgeSourceType.USER_TRIPS });

    let parentDocumentId: any = null;

    // Insert new chunks, reusing embeddings where possible. Each chunk gets
    // its own try/catch — the old chunks are already deleted by this point,
    // so a collision on one chunk must not prevent the rest from being
    // written (that would be a net loss versus before the update).
    let updatedCount = 0;
    for (const chunk of newChunks) {
      try {
        const contentHash = generateContentHash(chunk.content);

        // Look for an existing chunk with the same hash
        const existingMatch = existingChunks.find(c => c.contentHash === contentHash);

        let embedding = existingMatch?.embedding;
        if (!embedding) {
          logger.debug(`Chunk content changed for ${tripId} (type: ${chunk.chunkType}), generating embedding...`);
          embedding = await generateDocumentEmbedding({
            title: chunk.title,
            category: chunk.category,
            country: mainCountry,
            city: mainCity,
            tags,
            content: chunk.content,
            source: 'user_trip',
          });
        }

        const doc = await VectorDocument.create({
          title: chunk.title,
          category: chunk.category,
          country: mainCountry,
          city: mainCity,
          tags,
          content: chunk.content,
          contentHash,
          embedding,
          source: 'user_trip',
          sourceType: KnowledgeSourceType.USER_TRIPS,
          userId: userId,
          tripId: tripId,
          privacy: tripDoc.isPublic ? 'public' : 'private',
          version: (existingChunks[0].version || 1) + 1,
          chunkType: chunk.chunkType,
          chunkIndex: chunk.chunkIndex,
          totalChunks: newChunks.length,
          parentDocument: chunk.chunkType === ChunkType.SUMMARY ? null : parentDocumentId,
          metadata: {
            travelTypes: [tripDoc.travelType],
            estimatedCost: inferBudgetTier(tripDoc.budget),
            duration: `${tripDoc.totalDays} days`,
          },
        });

        if (chunk.chunkType === ChunkType.SUMMARY) {
          parentDocumentId = doc._id;
        }
        updatedCount++;
      } catch (chunkError: any) {
        logger.error(`Trip knowledge chunk update failed for trip ${tripId} (chunkType: ${chunk.chunkType}): ${chunkError.message}`);
      }
    }

    logger.info(`Trip knowledge updated for trip: "${tripDoc.title}" (${tripId}) — ${updatedCount}/${newChunks.length} chunks.`);
  } catch (error: any) {
    logger.error(`Trip knowledge update failed for trip ${tripId}: ${error.message}`);
  }
}

/**
 * Delete all trip knowledge chunks when a user deletes their saved trip.
 */
export async function deleteTripKnowledge(tripId: string): Promise<void> {
  try {
    const result = await VectorDocument.deleteMany({
      tripId,
      sourceType: KnowledgeSourceType.USER_TRIPS,
    });

    if (result.deletedCount > 0) {
      logger.info(`Trip knowledge deleted for tripId: ${tripId} (${result.deletedCount} chunks)`);
    } else {
      logger.debug(`No trip knowledge chunks found to delete for tripId: ${tripId}`);
    }
  } catch (error: any) {
    logger.error(`Trip knowledge deletion failed for trip ${tripId}: ${error.message}`);
  }
}
