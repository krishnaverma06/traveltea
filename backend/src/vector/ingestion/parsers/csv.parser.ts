/**
 * CSV Parser
 *
 * Parses CSV files into VectorDocumentInput objects.
 * Uses the csv-parse library for robust CSV handling.
 *
 * Expected CSV columns (header row required):
 *   title, category, subtype, country, city, tags, content, source
 *
 * The "tags" column should contain pipe-separated values (e.g., "beach|sunset|goa").
 */

import { readFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';
import type { VectorDocumentInput, VectorDocumentCategory } from '../../types/vector.types.js';
import Logger from '../../../utils/logger.js';

const logger = new Logger('CSVParser');

// ─── Column Mapping ────────────────────────────────────────────────────────────

interface CSVRow {
  title?: string;
  category?: string;
  subtype?: string;
  country?: string;
  city?: string;
  tags?: string;
  content?: string;
  source?: string;
  [key: string]: string | undefined;
}

/**
 * Convert a CSV row into a VectorDocumentInput.
 */
function rowToInput(row: CSVRow, rowIndex: number): VectorDocumentInput {
  if (!row.title || !row.category || !row.country || !row.city || !row.content) {
    throw new Error(
      `Row ${rowIndex + 1}: Missing required columns (title, category, country, city, content)`
    );
  }

  return {
    title: row.title.trim(),
    category: row.category.trim() as VectorDocumentCategory,
    subtype: row.subtype?.trim() || undefined,
    country: row.country.trim(),
    city: row.city.trim(),
    tags: row.tags
      ? row.tags.split('|').map((t) => t.trim()).filter(Boolean)
      : [],
    content: row.content.trim(),
    source: row.source?.trim() || 'csv',
  };
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a CSV file into an array of VectorDocumentInput objects.
 */
export async function parseCSVFile(filePath: string): Promise<VectorDocumentInput[]> {
  logger.info(`Parsing CSV file: ${filePath}`);

  const raw = await readFile(filePath, 'utf-8');
  return parseCSVString(raw);
}

/**
 * Parse a CSV string into VectorDocumentInput objects.
 */
export function parseCSVString(raw: string): VectorDocumentInput[] {
  const records: CSVRow[] = parse(raw, {
    columns: true,       // Use first row as headers
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  });

  const documents: VectorDocumentInput[] = [];

  for (let i = 0; i < records.length; i++) {
    try {
      documents.push(rowToInput(records[i], i));
    } catch (error: any) {
      logger.warn(`Skipping CSV row ${i + 1}: ${error.message}`);
    }
  }

  logger.info(`Parsed ${documents.length} documents from CSV`);
  return documents;
}
