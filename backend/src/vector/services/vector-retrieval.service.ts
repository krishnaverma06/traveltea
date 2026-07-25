import mongoose from 'mongoose';
import { VectorDocument } from '../models/VectorDocument.js';
import { KnowledgeSourceType } from '../types/vector.types.js';
import { VECTOR_INDEX_NAME } from '../types/vector.constants.js';
import Logger from '../../utils/logger.js';

const logger = new Logger('VectorRetrieval');

export interface RetrievalConfig {
  userProfileLimit?: number;
  userTripsLimit?: number;
  globalKnowledgeLimit?: number;
  searchKnowledgeLimit?: number;
  minScore?: number;
}

const DEFAULT_CONFIG: RetrievalConfig = {
  userProfileLimit: 1,
  userTripsLimit: 5,
  globalKnowledgeLimit: 5,
  searchKnowledgeLimit: 5,
  minScore: 0.65, // Generous default for finding adjacent contexts
};

export class VectorRetrievalService {
  /**
   * Search a specific knowledge layer
   */
  private static async searchLayer(
    embedding: number[],
    sourceType: KnowledgeSourceType,
    limit: number,
    userId?: string,
    minScore: number = 0.65
  ): Promise<any[]> {
    if (limit <= 0) return [];

    const filter: any = { sourceType };
    if (userId) {
      filter.userId = new mongoose.Types.ObjectId(userId);
    } else if (sourceType === KnowledgeSourceType.USER_TRIPS || sourceType === KnowledgeSourceType.USER_PROFILE) {
      // Cannot search user-specific layers without a user ID
      return [];
    }

    try {
      const results = await VectorDocument.aggregate([
        {
          $vectorSearch: {
            index: VECTOR_INDEX_NAME,
            path: 'embedding',
            queryVector: embedding,
            numCandidates: Math.max(50, limit * 2), // Atlas requires numCandidates >= limit
            limit: limit,
            filter: filter,
          },
        },
        {
          $addFields: { score: { $meta: 'vectorSearchScore' } },
        },
        {
          $match: { score: { $gte: minScore } },
        },
        {
          $project: { embedding: 0 }, // Exclude heavy embedding payload
        },
      ]);

      return results;
    } catch (error: any) {
      logger.error(`Failed to retrieve ${sourceType} layer: ${error.message}`);
      return [];
    }
  }

  /**
   * Retrieve, merge, deduplicate, and rank all relevant knowledge for a query
   */
  public static async retrieveRelevantKnowledge(
    queryEmbedding: number[],
    userId?: string,
    config: Partial<RetrievalConfig> = {}
  ) {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();

    logger.info(`🔍 Retrieving RAG context${userId ? ` for user ${userId}` : ''}`);

    // Run searches in parallel
    const [userProfile, userTrips, globalKnowledge, searchKnowledge] = await Promise.all([
      this.searchLayer(queryEmbedding, KnowledgeSourceType.USER_PROFILE, finalConfig.userProfileLimit!, userId, finalConfig.minScore!),
      this.searchLayer(queryEmbedding, KnowledgeSourceType.USER_TRIPS, finalConfig.userTripsLimit!, userId, finalConfig.minScore!),
      this.searchLayer(queryEmbedding, KnowledgeSourceType.GLOBAL_KNOWLEDGE, finalConfig.globalKnowledgeLimit!, undefined, finalConfig.minScore!),
      this.searchLayer(queryEmbedding, KnowledgeSourceType.SEARCH_KNOWLEDGE, finalConfig.searchKnowledgeLimit!, undefined, finalConfig.minScore!),
    ]);

    // Merge and deduplicate by contentHash to ensure we don't feed LLM repeated data
    const allResults = [...userProfile, ...userTrips, ...globalKnowledge, ...searchKnowledge];
    const deduplicated = this.deduplicateResults(allResults);

    // Re-group them since deduplication might have removed some
    const groupedResults = {
      userProfile: deduplicated.filter(d => d.sourceType === KnowledgeSourceType.USER_PROFILE),
      userTrips: deduplicated.filter(d => d.sourceType === KnowledgeSourceType.USER_TRIPS),
      globalKnowledge: deduplicated.filter(d => d.sourceType === KnowledgeSourceType.GLOBAL_KNOWLEDGE),
      searchKnowledge: deduplicated.filter(d => d.sourceType === KnowledgeSourceType.SEARCH_KNOWLEDGE),
    };

    logger.info(
      `✅ Retrieval complete in ${Date.now() - startTime}ms. ` +
      `Profile: ${groupedResults.userProfile.length}, ` +
      `Trips: ${groupedResults.userTrips.length}, ` +
      `Global: ${groupedResults.globalKnowledge.length}, ` +
      `Search: ${groupedResults.searchKnowledge.length}`
    );

    return groupedResults;
  }

  /**
   * Deduplicate by contentHash (and _id as fallback)
   */
  private static deduplicateResults(results: any[]): any[] {
    const seenHashes = new Set<string>();
    const seenIds = new Set<string>();
    const deduplicated: any[] = [];

    // Sort by score first so we keep the highest scoring version of a duplicate
    const sorted = [...results].sort((a, b) => b.score - a.score);

    for (const doc of sorted) {
      const idStr = doc._id.toString();
      
      if (seenIds.has(idStr)) continue;
      
      if (doc.contentHash) {
        if (seenHashes.has(doc.contentHash)) continue;
        seenHashes.add(doc.contentHash);
      }
      
      seenIds.add(idStr);
      deduplicated.push(doc);
    }

    return deduplicated;
  }
}
