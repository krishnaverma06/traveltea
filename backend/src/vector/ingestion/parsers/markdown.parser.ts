/**
 * Markdown Parser
 *
 * Parses markdown files with YAML-like frontmatter into VectorDocumentInput.
 * Uses a simple regex-based parser — no extra dependencies required.
 *
 * Expected format:
 * ```
 * ---
 * title: Amber Fort
 * category: attraction
 * country: India
 * city: Jaipur
 * subtype: fort
 * tags: [heritage, UNESCO, history]
 * source: manual
 * ---
 * Full markdown content here...
 * ```
 */

import { readFile } from 'fs/promises';
import type { VectorDocumentInput, VectorDocumentCategory } from '../../types/vector.types.js';
import Logger from '../../../utils/logger.js';

const logger = new Logger('MarkdownParser');

// ─── Frontmatter Regex ─────────────────────────────────────────────────────────

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

/**
 * Parse a simple YAML-like frontmatter string into key-value pairs.
 * Supports: strings, numbers, arrays (inline [...] syntax), and booleans.
 */
function parseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value: string | unknown = trimmed.slice(colonIdx + 1).trim();

    // Parse inline arrays: [tag1, tag2, tag3]
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
    // Parse booleans
    else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    // Parse numbers
    else if (!isNaN(Number(value)) && value !== '') value = Number(value);
    // Strip quotes from strings
    else if (typeof value === 'string') {
      value = value.replace(/^['"]|['"]$/g, '');
    }

    result[key] = value;
  }

  return result;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a markdown file with frontmatter into a VectorDocumentInput.
 * The frontmatter provides metadata, and the body becomes the content.
 */
export async function parseMarkdownFile(filePath: string): Promise<VectorDocumentInput[]> {
  logger.info(`Parsing markdown file: ${filePath}`);

  const raw = await readFile(filePath, 'utf-8');
  return parseMarkdownString(raw);
}

/**
 * Parse a markdown string with frontmatter.
 * Returns an array (always single-element for markdown).
 */
export function parseMarkdownString(raw: string): VectorDocumentInput[] {
  const match = raw.match(FRONTMATTER_REGEX);

  if (!match) {
    throw new Error(
      'Markdown must have YAML frontmatter delimited by --- lines'
    );
  }

  const frontmatter = parseFrontmatter(match[1]);
  const content = match[2].trim();

  if (!content) {
    throw new Error('Markdown body (content) is empty');
  }

  const doc: VectorDocumentInput = {
    title: String(frontmatter.title || ''),
    category: String(frontmatter.category || '') as VectorDocumentCategory,
    subtype: frontmatter.subtype ? String(frontmatter.subtype) : undefined,
    country: String(frontmatter.country || ''),
    city: String(frontmatter.city || ''),
    tags: Array.isArray(frontmatter.tags)
      ? frontmatter.tags.map(String)
      : undefined,
    content,
    source: frontmatter.source ? String(frontmatter.source) : 'markdown',
  };

  logger.info(`Parsed markdown document: "${doc.title}"`);
  return [doc];
}
