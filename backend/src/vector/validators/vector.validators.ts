/**
 * Vector Document Validators
 *
 * Zod-based validation schemas for vector document inputs.
 * Ensures data integrity before documents enter the ingestion pipeline.
 */

import { z } from 'zod';
import { VectorDocumentCategory } from '../types/vector.types.js';
import {
  SUPPORTED_CATEGORIES,
  MAX_CONTENT_LENGTH,
  MIN_CONTENT_LENGTH,
  MAX_TAGS,
  MAX_BATCH_SIZE,
  MAX_TITLE_LENGTH,
} from '../types/vector.constants.js';

// ─── Base Schemas ──────────────────────────────────────────────────────────────

const metadataSchema = z.object({
  rating: z.number().min(0).max(5).optional(),
  priceLevel: z.string().trim().optional(),
  bestTimeToVisit: z.array(z.string().trim()).optional(),
  duration: z.string().trim().optional(),
  difficulty: z.enum(['easy', 'moderate', 'hard', 'extreme']).optional(),
  currency: z.string().trim().optional(),
  languages: z.array(z.string().trim()).optional(),
  coordinates: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }).optional(),
  population: z.number().int().positive().optional(),
  phoneNumbers: z.array(z.string().trim()).optional(),
  urls: z.array(z.string().url()).optional(),
  openingHours: z.string().trim().optional(),
  estimatedCost: z.string().trim().optional(),
  travelTypes: z.array(z.string().trim()).optional(),
}).passthrough(); // Allow extra metadata keys

// ─── Document Input Schema ─────────────────────────────────────────────────────

export const vectorDocumentInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(MAX_TITLE_LENGTH, `Title must be at most ${MAX_TITLE_LENGTH} characters`),
  category: z.nativeEnum(VectorDocumentCategory, {
    errorMap: () => ({
      message: `Category must be one of: ${SUPPORTED_CATEGORIES.join(', ')}`,
    }),
  }),
  subtype: z.string().trim().optional(),
  country: z
    .string()
    .trim()
    .min(1, 'Country is required'),
  city: z
    .string()
    .trim()
    .min(1, 'City is required'),
  tags: z
    .array(z.string().trim().min(1))
    .max(MAX_TAGS, `Tags array cannot exceed ${MAX_TAGS} items`)
    .optional()
    .default([]),
  content: z
    .string()
    .min(MIN_CONTENT_LENGTH, `Content must be at least ${MIN_CONTENT_LENGTH} characters`)
    .max(MAX_CONTENT_LENGTH, `Content must be at most ${MAX_CONTENT_LENGTH} characters`),
  metadata: metadataSchema.optional().default({}),
  source: z.string().trim().optional().default('manual'),
});

// ─── Bulk Ingestion Schema ─────────────────────────────────────────────────────

export const bulkIngestionInputSchema = z
  .array(vectorDocumentInputSchema)
  .min(1, 'At least one document is required')
  .max(MAX_BATCH_SIZE, `Cannot ingest more than ${MAX_BATCH_SIZE} documents at once`);

// ─── Inferred Types ────────────────────────────────────────────────────────────

export type ValidatedVectorDocumentInput = z.infer<typeof vectorDocumentInputSchema>;
export type ValidatedBulkIngestionInput = z.infer<typeof bulkIngestionInputSchema>;

// ─── Validation Functions ──────────────────────────────────────────────────────

/**
 * Validate a single vector document input.
 * Returns the parsed/cleaned data or throws a ZodError.
 */
export function validateVectorDocument(input: unknown): ValidatedVectorDocumentInput {
  return vectorDocumentInputSchema.parse(input);
}

/**
 * Validate an array of vector document inputs for bulk ingestion.
 * Returns the parsed/cleaned array or throws a ZodError.
 */
export function validateBulkIngestion(input: unknown): ValidatedBulkIngestionInput {
  return bulkIngestionInputSchema.parse(input);
}

/**
 * Safe validation — returns a result object instead of throwing.
 */
export function safeValidateVectorDocument(input: unknown): {
  success: boolean;
  data?: ValidatedVectorDocumentInput;
  error?: string;
} {
  const result = vectorDocumentInputSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errorMessages = result.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  return { success: false, error: errorMessages };
}
