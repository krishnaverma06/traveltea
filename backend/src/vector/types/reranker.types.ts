import { HybridSearchResult } from './hybrid-search.types.js';

export interface RerankerConfig {
  /** Master toggle to enable/disable reranking */
  enabled?: boolean;
  /** Number of candidates to send to Gemini for reranking */
  topK?: number;
  /** Final number of documents to return after reranking */
  finalResults?: number;
  /** Truncation limit for document content */
  contentMaxLength?: number;
  /** Strict timeout for the single LLM reranking call */
  timeoutMs?: number;
  /** Include reasoning in LLM output */
  includeReason?: boolean;
  /** Weight applied to original fusion score */
  fusionWeight?: number;
  /** Weight applied to LLM rerank score */
  llmWeight?: number;
}

export interface RerankedDocument extends HybridSearchResult {
  /** The score given by the LLM (0.0 to 1.0) */
  rerankScore: number;
  /** Final combined score = (fusionWeight * fusedScore) + (llmWeight * rerankScore) */
  finalScore: number;
  /** Optional explanation from the LLM if includeReason is true */
  rerankReason?: string;
}

export interface RerankMetrics {
  /** True if reranking was performed, false if skipped or disabled */
  wasReranked: boolean;
  /** Latency of the LLM call and processing */
  rerankTimeMs: number;
  /** Number of documents sent to the LLM */
  candidatesScored: number;
  /** Number of documents returned after Top-N filtering */
  finalReturned: number;
  /** Highest final score */
  highestScore: number;
  /** Lowest final score */
  lowestScore: number;
  /** Average final score */
  averageScore: number;
  /** Error message if reranking failed */
  error?: string;
}
