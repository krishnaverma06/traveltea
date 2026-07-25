/**
 * Reranker Constants
 *
 * Configuration for the Batched Cross-Encoder Reranker.
 * All constants can be overridden via environment variables.
 */

/** Master toggle to enable/disable reranking */
export const RERANK_ENABLED = process.env.RERANK_ENABLED !== 'false';

/** Number of candidates to send to Gemini for reranking */
export const RERANK_TOP_K = parseInt(process.env.RERANK_TOP_K || '10', 10);

/** Final number of documents to return after reranking */
export const RERANK_FINAL_RESULTS = parseInt(process.env.RERANK_FINAL_RESULTS || '5', 10);

/** Truncation limit for document content (saves tokens, reduces latency) */
export const RERANK_CONTENT_MAX_LENGTH = parseInt(process.env.RERANK_CONTENT_MAX_LENGTH || '800', 10);

/** Strict timeout for the single LLM reranking call (in milliseconds) */
export const RERANK_TIMEOUT_MS = parseInt(process.env.RERANK_TIMEOUT_MS || '4000', 10);

/**
 * Enable/disable the LLM's explanation field.
 * Set to true during development for debugging. Must be false or true.
 */
export const RERANK_INCLUDE_REASON = process.env.RERANK_INCLUDE_REASON === 'true';

// ─── Weighting Strategy ────────────────────────────────────────────────────────

/**
 * Final Score = (RERANK_FUSION_WEIGHT * fusionScore) + (RERANK_LLM_WEIGHT * rerankScore)
 */
export const RERANK_FUSION_WEIGHT = parseFloat(process.env.RERANK_FUSION_WEIGHT || '0.3');
export const RERANK_LLM_WEIGHT = parseFloat(process.env.RERANK_LLM_WEIGHT || '0.7');
