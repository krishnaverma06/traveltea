/**
 * Trip Knowledge Service
 *
 * Automatically ingests rich semantic knowledge documents
 * whenever users save itineraries. These documents represent
 * complete user trips and can be used for personalization
 * and advanced AI insights in the future.
 *
 * Runs asynchronously (fire-and-forget) — never blocks the save response.
 * Reuses the existing embedding service from services/embedding.ts.
 */

import { VectorDocument } from '../models/VectorDocument.js';
import { VectorDocumentCategory, KnowledgeSourceType } from '../types/vector.types.js';
import type { TripKnowledgeInput } from '../types/vector.types.js';
import { generateContentHash } from '../utils/content.utils.js';
import { generateDocumentEmbedding } from './vector-embedding.service.js';
import Logger from '../../utils/logger.js';

const logger = new Logger('TripKnowledge');

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a rich text representation of a user's saved trip.
 */
function buildTripContent(input: TripKnowledgeInput): string {
  const trip = input.tripDoc;
  const parts: string[] = [];

  // Title and Description
  parts.push(`Trip Title: ${trip.title}.`);
  if (trip.description) {
    parts.push(`Description: ${trip.description}.`);
  }

  // Logistics
  parts.push(`Travel Type: ${trip.travelType}.`);
  parts.push(`People: ${trip.people}.`);
  parts.push(`Duration: ${trip.totalDays} days.`);
  parts.push(`Budget Level: ${trip.budget}.`);

  // Destinations
  if (trip.cities && trip.cities.length > 0) {
    const cityList = trip.cities.map((c: any) => `${c.name} (${c.country || 'Unknown'})`).join(', ');
    parts.push(`Destinations visited: ${cityList}.`);
  }

  // Itinerary Highlights
  if (trip.generatedItinerary && trip.generatedItinerary.days) {
    parts.push(`Highlights:`);
    trip.generatedItinerary.days.forEach((day: any) => {
      parts.push(`- Day ${day.dayNumber} in ${day.city}:`);
      
      if (day.activities && day.activities.length > 0) {
        const activities = day.activities
          .map((a: any) => `${a.name} (${a.category})`)
          .join(', ');
        parts.push(`  Activities include ${activities}.`);
      }
      
      if (day.hotel && day.hotel.name) {
        parts.push(`  Stayed at ${day.hotel.name}.`);
      }
    });
  }

  // Tags
  if (trip.tags && trip.tags.length > 0) {
    parts.push(`Travel Tags: ${trip.tags.join(', ')}.`);
  }

  return parts.join('\n');
}

/**
 * Build searchable tags from the trip document.
 */
function buildTripTags(input: TripKnowledgeInput): string[] {
  const trip = input.tripDoc;
  const tags = new Set<string>();

  tags.add('user trip');
  tags.add(trip.travelType?.toLowerCase() || 'travel');
  tags.add(trip.budget?.toLowerCase() || 'budget');

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
    const input: TripKnowledgeInput = {
      tripDoc,
      userId,
    };

    const content = buildTripContent(input);
    const contentHash = generateContentHash(content);
    const tags = buildTripTags(input);

    const mainCity = tripDoc.cities && tripDoc.cities.length > 0 ? tripDoc.cities[0].name : 'Multiple';
    const mainCountry = tripDoc.cities && tripDoc.cities.length > 0 ? tripDoc.cities[0].country || 'Unknown' : 'Multiple';

    // Generate embedding
    const embedding = await generateDocumentEmbedding({
      title: tripDoc.title,
      category: VectorDocumentCategory.ITINERARY,
      country: mainCountry,
      city: mainCity,
      tags,
      content,
      source: 'user_trip',
    });

    // Insert vector document
    await VectorDocument.create({
      title: tripDoc.title,
      category: VectorDocumentCategory.ITINERARY,
      country: mainCountry,
      city: mainCity,
      tags,
      content,
      contentHash,
      embedding,
      source: 'user_trip',
      sourceType: KnowledgeSourceType.USER_TRIPS,
      userId: userId,
      tripId: tripDoc._id.toString(),
      privacy: tripDoc.isPublic ? 'public' : 'private',
      version: 1,
      metadata: {
        travelTypes: [tripDoc.travelType],
        estimatedCost: tripDoc.budget,
        duration: `${tripDoc.totalDays} days`,
      },
    });

    logger.info(`Trip knowledge ingested for trip: "${tripDoc.title}" (${tripDoc._id})`);
  } catch (error: any) {
    logger.error(`Trip knowledge ingestion failed for trip ${tripDoc._id}: ${error.message}`);
  }
}

/**
 * Update existing trip knowledge when a user edits their saved trip.
 * Regenerates the embedding ONLY if the content has changed meaningfully.
 */
export async function updateTripKnowledge(tripId: string, tripDoc: any): Promise<void> {
  try {
    // Find existing document
    const existing = await VectorDocument.findOne({
      tripId,
      sourceType: KnowledgeSourceType.USER_TRIPS,
    });

    if (!existing) {
      logger.warn(`Trip knowledge not found for update (tripId: ${tripId}). Falling back to ingest.`);
      // If it doesn't exist for some reason, just ingest it now
      await ingestTripKnowledge(tripDoc, tripDoc.user.toString());
      return;
    }

    const input: TripKnowledgeInput = {
      tripDoc,
      userId: existing.userId ? existing.userId.toString() : tripDoc.user.toString(),
    };

    const newContent = buildTripContent(input);
    const newContentHash = generateContentHash(newContent);
    const newTags = buildTripTags(input);

    let newEmbedding = existing.embedding;

    // Only regenerate embedding if content changed
    if (newContentHash !== existing.contentHash) {
      logger.debug(`Trip content changed for ${tripId}, regenerating embedding...`);
      newEmbedding = await generateDocumentEmbedding({
        title: tripDoc.title,
        category: VectorDocumentCategory.ITINERARY,
        country: existing.country, // Keep original main location
        city: existing.city,
        tags: newTags,
        content: newContent,
        source: 'user_trip',
      });
    }

    // Update document
    await VectorDocument.findByIdAndUpdate(existing._id, {
      $set: {
        title: tripDoc.title,
        content: newContent,
        contentHash: newContentHash,
        tags: newTags,
        embedding: newEmbedding,
        privacy: tripDoc.isPublic ? 'public' : 'private',
        version: (existing.version || 1) + 1,
        'metadata.travelTypes': [tripDoc.travelType],
        'metadata.estimatedCost': tripDoc.budget,
        'metadata.duration': `${tripDoc.totalDays} days`,
      },
    });

    logger.info(`Trip knowledge updated for trip: "${tripDoc.title}" (${tripId})`);
  } catch (error: any) {
    logger.error(`Trip knowledge update failed for trip ${tripId}: ${error.message}`);
  }
}

/**
 * Delete trip knowledge when a user deletes their saved trip.
 */
export async function deleteTripKnowledge(tripId: string): Promise<void> {
  try {
    const result = await VectorDocument.findOneAndDelete({
      tripId,
      sourceType: KnowledgeSourceType.USER_TRIPS,
    });

    if (result) {
      logger.info(`Trip knowledge deleted for tripId: ${tripId}`);
    } else {
      logger.debug(`No trip knowledge found to delete for tripId: ${tripId}`);
    }
  } catch (error: any) {
    logger.error(`Trip knowledge deletion failed for trip ${tripId}: ${error.message}`);
  }
}
