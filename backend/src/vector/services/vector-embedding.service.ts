/**
 * Vector Embedding Service
 *
 * Wraps the existing embedding service (src/services/embedding.ts) to provide
 * vector document-specific embedding generation with batch processing
 * and rate limiting.
 *
 * This does NOT duplicate embedding logic — it delegates to the existing
 * GoogleGenerativeAIEmbeddings-based service.
 */

import { generateEmbedding } from '../../services/embedding.js';
import type { VectorDocumentInput } from '../types/vector.types.js';
import { DEFAULT_EMBEDDING_DELAY_MS } from '../types/vector.constants.js';
import { buildEmbeddingText } from '../utils/content.utils.js';
import Logger from '../../utils/logger.js';

const logger = new Logger('VectorEmbedding');

// ─── Helpers ───────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Single Document Embedding ─────────────────────────────────────────────────

/**
 * Generate an embedding vector for a single vector document.
 * Builds a rich text representation from the document fields,
 * then delegates to the existing Gemini embedding service.
 */
export async function generateDocumentEmbedding(
  doc: VectorDocumentInput
): Promise<number[]> {
  const text = buildEmbeddingText(doc);
  logger.debug(`Generating embedding for: "${doc.title}" (${text.length} chars)`);

  try {
    const embedding = await generateEmbedding(text);
    logger.debug(`Embedding generated: ${embedding.length} dimensions`);
    return embedding;
  } catch (error: any) {
    logger.error(`Failed to generate embedding for "${doc.title}": ${error.message}`);
    throw error;
  }
}

// ─── Batch Embedding Generation ────────────────────────────────────────────────

/**
 * Generate embeddings for multiple documents with rate limiting.
 * Returns a Map of index → embedding vector.
 * Failed embeddings are logged but don't block the batch — the Map
 * simply won't contain an entry for the failed index.
 */
export async function generateBatchEmbeddings(
  docs: VectorDocumentInput[],
  delayMs: number = DEFAULT_EMBEDDING_DELAY_MS
): Promise<Map<number, number[]>> {
  const results = new Map<number, number[]>();
  logger.info(`Generating embeddings for ${docs.length} documents (delay: ${delayMs}ms)`);

  for (let i = 0; i < docs.length; i++) {
    try {
      const embedding = await generateDocumentEmbedding(docs[i]);
      results.set(i, embedding);
    } catch (error: any) {
      logger.error(
        `[${i + 1}/${docs.length}] Embedding failed for "${docs[i].title}": ${error.message}`
      );
      // Continue with remaining documents
    }

    // Rate limit between API calls (skip after last)
    if (i < docs.length - 1) {
      await delay(delayMs);
    }
  }

  logger.info(
    `Batch complete: ${results.size}/${docs.length} embeddings generated successfully`
  );
  return results;
}
