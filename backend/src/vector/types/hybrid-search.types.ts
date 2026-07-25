/**
 * Hybrid Search Types
 *
 * Type definitions for the hybrid retrieval pipeline.
 * Covers configuration, results, metrics, and internal
 * rank fusion data structures.
 */

import type { IVectorDocument } from './vector.types.js';

// ─── Configuration ─────────────────────────────────────────────────────────────

/**
 * Configuration for the hybrid search pipeline.
 * All fields are optional — defaults come from hybrid-search.constants.ts.
 */
export interface HybridSearchConfig {
  /** Weight for vector/semantic search results (0.0–1.0) */
  vectorWeight?: number;
  /** Weight for text/keyword search results (0.0–1.0) */
  textWeight?: number;
  /** Number of candidates to retrieve per search system */
  topK?: number;
  /** Minimum fused score to keep a document */
  minScore?: number;
  /** Maximum final results after fusion */
  maxResults?: number;
  /** RRF smoothing constant */
  rrfK?: number;

  // ── Per-layer limits (passed to underlying services) ──────────────
  /** Max user profile results */
  userProfileLimit?: number;
  /** Max user trip results */
  userTripsLimit?: number;
  /** Max global knowledge results */
  globalKnowledgeLimit?: number;
  /** Max search knowledge results */
  searchKnowledgeLimit?: number;
  /** Minimum vector search score (passed to VectorRetrievalService) */
  vectorMinScore?: number;
}

// ─── Search Results ────────────────────────────────────────────────────────────

/**
 * Identifies which search system produced a result.
 */
export type SearchSource = 'vector' | 'text' | 'both';

/**
 * A single result from the text search pipeline.
 * Mirrors the shape of vector search results for consistent handling.
 */
export interface TextSearchResult {
  /** The matched document */
  document: IVectorDocument;
  /** Atlas Search relevance score (BM25-based) */
  score: number;
}

/**
 * A document after hybrid rank fusion, with scores from both systems.
 */
export interface HybridSearchResult {
  /** The matched document */
  document: IVectorDocument;
  /** Original vector search score (0 if not found by vector search) */
  vectorScore: number;
  /** Original text search score (0 if not found by text search) */
  textScore: number;
  /** Final fused score from Reciprocal Rank Fusion */
  fusedScore: number;
  /** Which search system(s) found this document */
  source: SearchSource;
}

// ─── Rank Fusion Internals ─────────────────────────────────────────────────────

/**
 * Internal entry used during the RRF merge process.
 * Maps a document ID to its rank positions and scores from each system.
 */
export interface RankFusionEntry {
  /** Document ID (string representation of _id) */
  documentId: string;
  /** The full document object */
  document: IVectorDocument;
  /** Rank in vector search results (1-based, Infinity if not found) */
  vectorRank: number;
  /** Rank in text search results (1-based, Infinity if not found) */
  textRank: number;
  /** Original vector score */
  vectorScore: number;
  /** Original text score */
  textScore: number;
  /** Content hash for deduplication */
  contentHash?: string;
}

// ─── Structured Metrics ────────────────────────────────────────────────────────

/**
 * Structured metrics for hybrid search logging.
 * Captures timing, hit counts, and fusion statistics.
 */
export interface HybridSearchMetrics {
  /** Total hybrid retrieval time (ms) */
  totalTimeMs: number;
  /** Vector search retrieval time (ms) */
  vectorTimeMs: number;
  /** Text search retrieval time (ms) */
  textTimeMs: number;
  /** Rank fusion computation time (ms) */
  fusionTimeMs: number;
  /** Number of raw vector search hits (before fusion) */
  vectorHits: number;
  /** Number of raw text search hits (before fusion) */
  textHits: number;
  /** Number of documents after fusion and deduplication */
  mergedCount: number;
  /** Number of documents found by both systems */
  overlapCount: number;
  /** Number of documents found only by vector search */
  vectorOnlyCount: number;
  /** Number of documents found only by text search */
  textOnlyCount: number;
  /** Number of documents removed during deduplication */
  removedByDeduplication: number;
  /** Number of documents removed because their score was below minScore */
  removedByThreshold: number;
  /** Average fused score of all documents before threshold filter */
  averageFusedScore: string;
}

// ─── Grouped Results ───────────────────────────────────────────────────────────

/**
 * The shape of grouped results returned by the hybrid retrieval service.
 * Matches the existing shape expected by PromptBuilder.buildRagContextPrompt().
 */
export interface GroupedRetrievalResults {
  userProfile: IVectorDocument[];
  userTrips: IVectorDocument[];
  globalKnowledge: IVectorDocument[];
  searchKnowledge: IVectorDocument[];
}
