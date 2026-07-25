/**
 * Hybrid Search Constants
 *
 * Centralized configuration for the hybrid retrieval system.
 * Controls the behavior of Reciprocal Rank Fusion (RRF),
 * search weights, and result limits.
 *
 * All values can be overridden via environment variables for
 * production tuning without code changes.
 */

// ─── Search Weights ────────────────────────────────────────────────────────────

/**
 * Weight for semantic vector search results in the fusion algorithm.
 * Higher values favor meaning-based retrieval.
 * Range: 0.0 – 1.0
 */
export const HYBRID_VECTOR_WEIGHT = parseFloat(
  process.env.HYBRID_VECTOR_WEIGHT || '0.7'
);

/**
 * Weight for keyword/full-text search results in the fusion algorithm.
 * Higher values favor exact keyword matches.
 * Range: 0.0 – 1.0
 */
export const HYBRID_TEXT_WEIGHT = parseFloat(
  process.env.HYBRID_TEXT_WEIGHT || '0.3'
);

// ─── Result Limits ─────────────────────────────────────────────────────────────

/**
 * Number of candidate documents to retrieve from each search system
 * before fusion. Higher values increase recall but add latency.
 */
export const HYBRID_TOP_K = parseInt(
  process.env.HYBRID_TOP_K || '20', 10
);

/**
 * Minimum fused score threshold. Documents below this score
 * are discarded after rank fusion.
 */
export const HYBRID_MIN_SCORE = parseFloat(
  process.env.HYBRID_MIN_SCORE || '0.01'
);

/**
 * Maximum number of results returned after fusion and deduplication.
 * This is the final result set passed to the prompt builder.
 */
export const HYBRID_MAX_RESULTS = parseInt(
  process.env.HYBRID_MAX_RESULTS || '10', 10
);

// ─── Reciprocal Rank Fusion ────────────────────────────────────────────────────

/**
 * RRF smoothing constant (k).
 *
 * Controls how much lower-ranked documents are penalized.
 * The standard value of 60 (from the original Cormack et al. paper)
 * provides a balanced blend where top-ranked results from either
 * system receive significant weight, while still considering
 * documents ranked lower.
 *
 * Lower k → more aggressive (only top results matter)
 * Higher k → more democratic (lower ranks still contribute)
 */
export const HYBRID_RRF_K = parseInt(
  process.env.HYBRID_RRF_K || '60', 10
);

// ─── Text Search Boosts ────────────────────────────────────────────────────────

/** Boost for title matches. Highest priority. */
export const TITLE_BOOST = parseFloat(process.env.TITLE_BOOST || '3');

/** Boost for content matches. */
export const CONTENT_BOOST = parseFloat(process.env.CONTENT_BOOST || '1');

/** Boost for tag matches. */
export const TAGS_BOOST = parseFloat(process.env.TAGS_BOOST || '2');

/** Boost for city matches. */
export const CITY_BOOST = parseFloat(process.env.CITY_BOOST || '2.5');

/** Boost for country matches. */
export const COUNTRY_BOOST = parseFloat(process.env.COUNTRY_BOOST || '2');

// ─── Atlas Search Index ────────────────────────────────────────────────────────

/**
 * Name of the Atlas Search index for full-text keyword search.
 * Must match the index created in MongoDB Atlas UI/API.
 * Separate from the vector search index (VECTOR_INDEX_NAME).
 */
export const TEXT_SEARCH_INDEX_NAME = process.env.TEXT_SEARCH_INDEX_NAME || 'text_search_index';

// ─── Text Search Per-Layer Limits ──────────────────────────────────────────────

/**
 * Default limits for text search results per knowledge layer.
 * Mirrors the structure of RetrievalConfig in vector-retrieval.service.ts.
 */
export const TEXT_SEARCH_USER_PROFILE_LIMIT = 1;
export const TEXT_SEARCH_USER_TRIPS_LIMIT = 5;
export const TEXT_SEARCH_GLOBAL_KNOWLEDGE_LIMIT = 5;
export const TEXT_SEARCH_SEARCH_KNOWLEDGE_LIMIT = 5;
