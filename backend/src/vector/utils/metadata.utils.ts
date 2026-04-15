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

  // Semantic Inference for rich filtering
  const inferred: Partial<IVectorDocumentMetadata> = {};

  if (provided.duration || categoryDefaults.duration) {
    inferred.durationCategory = inferDurationCategory(
      (provided.duration || categoryDefaults.duration) as string
    );
  }

  if (provided.estimatedCost || provided.priceLevel) {
    inferred.budgetTier = inferBudgetTier(
      ((provided.estimatedCost || provided.priceLevel) as string)
    );
  }

  return mergeMetadata(mergeMetadata(provided, inferred), categoryDefaults);
}

// ─── Inference Helpers ─────────────────────────────────────────────────────────

function inferDurationCategory(duration: string): string {
  const d = duration.toLowerCase();
  if (d.includes('hour') || d.includes('min')) return 'Short (< half day)';
  if (d.includes('half day')) return 'Half Day';
  if (d.includes('day') && !d.includes('days')) return 'Full Day';
  if (d.includes('days') || d.includes('week')) return 'Multi-Day';
  return 'Flexible';
}

export function inferBudgetTier(cost: any): string {
  if (!cost) return 'Standard';
  
  // Handle budget object from SavedTrip
  if (typeof cost === 'object') {
    const total = cost.total || 0;
    // Assuming values are often in INR for this project based on seed data
    if (total === 0) return 'Standard';
    if (total <= 15000) return 'Budget';
    if (total <= 50000) return 'Moderate';
    return 'Luxury';
  }

  // Handle string cost
  const c = String(cost).toLowerCase();
  if (c.includes('free') || c === '$' || c.includes('budget') || c.includes('cheap')) return 'Budget';
  if (c === '$$' || c.includes('moderate') || c.includes('mid-range')) return 'Moderate';
  if (c === '$$$' || c === '$$$$' || c.includes('luxury') || c.includes('expensive')) return 'Luxury';
  return 'Standard';
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
