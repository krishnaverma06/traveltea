/**
 * Hybrid Retrieval Service
 *
 * Unified retrieval pipeline that combines:
 *   1. Semantic Vector Search (existing VectorRetrievalService)
 *   2. Keyword Full Text Search (new TextSearchService)
 *   3. Reciprocal Rank Fusion (RRF) for intelligent merging
 *
 * Pipeline:
 *   User Query
 *       ↓
 *   Embedding Generation
 *       ↓
 *   Promise.all(Vector Search, Text Search)
 *       ↓
 *   Reciprocal Rank Fusion
 *       ↓
 *   Deduplication
 *       ↓
 *   Score Threshold Filter
 *       ↓
 *   Group by sourceType
 *       ↓
 *   Return (same shape as VectorRetrievalService output)
 *
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * WHY HYBRID SEARCH IMPROVES RETRIEVAL
 *
 * Semantic Search (Vector):
 *   - Understands meaning and intent ("places to eat" matches "restaurants")
 *   - Excellent for conceptual queries and paraphrased questions
 *   - Weak on exact names, codes, and specific keywords
 *
 * Keyword Search (Full Text):
 *   - Matches exact terms ("Amer Fort" finds documents with that exact name)
 *   - BM25 scoring rewards rare, specific terms
 *   - Weak on synonyms and intent-based queries
 *
 * Hybrid Search:
 *   - Combines both to cover each other's blind spots
 *   - A query like "emergency numbers in Goa" benefits from keyword matching
 *     on "emergency" AND semantic understanding of "safety information"
 *
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * WHY WEIGHTED RECIPROCAL RANK FUSION (RRF)
 *
 * RRF merges ranked lists without requiring score normalization.
 * This implementation intentionally uses Weighted RRF because:
 *   - Vector cosine similarity scores range [0, 1]
 *   - BM25 text search scores are unbounded positive numbers
 *   - Directly comparing or averaging these scores is meaningless
 *
 * Weighted RRF formula: score(d) = Σ (weight_i / (k + rank_i(d)))
 *
 * Where:
 *   - k = smoothing constant (default 60, from Cormack et al. 2009)
 *   - rank_i(d) = position of document d in ranked list i (1-based)
 *   - weight_i = configurable weight for search system i
 *
 * Properties:
 *   - Documents found by both systems naturally score higher
 *   - No score normalization needed — purely rank-based
 *   - The k constant prevents any single top result from dominating
 *   - Widely adopted: Elasticsearch, Pinecone, Weaviate all use RRF
 *
 * ────────────────────────────────────────────────────────────────────────────────
 */

import { generateEmbedding } from '../../services/embedding.js';
import { VectorRetrievalService } from './vector-retrieval.service.js';
import { TextSearchService } from './text-search.service.js';
import { KnowledgeSourceType } from '../types/vector.types.js';
import type {
  HybridSearchConfig,
  HybridSearchResult,
  HybridSearchMetrics,
  RankFusionEntry,
  GroupedRetrievalResults,
} from '../types/hybrid-search.types.js';
import {
  HYBRID_VECTOR_WEIGHT,
  HYBRID_TEXT_WEIGHT,
  HYBRID_MIN_SCORE,
  HYBRID_MAX_RESULTS,
  HYBRID_RRF_K,
} from '../types/hybrid-search.constants.js';
import Logger from '../../utils/logger.js';

const logger = new Logger('HybridRetrieval');

// ─── Service ───────────────────────────────────────────────────────────────────

export class HybridRetrievalService {

  /**
   * Main entry point: retrieve relevant knowledge using hybrid search.
   *
   * This replaces the direct call to VectorRetrievalService in the travel agent.
   * It returns the same GroupedRetrievalResults shape so PromptBuilder works
   * without any changes.
   *
   * @param query - The raw user query string
   * @param userId - Optional user ID for personalized retrieval
   * @param config - Optional configuration overrides
   * @returns Grouped results matching the PromptBuilder interface
   */
  public static async retrieve(
    query: string,
    userId?: string,
    config: HybridSearchConfig = {},
  ): Promise<GroupedRetrievalResults> {
    const totalStart = Date.now();

    const vectorWeight = config.vectorWeight ?? HYBRID_VECTOR_WEIGHT;
    const textWeight = config.textWeight ?? HYBRID_TEXT_WEIGHT;
    const minScore = config.minScore ?? HYBRID_MIN_SCORE;
    const maxResults = config.maxResults ?? HYBRID_MAX_RESULTS;
    const rrfK = config.rrfK ?? HYBRID_RRF_K;

    logger.info(`🔀 Hybrid retrieval starting${userId ? ` for user ${userId}` : ''}`);

    // ── Step 1: Generate embedding ─────────────────────────────────────────────
    let queryEmbedding: number[];
    try {
      queryEmbedding = await generateEmbedding(query);
    } catch (embeddingError: any) {
      logger.error(`Embedding generation failed: ${embeddingError.message}`);
      // If embedding fails, try text-only search
      return this.textOnlyFallback(query, userId, config);
    }

    // ── Step 2: Parallel retrieval ─────────────────────────────────────────────
    let vectorResults: any[] = [];
    let textResults: any[] = [];
    let vectorTimeMs = 0;
    let textTimeMs = 0;

    // Execute both searches in parallel — this is the core of hybrid search
    const [vectorOutcome, textOutcome] = await Promise.allSettled([
      // Existing vector search — completely unchanged
      (async () => {
        const start = Date.now();
        const grouped = await VectorRetrievalService.retrieveRelevantKnowledge(
          queryEmbedding,
          userId,
          {
            userProfileLimit: config.userProfileLimit,
            userTripsLimit: config.userTripsLimit,
            globalKnowledgeLimit: config.globalKnowledgeLimit,
            searchKnowledgeLimit: config.searchKnowledgeLimit,
            minScore: config.vectorMinScore,
          },
        );
        vectorTimeMs = Date.now() - start;
        // Flatten grouped results into a single array for fusion
        return [
          ...grouped.userProfile,
          ...grouped.userTrips,
          ...grouped.globalKnowledge,
          ...grouped.searchKnowledge,
        ];
      })(),

      // New text search
      (async () => {
        const start = Date.now();
        const results = await TextSearchService.searchAllLayers(
          query,
          userId,
          {
            userProfileLimit: config.userProfileLimit,
            userTripsLimit: config.userTripsLimit,
            globalKnowledgeLimit: config.globalKnowledgeLimit,
            searchKnowledgeLimit: config.searchKnowledgeLimit,
          },
        );
        textTimeMs = Date.now() - start;
        return results;
      })(),
    ]);

    // ── Step 3: Handle individual failures gracefully ───────────────────────────
    if (vectorOutcome.status === 'fulfilled') {
      vectorResults = vectorOutcome.value;
    } else {
      logger.error(`Vector search failed: ${vectorOutcome.reason?.message || 'Unknown error'}`);
      logger.warn('Continuing with text search results only');
    }

    if (textOutcome.status === 'fulfilled') {
      textResults = textOutcome.value;
    } else {
      logger.error(`Text search failed: ${textOutcome.reason?.message || 'Unknown error'}`);
      logger.warn('Continuing with vector search results only');
    }

    // If both failed, return empty results
    if (vectorResults.length === 0 && textResults.length === 0) {
      logger.warn('Both vector and text search returned no results');
      return { userProfile: [], userTrips: [], globalKnowledge: [], searchKnowledge: [] };
    }

    // ── Step 4: Reciprocal Rank Fusion ─────────────────────────────────────────
    const fusionStart = Date.now();
    const fusedResults = this.reciprocalRankFusion(
      vectorResults,
      textResults,
      vectorWeight,
      textWeight,
      rrfK,
    );
    const fusionTimeMs = Date.now() - fusionStart;

    // ── Step 5: Deduplicate ────────────────────────────────────────────────────
    const deduplicated = this.deduplicateResults(fusedResults);

    // ── Step 6: Score threshold filter ──────────────────────────────────────────
    const filtered = deduplicated.filter(r => r.fusedScore >= minScore);

    // ── Step 7: Limit results ──────────────────────────────────────────────────
    const limited = filtered.slice(0, maxResults);

    // ── Step 8: Group by sourceType (preserve existing output shape) ────────────
    const grouped = this.groupBySourceType(limited);

    // ── Structured logging ─────────────────────────────────────────────────────
    const totalTimeMs = Date.now() - totalStart;
    
    let vectorOnlyCount = 0;
    let textOnlyCount = 0;
    let overlapCount = 0;
    let totalFusedScore = 0;
    
    fusedResults.forEach(r => {
      if (r.source === 'vector') vectorOnlyCount++;
      else if (r.source === 'text') textOnlyCount++;
      else if (r.source === 'both') overlapCount++;
      totalFusedScore += r.fusedScore;
    });

    const averageFusedScore = fusedResults.length > 0 ? (totalFusedScore / fusedResults.length).toFixed(4) : '0';
    const removedByDeduplication = fusedResults.length - deduplicated.length;
    const removedByThreshold = deduplicated.length - filtered.length;

    const metrics: HybridSearchMetrics = {
      totalTimeMs,
      vectorTimeMs,
      textTimeMs,
      fusionTimeMs,
      vectorHits: vectorResults.length,
      textHits: textResults.length,
      mergedCount: limited.length,
      overlapCount,
      vectorOnlyCount,
      textOnlyCount,
      removedByDeduplication,
      removedByThreshold,
      averageFusedScore
    };

    logger.info(
      `✅ Hybrid retrieval complete in ${metrics.totalTimeMs}ms. ` +
      `Vector: ${metrics.vectorHits}, ` +
      `Text: ${metrics.textHits}, ` +
      `Avg Score: ${metrics.averageFusedScore}, ` +
      `Sources [Vector: ${metrics.vectorOnlyCount} | Text: ${metrics.textOnlyCount} | Both: ${metrics.overlapCount}], ` +
      `Filtered [Dedup: -${metrics.removedByDeduplication} | Threshold: -${metrics.removedByThreshold}], ` +
      `Final Returned: ${metrics.mergedCount}`
    );

    return grouped;
  }

  // ─── Reciprocal Rank Fusion ────────────────────────────────────────────────

  /**
   * Merge two ranked result sets using Reciprocal Rank Fusion.
   *
   * Algorithm:
   *   1. Assign rank positions (1-based) to each document in each list
   *   2. For each unique document, compute:
   *      fusedScore = vectorWeight / (k + vectorRank) + textWeight / (k + textRank)
   *   3. Sort by fusedScore descending
   *
   * Documents found by both systems receive contributions from both terms,
   * naturally scoring higher than documents found by only one system.
   *
   * @param vectorResults - Ranked results from vector search (highest score first)
   * @param textResults - Ranked results from text search (highest score first)
   * @param vectorWeight - Weight for vector search contribution
   * @param textWeight - Weight for text search contribution
   * @param k - Smoothing constant (default 60)
   * @returns Fused results sorted by combined score
   */
  private static reciprocalRankFusion(
    vectorResults: any[],
    textResults: any[],
    vectorWeight: number,
    textWeight: number,
    k: number,
  ): HybridSearchResult[] {
    // Build a map of documentId → RankFusionEntry
    const fusionMap = new Map<string, RankFusionEntry>();

    // Process vector results (already sorted by score from VectorRetrievalService)
    vectorResults.forEach((doc, index) => {
      const docId = doc._id.toString();
      fusionMap.set(docId, {
        documentId: docId,
        document: doc,
        vectorRank: index + 1,        // 1-based rank
        textRank: Infinity,            // Not found in text search (yet)
        vectorScore: doc.score || 0,
        textScore: 0,
        contentHash: doc.contentHash,
      });
    });

    // Process text results — merge with existing entries if document was found by both
    textResults.forEach((doc, index) => {
      const docId = doc._id.toString();
      const existing = fusionMap.get(docId);

      if (existing) {
        // Document found by both systems — update text rank and score
        existing.textRank = index + 1;
        existing.textScore = doc.score || 0;
      } else {
        // Document only found by text search
        fusionMap.set(docId, {
          documentId: docId,
          document: doc,
          vectorRank: Infinity,        // Not found in vector search
          textRank: index + 1,
          vectorScore: 0,
          textScore: doc.score || 0,
          contentHash: doc.contentHash,
        });
      }
    });

    // Compute RRF score for each document
    const fusedResults: HybridSearchResult[] = [];

    for (const entry of fusionMap.values()) {
      const vectorContribution = entry.vectorRank === Infinity
        ? 0
        : vectorWeight / (k + entry.vectorRank);

      const textContribution = entry.textRank === Infinity
        ? 0
        : textWeight / (k + entry.textRank);

      const fusedScore = vectorContribution + textContribution;

      // Determine source
      let source: 'vector' | 'text' | 'both';
      if (entry.vectorRank < Infinity && entry.textRank < Infinity) {
        source = 'both';
      } else if (entry.vectorRank < Infinity) {
        source = 'vector';
      } else {
        source = 'text';
      }

      fusedResults.push({
        document: entry.document,
        vectorScore: entry.vectorScore,
        textScore: entry.textScore,
        fusedScore,
        source,
      });
    }

    // Sort by fused score descending
    fusedResults.sort((a, b) => b.fusedScore - a.fusedScore);

    return fusedResults;
  }

  // ─── Deduplication ─────────────────────────────────────────────────────────

  /**
   * Deduplicate fused results by contentHash and document ID.
   * Preserves the highest-scoring version of duplicate documents.
   *
   * Extends the existing deduplication pattern from VectorRetrievalService.
   */
  private static deduplicateResults(results: HybridSearchResult[]): HybridSearchResult[] {
    const seenHashes = new Set<string>();
    const seenIds = new Set<string>();
    const deduplicated: HybridSearchResult[] = [];

    // Results are already sorted by fusedScore (highest first)
    for (const result of results) {
      const docId = result.document._id?.toString();

      // Skip if we've already seen this document ID
      if (docId && seenIds.has(docId)) continue;

      // Skip if we've already seen this content hash
      const hash = result.document.contentHash;
      if (hash && seenHashes.has(hash)) continue;

      // Track this document
      if (docId) seenIds.add(docId);
      if (hash) seenHashes.add(hash);

      deduplicated.push(result);
    }

    return deduplicated;
  }

  // ─── Grouping ──────────────────────────────────────────────────────────────

  /**
   * Group fused results by sourceType to match the existing
   * GroupedRetrievalResults shape expected by PromptBuilder.
   */
  private static groupBySourceType(results: HybridSearchResult[]): GroupedRetrievalResults {
    return {
      userProfile: results
        .filter(r => r.document.sourceType === KnowledgeSourceType.USER_PROFILE)
        .map(r => r.document),
      userTrips: results
        .filter(r => r.document.sourceType === KnowledgeSourceType.USER_TRIPS)
        .map(r => r.document),
      globalKnowledge: results
        .filter(r => r.document.sourceType === KnowledgeSourceType.GLOBAL_KNOWLEDGE)
        .map(r => r.document),
      searchKnowledge: results
        .filter(r => r.document.sourceType === KnowledgeSourceType.SEARCH_KNOWLEDGE)
        .map(r => r.document),
    };
  }

  // ─── Fallbacks ─────────────────────────────────────────────────────────────

  /**
   * Fallback: text-only search when embedding generation fails.
   * Ensures the pipeline degrades gracefully without vector search.
   */
  private static async textOnlyFallback(
    query: string,
    userId?: string,
    config: HybridSearchConfig = {},
  ): Promise<GroupedRetrievalResults> {
    logger.warn('Falling back to text-only search (embedding generation failed)');

    try {
      const textResults = await TextSearchService.searchAllLayers(query, userId, {
        userProfileLimit: config.userProfileLimit,
        userTripsLimit: config.userTripsLimit,
        globalKnowledgeLimit: config.globalKnowledgeLimit,
        searchKnowledgeLimit: config.searchKnowledgeLimit,
      });

      // Build minimal HybridSearchResult entries for grouping
      const pseudoFused: HybridSearchResult[] = textResults.map((doc) => ({
        document: doc,
        vectorScore: 0,
        textScore: doc.score || 0,
        fusedScore: doc.score || 0,
        source: 'text' as const,
      }));

      return this.groupBySourceType(pseudoFused);
    } catch (textError: any) {
      logger.error(`Text-only fallback also failed: ${textError.message}`);
      return { userProfile: [], userTrips: [], globalKnowledge: [], searchKnowledge: [] };
    }
  }
}
