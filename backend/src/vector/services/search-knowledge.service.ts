/**
 * Search Knowledge Service
 *
 * Automatically ingests lightweight semantic knowledge documents
 * whenever users search for destinations. These documents capture
 * the essence of a destination without storing raw API responses.
 *
 * Runs asynchronously (fire-and-forget) — never blocks the search response.
 * Reuses the existing embedding service from services/embedding.ts.
 */

import { VectorDocument } from '../models/VectorDocument.js';
import { VectorDocumentCategory, KnowledgeSourceType } from '../types/vector.types.js';
import type { SearchKnowledgeInput } from '../types/vector.types.js';
import { SEARCH_KNOWLEDGE_MIN_RESULTS } from '../types/vector.constants.js';
import { generateContentHash } from '../utils/content.utils.js';
import { generateDocumentEmbedding } from './vector-embedding.service.js';
import { getOpenTripMapAPI } from '../../mcp-servers/places/api.js';
import Logger from '../../utils/logger.js';

const logger = new Logger('SearchKnowledge');

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute a popularity score from search count and recency.
 * Higher = more popular. Decays over time to favor recent interest.
 */
function computePopularityScore(searchCount: number, lastSearched: Date): number {
  const daysSinceSearch = (Date.now() - lastSearched.getTime()) / (1000 * 60 * 60 * 24);
  const recencyBoost = Math.max(0, 1 - daysSinceSearch / 90); // Decays to 0 over 90 days
  return searchCount * 0.7 + recencyBoost * 30;
}

/**
 * Resolve the destination name from the search query itself.
 *
 * `destinations` are individual points-of-interest from a radius search
 * around the geocoded query (e.g. searching "Paris" returns things like
 * "Eiffel Tower"), NOT the destination itself — using destinations[0].name
 * here previously mislabeled every ingested document with a POI name that
 * also varies between calls for the same city. The query the user actually
 * typed is the reliable destination name.
 */
function resolveDestinationName(query: string): string {
  return query.charAt(0).toUpperCase() + query.slice(1);
}

/**
 * Resolve the destination's country via OpenTripMap's geoname lookup for
 * the search query (the same geocode step searchPlaces performs
 * internally, exposed separately as getCityCountryCode). Destination
 * results never carry a `country`/`address.country` field, so deriving it
 * from them (as this used to) always fell through to 'Unknown'.
 */
async function resolveCountry(query: string): Promise<string> {
  const code = await getOpenTripMapAPI().getCityCountryCode(query);
  return code || 'Unknown';
}

// ─── Document Builder ──────────────────────────────────────────────────────────

/**
 * Build a concise knowledge document from search results.
 * Does NOT store raw API payloads — only extracts key travel information.
 */
function buildSearchContent(input: SearchKnowledgeInput): string {
  const parts: string[] = [];

  parts.push(`${input.destinationName} is a travel destination in ${input.city}, ${input.country}.`);

  if (input.topAttractions.length > 0) {
    const attractionList = input.topAttractions.slice(0, 10).join(', ');
    parts.push(`Popular attractions include: ${attractionList}.`);
  }

  if (input.categories.length > 0) {
    const uniqueCategories = [...new Set(input.categories)].slice(0, 8);
    parts.push(`Known for: ${uniqueCategories.join(', ')}.`);
  }

  parts.push(`This destination was discovered via ${input.sourceAPI} search.`);

  return parts.join(' ');
}

/**
 * Build tags from search results for better discoverability.
 */
function buildSearchTags(input: SearchKnowledgeInput): string[] {
  const tags = new Set<string>();
  tags.add('search discovery');
  tags.add(input.city.toLowerCase());
  tags.add(input.country.toLowerCase());

  // Add unique category tags
  for (const cat of input.categories.slice(0, 5)) {
    tags.add(cat.toLowerCase());
  }

  // Add first few attraction names as tags
  for (const attr of input.topAttractions.slice(0, 3)) {
    tags.add(attr.toLowerCase());
  }

  return Array.from(tags);
}

// ─── Main Entry Point ──────────────────────────────────────────────────────────

/**
 * Ingest search knowledge from an explore/search API response.
 * This is called fire-and-forget after the response is sent to the user.
 *
 * If the destination already exists in search_knowledge, increments searchCount
 * and updates lastSearched WITHOUT regenerating the embedding (saves API cost).
 *
 * @param query - The user's search query
 * @param destinations - Array of destination results from the API
 * @param sourceAPI - Which API produced the results (e.g., 'opentripmap')
 */
export async function ingestSearchKnowledge(
  query: string,
  destinations: any[],
  sourceAPI: string
): Promise<void> {
  try {
    // Skip if too few results
    if (!destinations || destinations.length < SEARCH_KNOWLEDGE_MIN_RESULTS) {
      return;
    }

    const destinationName = resolveDestinationName(query);
    const country = await resolveCountry(query);
    const city = destinationName; // For most searches, city = destination name

    // Check if this destination already exists in search_knowledge — must
    // match the exact key the upsert below writes with (title+category+
    // country+city+sourceType), or a looser match can silently merge a new
    // destination's ingest into an unrelated existing document.
    const existing = await VectorDocument.findOne({
      title: destinationName,
      category: VectorDocumentCategory.DESTINATION,
      country,
      city,
      sourceType: KnowledgeSourceType.SEARCH_KNOWLEDGE,
    });

    if (existing) {
      // Update search count and recency — no embedding regeneration needed
      await updateSearchCount(existing._id.toString(), existing.searchCount || 0);
      logger.debug(`Search count updated for "${destinationName}" → ${(existing.searchCount || 0) + 1}`);
      return;
    }

    // Build the search knowledge input
    const input: SearchKnowledgeInput = {
      query,
      destinationName,
      country,
      city,
      topAttractions: destinations
        .filter((d: any) => d.name)
        .map((d: any) => d.name)
        .slice(0, 10),
      categories: destinations
        .flatMap((d: any) => d.category || [])
        .filter(Boolean),
      sourceAPI,
    };

    // Build the document content
    const content = buildSearchContent(input);
    const contentHash = generateContentHash(content);
    const tags = buildSearchTags(input);
    const now = new Date();

    // Generate embedding for the new content
    const embedding = await generateDocumentEmbedding({
      title: destinationName,
      category: VectorDocumentCategory.DESTINATION,
      country,
      city,
      tags,
      content,
      source: sourceAPI,
    });

    // Upsert the search knowledge document
    await VectorDocument.findOneAndUpdate(
      {
        title: destinationName,
        category: VectorDocumentCategory.DESTINATION,
        country,
        city,
        sourceType: KnowledgeSourceType.SEARCH_KNOWLEDGE,
      },
      {
        $set: {
          content,
          contentHash,
          tags,
          embedding,
          source: sourceAPI,
          sourceType: KnowledgeSourceType.SEARCH_KNOWLEDGE,
          generatedFrom: sourceAPI,
          privacy: 'public',
          searchCount: 1,
          lastSearched: now,
          popularityScore: computePopularityScore(1, now),
          version: 1,
          metadata: {
            travelTypes: ['leisure', 'cultural'],
          },
          // Lifecycle Management prep
          lastAccessed: now,
          accessCount: 1,
          archived: false,
          // Set an arbitrary expiration for search knowledge (e.g., 6 months from now)
          expiresAt: new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000),
        },
      },
      { upsert: true, new: true }
    );

    logger.info(`Search knowledge ingested: "${destinationName}" (${sourceAPI})`);
  } catch (error: any) {
    // Silently log — never throw from fire-and-forget
    logger.error(`Search knowledge ingestion failed for "${query}": ${error.message}`);
  }
}

// ─── Search Count Update ───────────────────────────────────────────────────────

/**
 * Increment search count and update popularity for an existing search knowledge doc.
 * Does NOT regenerate the embedding — content hasn't changed.
 */
async function updateSearchCount(docId: string, currentCount: number): Promise<void> {
  const now = new Date();
  const newCount = currentCount + 1;
  const newScore = computePopularityScore(newCount, now);

  await VectorDocument.findByIdAndUpdate(docId, {
    $set: {
      searchCount: newCount,
      lastSearched: now,
      popularityScore: newScore,
      lastAccessed: now,
    },
    $inc: {
      accessCount: 1,
    }
  });
}
