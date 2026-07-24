/**
 * JSON Parser
 *
 * Parses JSON files or raw arrays into VectorDocumentInput objects.
 * Supports both file paths and in-memory arrays.
 */

import { readFile } from 'fs/promises';
import type { VectorDocumentInput } from '../../types/vector.types.js';
import Logger from '../../../utils/logger.js';

const logger = new Logger('JSONParser');

/**
 * Parse a JSON file containing an array of vector document inputs.
 */
export async function parseJSONFile(filePath: string): Promise<VectorDocumentInput[]> {
  logger.info(`Parsing JSON file: ${filePath}`);

  const raw = await readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`JSON file must contain an array of documents. Got: ${typeof parsed}`);
  }

  logger.info(`Parsed ${parsed.length} documents from ${filePath}`);
  return parsed as VectorDocumentInput[];
}

/**
 * Parse an in-memory array of raw objects into VectorDocumentInput objects.
 * This is a passthrough — validation is handled by the ingestion pipeline.
 */
export function parseJSONArray(data: unknown[]): VectorDocumentInput[] {
  if (!Array.isArray(data)) {
    throw new Error(`Expected an array of documents. Got: ${typeof data}`);
  }
  return data as VectorDocumentInput[];
}
