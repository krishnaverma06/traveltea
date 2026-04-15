/**
 * Metadata Utilities
 *
 * Auto-generation and merging of structured metadata
 * for vector documents based on category and content.
 */

import type {
  VectorDocumentInput,
  IVectorDocumentMetadata,
  VectorDocumentCategory,
} from '../types/vector.types.js';

// ─── Category-Specific Defaults ────────────────────────────────────────────────

/**
 * Default metadata values by category.
 * Applied when the document input doesn't provide specific metadata fields.
 */
const CATEGORY_METADATA_DEFAULTS: Partial<
  Record<VectorDocumentCategory, Partial<IVectorDocumentMetadata>>
> = {
  destination: {
    travelTypes: ['leisure', 'cultural', 'adventure', 'family'],
  },
  attraction: {
    duration: '1-2 hours',
    travelTypes: ['cultural', 'leisure'],
  },
  restaurant: {
    duration: '1-1.5 hours',
    travelTypes: ['leisure', 'cultural'],
  },
  hotel: {
    travelTypes: ['leisure', 'business', 'family'],
  },
  activity: {
    travelTypes: ['adventure', 'leisure'],
  },
  guide: {
    travelTypes: ['leisure', 'cultural', 'adventure', 'solo'],
  },
  emergency_info: {
    travelTypes: ['leisure', 'business', 'adventure', 'cultural', 'family', 'solo'],
  },
  budget_template: {
    travelTypes: ['leisure', 'adventure', 'solo'],
  },
};

// ─── Metadata Generation ───────────────────────────────────────────────────────

/**
 * Generate metadata for a vector document based on its category and content.
 * Fills in sensible defaults for fields not already provided.
 */
export function generateMetadata(
  doc: VectorDocumentInput
): IVectorDocumentMetadata {
  const categoryDefaults = CATEGORY_METADATA_DEFAULTS[doc.category] || {};
  const provided = doc.metadata || {};

  return mergeMetadata(provided, categoryDefaults);
}

// ─── Metadata Merging ──────────────────────────────────────────────────────────

/**
 * Merge user-provided metadata with auto-generated defaults.
 * User-provided values always take precedence.
 */
export function mergeMetadata(
  existing: Partial<IVectorDocumentMetadata>,
  generated: Partial<IVectorDocumentMetadata>
): IVectorDocumentMetadata {
  const merged: IVectorDocumentMetadata = {};

  // Collect all keys from both objects
  const allKeys = new Set([
    ...Object.keys(generated),
    ...Object.keys(existing),
  ]);

  for (const key of allKeys) {
    const existingVal = (existing as Record<string, unknown>)[key];
    const generatedVal = (generated as Record<string, unknown>)[key];

    // User-provided value wins
    if (existingVal !== undefined && existingVal !== null) {
      (merged as Record<string, unknown>)[key] = existingVal;
    } else if (generatedVal !== undefined && generatedVal !== null) {
      (merged as Record<string, unknown>)[key] = generatedVal;
    }
  }

  return merged;
}
