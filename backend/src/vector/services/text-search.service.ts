/**
 * Text Search Service
 *
 * Atlas Full Text Search counterpart to the existing VectorRetrievalService.
 * Uses MongoDB Atlas Search ($search aggregation stage) for keyword/BM25-based
 * retrieval across the same vector_documents collection.
 *
 * This service:
 *   - Searches title, content, tags, city, and country fields
 *   - Respects metadata filters (sourceType, userId) for data isolation
 *   - Runs parallel searches across all knowledge layers
 *   - Never leaks another user's private documents
 *
 * Design: Mirrors the architecture of VectorRetrievalService (static methods,
 * per-layer search, parallel execution, error isolation).
 */

import mongoose from 'mongoose';
import { VectorDocument } from '../models/VectorDocument.js';
import { KnowledgeSourceType } from '../types/vector.types.js';
import {
  TEXT_SEARCH_INDEX_NAME,
  TEXT_SEARCH_USER_PROFILE_LIMIT,
  TEXT_SEARCH_USER_TRIPS_LIMIT,
  TEXT_SEARCH_GLOBAL_KNOWLEDGE_LIMIT,
  TEXT_SEARCH_SEARCH_KNOWLEDGE_LIMIT,
} from '../types/hybrid-search.constants.js';
import Logger from '../../utils/logger.js';

const logger = new Logger('TextSearch');

// ─── Configuration ─────────────────────────────────────────────────────────────

export interface TextSearchLayerConfig {
  userProfileLimit?: number;
  userTripsLimit?: number;
  globalKnowledgeLimit?: number;
  searchKnowledgeLimit?: number;
}

const DEFAULT_TEXT_CONFIG: Required<TextSearchLayerConfig> = {
  userProfileLimit: TEXT_SEARCH_USER_PROFILE_LIMIT,
  userTripsLimit: TEXT_SEARCH_USER_TRIPS_LIMIT,
  globalKnowledgeLimit: TEXT_SEARCH_GLOBAL_KNOWLEDGE_LIMIT,
  searchKnowledgeLimit: TEXT_SEARCH_SEARCH_KNOWLEDGE_LIMIT,
};

// ─── Service ───────────────────────────────────────────────────────────────────

export class TextSearchService {

  /**
   * Search a specific knowledge layer using Atlas Full Text Search.
   *
   * Uses the $search aggregation stage with a compound query that:
   *   1. "should" clause: searches across title, content, tags, city, country
   *   2. "filter" clause: enforces sourceType and userId metadata filtering
   *
   * This mirrors the per-layer pattern in VectorRetrievalService.searchLayer().
   */
  private static async searchLayer(
    query: string,
    sourceType: KnowledgeSourceType,
    limit: number,
    userId?: string,
  ): Promise<any[]> {
    if (limit <= 0 || !query.trim()) return [];

    // Cannot search user-specific layers without a user ID
    if (!userId && (
      sourceType === KnowledgeSourceType.USER_TRIPS ||
      sourceType === KnowledgeSourceType.USER_PROFILE
    )) {
      return [];
    }

    try {
      // Build filter clauses for the $search compound query
      const filterClauses: any[] = [
        {
          equals: {
            path: 'sourceType',
            value: sourceType,
          },
        },
      ];

      // Add userId filter for user-specific layers
      if (userId) {
        filterClauses.push({
          equals: {
            path: 'userId',
            value: new mongoose.Types.ObjectId(userId),
          },
        });
      }

      // Build the search pipeline
      const pipeline: any[] = [
        {
          $search: {
            index: TEXT_SEARCH_INDEX_NAME,
            compound: {
              should: [
                {
                  text: {
                    query: query,
                    path: 'title',
                    score: { boost: { value: 3 } }, // Title matches are most relevant
                  },
                },
                {
                  text: {
                    query: query,
                    path: 'content',
                    score: { boost: { value: 1 } }, // Content is the main body
                  },
                },
                {
                  text: {
                    query: query,
                    path: 'tags',
                    score: { boost: { value: 2 } }, // Tags are curated keywords
                  },
                },
                {
                  text: {
                    query: query,
                    path: 'city',
                    score: { boost: { value: 2.5 } }, // Location matches are high signal
                  },
                },
                {
                  text: {
                    query: query,
                    path: 'country',
                    score: { boost: { value: 2 } },
                  },
                },
              ],
              filter: filterClauses,
              minimumShouldMatch: 1,
            },
          },
        },
        {
          $addFields: { score: { $meta: 'searchScore' } },
        },
        {
          $limit: limit,
        },
        {
          $project: { embedding: 0 }, // Exclude heavy embedding payload
        },
      ];

      const results = await VectorDocument.aggregate(pipeline);
      return results;

    } catch (error: any) {
      // Graceful failure: log and return empty — never crash the pipeline
      if (error.message?.includes('index not found') || error.codeName === 'IndexNotFound') {
        logger.warn(`Atlas Search index "${TEXT_SEARCH_INDEX_NAME}" not found. Text search disabled for ${sourceType}.`);
      } else {
        logger.error(`Text search failed for ${sourceType} layer: ${error.message}`);
      }
      return [];
    }
  }

  /**
   * Run parallel text searches across all knowledge layers.
   *
   * Mirrors VectorRetrievalService.retrieveRelevantKnowledge() in structure:
   *   - Searches all 4 layers in parallel via Promise.all
   *   - Returns flat array of results with scores
   *   - Each layer respects its own metadata filters
   *
   * @param query - The raw user query string (used for keyword matching)
   * @param userId - Optional user ID for user-specific layer filtering
   * @param config - Optional per-layer result limits
   * @returns Flat array of search results with Atlas Search scores
   */
  public static async searchAllLayers(
    query: string,
    userId?: string,
    config: TextSearchLayerConfig = {},
  ): Promise<any[]> {
    const finalConfig = { ...DEFAULT_TEXT_CONFIG, ...config };

    const [userProfile, userTrips, globalKnowledge, searchKnowledge] = await Promise.all([
      this.searchLayer(query, KnowledgeSourceType.USER_PROFILE, finalConfig.userProfileLimit, userId),
      this.searchLayer(query, KnowledgeSourceType.USER_TRIPS, finalConfig.userTripsLimit, userId),
      this.searchLayer(query, KnowledgeSourceType.GLOBAL_KNOWLEDGE, finalConfig.globalKnowledgeLimit),
      this.searchLayer(query, KnowledgeSourceType.SEARCH_KNOWLEDGE, finalConfig.searchKnowledgeLimit),
    ]);

    const allResults = [...userProfile, ...userTrips, ...globalKnowledge, ...searchKnowledge];

    logger.info(
      `📝 Text search complete. ` +
      `Profile: ${userProfile.length}, ` +
      `Trips: ${userTrips.length}, ` +
      `Global: ${globalKnowledge.length}, ` +
      `Search: ${searchKnowledge.length}`
    );

    return allResults;
  }
}
