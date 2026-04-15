/**
 * Ingestion Pipeline
 *
 * Orchestrates the full document ingestion workflow:
 *   1. Parse → Source-specific parser (JSON, Markdown, CSV, manual)
 *   2. Validate → Zod validation per document
 *   3. Sanitize → Clean content text
 *   4. Deduplicate → Content hash check against DB
 *   5. Generate metadata → Auto-tags, auto-metadata
 *   6. Generate embeddings → Batch with rate limiting
 *   7. Persist → Bulk upsert via repository
 *
 * Each step is isolated — failures in one document don't block others.
 */

import type {
  VectorDocumentInput,
  BulkIngestionResult,
  IngestionSource,
} from '../types/vector.types.js';
import { safeValidateVectorDocument } from '../validators/vector.validators.js';
import { sanitizeContent } from '../utils/content.utils.js';
import { generateBatchEmbeddings } from '../services/vector-embedding.service.js';
import * as repository from '../repositories/vector.repository.js';
import { parseJSONFile, parseJSONArray } from './parsers/json.parser.js';
import { parseMarkdownFile } from './parsers/markdown.parser.js';
import { parseCSVFile } from './parsers/csv.parser.js';
import Logger from '../../utils/logger.js';

const logger = new Logger('IngestionPipeline');

// ─── Pipeline Result ───────────────────────────────────────────────────────────

interface PipelineOptions {
  /** Skip embedding generation (useful for testing) */
  skipEmbeddings?: boolean;
  /** Custom delay between embedding API calls (ms) */
  embeddingDelayMs?: number;
  /** Skip duplicate detection */
  skipDedup?: boolean;
}

// ─── Core Pipeline ─────────────────────────────────────────────────────────────

/**
 * Run the full ingestion pipeline on an array of raw document inputs.
 * This is the main entry point — all source-specific methods delegate here.
 */
async function runPipeline(
  rawInputs: unknown[],
  source: IngestionSource,
  options: PipelineOptions = {}
): Promise<BulkIngestionResult> {
  const startTime = Date.now();
  logger.info(`Starting ingestion pipeline: ${rawInputs.length} documents from ${source}`);

  const result: BulkIngestionResult = {
    total: rawInputs.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    duration: 0,
  };

  // ── Step 1: Validate ───────────────────────────────────────────────────────
  const validatedDocs: VectorDocumentInput[] = [];
  const validIndexMap: number[] = []; // Maps validated index → original index

  for (let i = 0; i < rawInputs.length; i++) {
    const validation = safeValidateVectorDocument(rawInputs[i]);
    if (validation.success && validation.data) {
      validatedDocs.push(validation.data);
      validIndexMap.push(i);
    } else {
      result.failed++;
      const title =
        (rawInputs[i] as Record<string, unknown>)?.title as string || `Document #${i + 1}`;
      result.errors.push({ title, error: validation.error || 'Validation failed' });
      logger.warn(`Validation failed for "${title}": ${validation.error}`);
    }
  }

  logger.info(`Validated: ${validatedDocs.length}/${rawInputs.length} passed`);

  if (validatedDocs.length === 0) {
    result.duration = Date.now() - startTime;
    return result;
  }

  // ── Step 2: Sanitize content ───────────────────────────────────────────────
  for (const doc of validatedDocs) {
    doc.content = sanitizeContent(doc.content);
    // Ensure source is set
    if (!doc.source || doc.source === 'manual') {
      doc.source = source;
    }
  }

  // ── Step 3: Generate embeddings ────────────────────────────────────────────
  let embeddings: Map<number, number[]>;

  if (options.skipEmbeddings) {
    logger.info('Skipping embedding generation (option set)');
    // Create dummy embeddings (256 zeros) for testing
    embeddings = new Map();
    for (let i = 0; i < validatedDocs.length; i++) {
      embeddings.set(i, new Array(256).fill(0));
    }
  } else {
    embeddings = await generateBatchEmbeddings(
      validatedDocs,
      options.embeddingDelayMs
    );
  }

  // ── Step 4: Persist via repository ─────────────────────────────────────────
  const bulkResult = await repository.bulkInsert(validatedDocs, embeddings);

  // Merge bulk result into pipeline result
  result.inserted += bulkResult.inserted;
  result.updated += bulkResult.updated;
  result.skipped += bulkResult.skipped;
  result.failed += bulkResult.failed;
  result.errors.push(...bulkResult.errors);

  result.duration = Date.now() - startTime;

  logger.info(
    `Pipeline complete: ${result.inserted} inserted, ${result.updated} updated, ` +
    `${result.skipped} skipped, ${result.failed} failed (${result.duration}ms)`
  );

  return result;
}

// ─── Source-Specific Entry Points ──────────────────────────────────────────────

/**
 * Ingest documents from a JSON file or an in-memory array.
 */
export async function ingestFromJSON(
  filePathOrData: string | unknown[],
  options?: PipelineOptions
): Promise<BulkIngestionResult> {
  const rawInputs = typeof filePathOrData === 'string'
    ? await parseJSONFile(filePathOrData)
    : parseJSONArray(filePathOrData);

  return runPipeline(rawInputs, 'json', options);
}

/**
 * Ingest a document from a Markdown file with frontmatter.
 */
export async function ingestFromMarkdown(
  filePath: string,
  options?: PipelineOptions
): Promise<BulkIngestionResult> {
  const rawInputs = await parseMarkdownFile(filePath);
  return runPipeline(rawInputs, 'markdown', options);
}

/**
 * Ingest documents from a CSV file.
 */
export async function ingestFromCSV(
  filePath: string,
  options?: PipelineOptions
): Promise<BulkIngestionResult> {
  const rawInputs = await parseCSVFile(filePath);
  return runPipeline(rawInputs, 'csv', options);
}

/**
 * Ingest manually constructed document objects.
 */
export async function ingestManual(
  docs: VectorDocumentInput[],
  options?: PipelineOptions
): Promise<BulkIngestionResult> {
  return runPipeline(docs, 'manual', options);
}
