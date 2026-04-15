/**
 * Vector Document Repository
 *
 * Data access layer for vector documents. Provides CRUD operations,
 * bulk ingestion, duplicate detection, and filtered queries.
 * All database interactions go through this repository.
 */

import { VectorDocument, type IVectorDocumentModel } from '../models/VectorDocument.js';
import type {
  VectorDocumentInput,
  BulkIngestionResult,
  VectorDocumentCategory,
} from '../types/vector.types.js';
import { generateContentHash, generateAutoTags } from '../utils/content.utils.js';
import { generateMetadata } from '../utils/metadata.utils.js';
import { generateDocumentEmbedding } from '../services/vector-embedding.service.js';
import Logger from '../../utils/logger.js';

const logger = new Logger('VectorRepo');

// ─── Insert ────────────────────────────────────────────────────────────────────

/**
 * Insert a single vector document.
 * Generates content hash, auto-tags, metadata, and embedding before saving.
 * Throws if a duplicate is detected (by compound unique index).
 */
export async function insert(
  input: VectorDocumentInput,
  embedding?: number[]
): Promise<IVectorDocumentModel> {
  const contentHash = generateContentHash(input.content);
  const tags = generateAutoTags(input);
  const metadata = generateMetadata(input);

  // Generate embedding if not provided
  const docEmbedding = embedding || await generateDocumentEmbedding(input);

  const doc = new VectorDocument({
    title: input.title,
    category: input.category,
    subtype: input.subtype,
    country: input.country,
    city: input.city,
    tags,
    content: input.content,
    metadata,
    source: input.source || 'manual',
    embedding: docEmbedding,
    contentHash,
  });

  try {
    const saved = await doc.save();
    logger.info(`Inserted: "${input.title}" (${input.category})`);
    return saved;
  } catch (error: any) {
    if (error.code === 11000) {
      logger.warn(`Duplicate detected for "${input.title}" — skipping insert`);
      throw new Error(`Duplicate document: "${input.title}" in ${input.city}, ${input.country}`);
    }
    throw error;
  }
}

// ─── Bulk Insert ───────────────────────────────────────────────────────────────

/**
 * Bulk insert multiple vector documents with per-document error handling.
 * Uses upsert to handle duplicates gracefully.
 */
export async function bulkInsert(
  inputs: VectorDocumentInput[],
  embeddings: Map<number, number[]>
): Promise<BulkIngestionResult> {
  const startTime = Date.now();
  const result: BulkIngestionResult = {
    total: inputs.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    duration: 0,
  };

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const embedding = embeddings.get(i);

    if (!embedding) {
      result.skipped++;
      result.errors.push({
        title: input.title,
        error: 'Embedding generation failed — skipped',
      });
      continue;
    }

    try {
      const upsertResult = await upsert(input, embedding);
      // Check if it was an insert or update based on timestamps
      if (
        upsertResult.createdAt &&
        upsertResult.updatedAt &&
        upsertResult.createdAt.getTime() === upsertResult.updatedAt.getTime()
      ) {
        result.inserted++;
      } else {
        result.updated++;
      }
    } catch (error: any) {
      result.failed++;
      result.errors.push({ title: input.title, error: error.message });
      logger.error(`Failed to ingest "${input.title}": ${error.message}`);
    }
  }

  result.duration = Date.now() - startTime;
  return result;
}

// ─── Update ────────────────────────────────────────────────────────────────────

/**
 * Partially update a vector document by ID.
 * If content changes, regenerates the content hash and embedding.
 */
export async function update(
  id: string,
  partial: Partial<VectorDocumentInput>
): Promise<IVectorDocumentModel | null> {
  const updateFields: Record<string, unknown> = { ...partial };

  // Regenerate hash and embedding if content changed
  if (partial.content) {
    updateFields.contentHash = generateContentHash(partial.content);
    // Build a temp input to generate embedding
    const existing = await VectorDocument.findById(id);
    if (existing) {
      const fullInput: VectorDocumentInput = {
        title: partial.title || existing.title,
        category: (partial.category || existing.category) as VectorDocumentCategory,
        country: partial.country || existing.country,
        city: partial.city || existing.city,
        content: partial.content,
        source: partial.source || existing.source,
      };
      updateFields.embedding = await generateDocumentEmbedding(fullInput);
    }
  }

  const updated = await VectorDocument.findByIdAndUpdate(id, updateFields, {
    new: true,
    runValidators: true,
  });

  if (updated) {
    logger.info(`Updated: "${updated.title}" (${id})`);
  } else {
    logger.warn(`Update failed — document not found: ${id}`);
  }

  return updated;
}

// ─── Upsert ────────────────────────────────────────────────────────────────────

/**
 * Insert or update a document by its compound key (title, category, country, city).
 * If the document exists, updates its content, tags, metadata, and embedding.
 */
export async function upsert(
  input: VectorDocumentInput,
  embedding?: number[]
): Promise<IVectorDocumentModel> {
  const contentHash = generateContentHash(input.content);
  const tags = generateAutoTags(input);
  const metadata = generateMetadata(input);
  const docEmbedding = embedding || await generateDocumentEmbedding(input);

  const filter = {
    title: input.title,
    category: input.category,
    country: input.country,
    city: input.city,
  };

  const upsertData = {
    ...filter,
    subtype: input.subtype,
    tags,
    content: input.content,
    metadata,
    source: input.source || 'manual',
    embedding: docEmbedding,
    contentHash,
  };

  const doc = await VectorDocument.findOneAndUpdate(
    filter,
    { $set: upsertData },
    { upsert: true, new: true, runValidators: true }
  );

  logger.debug(`Upserted: "${input.title}" (${input.category})`);
  return doc;
}

// ─── Delete ────────────────────────────────────────────────────────────────────

/**
 * Delete a single document by ID.
 */
export async function deleteById(id: string): Promise<boolean> {
  const result = await VectorDocument.findByIdAndDelete(id);
  if (result) {
    logger.info(`Deleted: "${result.title}" (${id})`);
    return true;
  }
  logger.warn(`Delete failed — document not found: ${id}`);
  return false;
}

/**
 * Delete multiple documents matching a filter.
 * Returns the count of deleted documents.
 */
export async function deleteByFilter(
  filter: Record<string, unknown>
): Promise<number> {
  const result = await VectorDocument.deleteMany(filter);
  logger.info(`Deleted ${result.deletedCount} documents by filter`);
  return result.deletedCount;
}

// ─── Read ──────────────────────────────────────────────────────────────────────

/**
 * Find a document by ID. Embedding is excluded by default.
 */
export async function findById(
  id: string,
  includeEmbedding = false
): Promise<IVectorDocumentModel | null> {
  const query = VectorDocument.findById(id);
  if (includeEmbedding) query.select('+embedding');
  return query.exec();
}

/**
 * Find all documents in a specific category.
 */
export async function findByCategory(
  category: VectorDocumentCategory
): Promise<IVectorDocumentModel[]> {
  return VectorDocument.find({ category }).sort({ title: 1 }).exec();
}

/**
 * Find documents by country and optional city.
 */
export async function findByLocation(
  country: string,
  city?: string
): Promise<IVectorDocumentModel[]> {
  const filter: Record<string, string> = { country };
  if (city) filter.city = city;
  return VectorDocument.find(filter).sort({ category: 1, title: 1 }).exec();
}

// ─── Duplicate Detection ───────────────────────────────────────────────────────

/**
 * Find potential duplicates of a document by content hash or compound key.
 */
export async function findDuplicates(
  input: VectorDocumentInput
): Promise<IVectorDocumentModel[]> {
  const contentHash = generateContentHash(input.content);

  return VectorDocument.find({
    $or: [
      { contentHash },
      {
        title: input.title,
        category: input.category,
        country: input.country,
        city: input.city,
      },
    ],
  }).exec();
}

// ─── Count ─────────────────────────────────────────────────────────────────────

/**
 * Count documents, optionally filtered.
 */
export async function count(
  filter?: Record<string, unknown>
): Promise<number> {
  return VectorDocument.countDocuments(filter || {}).exec();
}

/**
 * Get count of documents grouped by category.
 */
export async function countByCategory(): Promise<
  Array<{ category: string; count: number }>
> {
  return VectorDocument.aggregate([
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $project: { category: '$_id', count: 1, _id: 0 } },
    { $sort: { category: 1 } },
  ]).exec();
}
