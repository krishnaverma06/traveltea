/**
 * Content Utilities
 *
 * Helper functions for content hashing, embedding text construction,
 * sanitization, and auto-tag generation.
 */

import { createHash } from 'crypto';
import type { VectorDocumentInput } from '../types/vector.types.js';
import { CATEGORY_DISPLAY_NAMES } from '../types/vector.constants.js';

// ─── Content Hashing ───────────────────────────────────────────────────────────

/**
 * Generate a SHA-256 hash of the content string.
 * Used for duplicate detection — two documents with identical content
 * will produce the same hash.
 */
export function generateContentHash(content: string): string {
  return createHash('sha256').update(content.trim()).digest('hex');
}

// ─── Embedding Text Construction ───────────────────────────────────────────────

/**
 * Build a rich text string from a document input for embedding generation.
 * Combines structured fields into a single, semantically meaningful text
 * that captures the document's essence for vector similarity search.
 */
export function buildEmbeddingText(doc: VectorDocumentInput): string {
  const parts: string[] = [];

  // Category context
  const categoryLabel = CATEGORY_DISPLAY_NAMES[doc.category] || doc.category;
  parts.push(`[${categoryLabel}]`);

  // Title
  parts.push(doc.title);

  // Location context
  if (doc.city && doc.country) {
    parts.push(`in ${doc.city}, ${doc.country}`);
  } else if (doc.city) {
    parts.push(`in ${doc.city}`);
  } else if (doc.country) {
    parts.push(`in ${doc.country}`);
  }

  // Subtype
  if (doc.subtype) {
    parts.push(`(${doc.subtype})`);
  }

  // Tags add semantic signal
  if (doc.tags && doc.tags.length > 0) {
    parts.push(`Tags: ${doc.tags.join(', ')}`);
  }

  // Main content (the bulk of the embedding signal)
  parts.push(doc.content);

  return parts.join('. ').trim();
}

// ─── Content Sanitization ──────────────────────────────────────────────────────

/**
 * Sanitize text content by trimming, collapsing whitespace,
 * and removing control characters.
 */
export function sanitizeContent(text: string): string {
  return text
    // Remove control characters (except newlines and tabs)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Collapse multiple spaces into one
    .replace(/ {2,}/g, ' ')
    // Collapse multiple newlines into at most two
    .replace(/\n{3,}/g, '\n\n')
    // Trim
    .trim();
}

// ─── Auto-Tag Generation ───────────────────────────────────────────────────────

/**
 * Generate additional tags from the document's category, subtype, and content.
 * These supplement any user-provided tags to improve searchability.
 */
export function generateAutoTags(doc: VectorDocumentInput): string[] {
  const autoTags = new Set<string>();

  // Add category as a tag
  autoTags.add(doc.category.replace(/_/g, ' '));

  // Add subtype if present
  if (doc.subtype) {
    autoTags.add(doc.subtype.toLowerCase());
  }

  // Add city and country as tags
  if (doc.city) autoTags.add(doc.city.toLowerCase());
  if (doc.country) autoTags.add(doc.country.toLowerCase());

  // Merge with existing tags (deduplicated)
  const existingTags = (doc.tags || []).map((t) => t.toLowerCase());
  for (const tag of existingTags) {
    autoTags.add(tag);
  }

  return Array.from(autoTags);
}
