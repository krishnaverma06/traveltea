/**
 * Vector Module Constants
 *
 * Centralized configuration values for the vector knowledge layer.
 * Modify these to tune storage, validation, and rate-limiting behavior.
 */

import { VectorDocumentCategory, KnowledgeSourceType } from './vector.types.js';

// ─── Collection & Index ────────────────────────────────────────────────────────

/** MongoDB collection name for vector documents */
export const VECTOR_COLLECTION_NAME = 'vector_documents';

/** Atlas Vector Search index name (must match the index created in Atlas UI) */
export const VECTOR_INDEX_NAME = 'vector_index';

/** Embedding vector dimensions — matches existing EMBEDDING_DIMENSIONS in services/embedding.ts */
export const EMBEDDING_DIMENSIONS = 256;

// ─── Validation Limits ─────────────────────────────────────────────────────────

/** Maximum character length for the content field */
export const MAX_CONTENT_LENGTH = 50_000;

/** Maximum number of tags per document */
export const MAX_TAGS = 30;

/** Maximum number of documents in a single bulk ingestion call */
export const MAX_BATCH_SIZE = 100;

/** Minimum content length to be considered valid */
export const MIN_CONTENT_LENGTH = 20;

/** Maximum title length */
export const MAX_TITLE_LENGTH = 500;

// ─── Rate Limiting ─────────────────────────────────────────────────────────────

/** Delay between embedding API calls (ms) to avoid rate limiting */
export const DEFAULT_EMBEDDING_DELAY_MS = 200;

// ─── Supported Categories ──────────────────────────────────────────────────────

/** Array of all supported category values for iteration and validation */
export const SUPPORTED_CATEGORIES: VectorDocumentCategory[] = Object.values(VectorDocumentCategory);

// ─── Knowledge Source Types ────────────────────────────────────────────────────

/** Array of all supported knowledge source types */
export const KNOWLEDGE_SOURCE_TYPES: KnowledgeSourceType[] = Object.values(KnowledgeSourceType);

/** Minimum number of API results needed to generate a search knowledge document */
export const SEARCH_KNOWLEDGE_MIN_RESULTS = 1;

// ─── Category Display Names ────────────────────────────────────────────────────

/** Human-readable labels for each category */
export const CATEGORY_DISPLAY_NAMES: Record<VectorDocumentCategory, string> = {
  [VectorDocumentCategory.DESTINATION]: 'Destination',
  [VectorDocumentCategory.ATTRACTION]: 'Tourist Attraction',
  [VectorDocumentCategory.RESTAURANT]: 'Restaurant',
  [VectorDocumentCategory.HOTEL]: 'Hotel / Area',
  [VectorDocumentCategory.ACTIVITY]: 'Activity',
  [VectorDocumentCategory.GUIDE]: 'Travel Guide',
  [VectorDocumentCategory.FAQ]: 'FAQ',
  [VectorDocumentCategory.HIDDEN_GEM]: 'Hidden Gem',
  [VectorDocumentCategory.ITINERARY]: 'Sample Itinerary',
  [VectorDocumentCategory.BUDGET_TEMPLATE]: 'Budget Template',
  [VectorDocumentCategory.SEASONAL_INFO]: 'Seasonal Information',
  [VectorDocumentCategory.FESTIVAL]: 'Festival',
  [VectorDocumentCategory.EMERGENCY_INFO]: 'Emergency Information',
  [VectorDocumentCategory.PLANNING_RULE]: 'Travel Planning Rule',
  [VectorDocumentCategory.TRAVEL_TIP]: 'General Travel Tip',
};

