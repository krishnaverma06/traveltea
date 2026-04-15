/**
 * Vector Module — Barrel Export
 *
 * Central entry point for the entire vector knowledge layer.
 * Import from 'vector/index.js' to access all public APIs.
 *
 * Usage:
 *   import { VectorDocument, VectorDocumentCategory, ingestFromJSON } from '../vector/index.js';
 */

// ─── Types & Constants ─────────────────────────────────────────────────────────

export {
  VectorDocumentCategory,
  KnowledgeSourceType,
  ChunkType,
  type IVectorDocument,
  type IVectorDocumentMetadata,
  type VectorDocumentInput,
  type VectorSearchResult,
  type VectorSearchFilter,
  type IngestionSource,
  type IngestionResult,
  type BulkIngestionResult,
  type SearchKnowledgeInput,
  type TripKnowledgeInput,
} from './types/vector.types.js';

export {
  VECTOR_COLLECTION_NAME,
  VECTOR_INDEX_NAME,
  EMBEDDING_DIMENSIONS,
  SUPPORTED_CATEGORIES,
  CATEGORY_DISPLAY_NAMES,
  KNOWLEDGE_SOURCE_TYPES,
  SEARCH_KNOWLEDGE_MIN_RESULTS,
  MAX_CONTENT_LENGTH,
  MAX_TAGS,
  MAX_BATCH_SIZE,
} from './types/vector.constants.js';

// ─── Model ─────────────────────────────────────────────────────────────────────

export { VectorDocument, type IVectorDocumentModel } from './models/VectorDocument.js';

// ─── Validators ────────────────────────────────────────────────────────────────

export {
  validateVectorDocument,
  validateBulkIngestion,
  safeValidateVectorDocument,
  vectorDocumentInputSchema,
  bulkIngestionInputSchema,
} from './validators/vector.validators.js';

// ─── Utilities ─────────────────────────────────────────────────────────────────

export {
  generateContentHash,
  buildEmbeddingText,
  sanitizeContent,
  generateAutoTags,
} from './utils/content.utils.js';

export {
  generateMetadata,
  mergeMetadata,
} from './utils/metadata.utils.js';

// ─── Services ──────────────────────────────────────────────────────────────────

export {
  generateDocumentEmbedding,
  generateBatchEmbeddings,
} from './services/vector-embedding.service.js';

export * as searchKnowledgeService from './services/search-knowledge.service.js';
export * as tripKnowledgeService from './services/trip-knowledge.service.js';
export * as userProfileService from './services/user-profile.service.js';

// ─── Repository ────────────────────────────────────────────────────────────────

export * as vectorRepository from './repositories/vector.repository.js';

// ─── Ingestion Pipeline ────────────────────────────────────────────────────────

export {
  ingestFromJSON,
  ingestFromMarkdown,
  ingestFromCSV,
  ingestManual,
} from './ingestion/ingestion.pipeline.js';
