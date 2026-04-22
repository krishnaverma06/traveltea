/**
 * VectorDocument Model
 *
 * Mongoose schema for the vector knowledge base collection.
 * Stores rich travel knowledge documents with vector embeddings
 * for Atlas Vector Search.
 *
 * Follows the same patterns as existing models (Conversation.ts, SavedTrip.js):
 *  - `embedding` field with `select: false` for storage efficiency
 *  - `timestamps: true` for automatic createdAt/updatedAt
 *  - Compound indexes for query performance
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { IVectorDocument, IVectorDocumentMetadata } from '../types/vector.types.js';
import {
  VECTOR_COLLECTION_NAME,
  EMBEDDING_DIMENSIONS,
  SUPPORTED_CATEGORIES,
  KNOWLEDGE_SOURCE_TYPES,
  MAX_CONTENT_LENGTH,
  MAX_TAGS,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_VERSION,
} from '../types/vector.constants.js';

// ─── Mongoose Document Interface ───────────────────────────────────────────────

export interface IVectorDocumentModel extends Omit<IVectorDocument, '_id'>, Document {}

// ─── Schema Definition ─────────────────────────────────────────────────────────

const VectorDocumentMetadataSchema = new Schema<IVectorDocumentMetadata>(
  {
    rating: { type: Number, min: 0, max: 5 },
    priceLevel: { type: String, trim: true },
    bestTimeToVisit: { type: [String], default: undefined },
    duration: { type: String, trim: true },
    difficulty: {
      type: String,
      enum: ['easy', 'moderate', 'hard', 'extreme'],
    },
    currency: { type: String, trim: true },
    languages: { type: [String], default: undefined },
    coordinates: {
      lat: { type: Number },
      lon: { type: Number },
    },
    population: { type: Number },
    phoneNumbers: { type: [String], default: undefined },
    urls: { type: [String], default: undefined },
    openingHours: { type: String, trim: true },
    estimatedCost: { type: String, trim: true },
    travelTypes: { type: [String], default: undefined },

    // ── Extended Metadata (Rich filtering for RAG) ──────────────
    continent: { type: String, trim: true },
    state: { type: String, trim: true },
    timezone: { type: String, trim: true },
    tripStyle: { type: String, trim: true },
    budgetTier: { type: String, trim: true },
    travelSeason: { type: String, trim: true },
    travelCompanions: { type: String, trim: true },
    durationCategory: { type: String, trim: true },
    destinationType: { type: String, trim: true },
    activityTypes: { type: [String], default: undefined },
  },
  { _id: false, strict: false } // strict: false allows extra metadata keys
);

const VectorDocumentSchema = new Schema<IVectorDocumentModel>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    category: {
      type: String,
      required: true,
      enum: SUPPORTED_CATEGORIES,
      index: true,
    },
    subtype: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    city: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= MAX_TAGS,
        message: `Tags array cannot exceed ${MAX_TAGS} items`,
      },
    },
    content: {
      type: String,
      required: true,
      maxlength: MAX_CONTENT_LENGTH,
    },
    metadata: {
      type: VectorDocumentMetadataSchema,
      default: {},
    },
    source: {
      type: String,
      required: true,
      trim: true,
      default: 'manual',
    },
    embedding: {
      type: [Number],
      select: false, // Exclude from default queries (large array)
      validate: {
        validator: (v: number[]) => v.length === EMBEDDING_DIMENSIONS,
        message: `Embedding must be exactly ${EMBEDDING_DIMENSIONS} dimensions`,
      },
    },
    contentHash: {
      type: String,
      index: true,
    },

    // ── Dynamic Knowledge Fields ─────────────────────────────────────────────
    // All optional with defaults — backward compatible with existing seed data.

    sourceType: {
      type: String,
      enum: KNOWLEDGE_SOURCE_TYPES,
      default: 'global_knowledge',
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    tripId: {
      type: Schema.Types.ObjectId,
      ref: 'SavedTrip',
      default: null,
    },
    searchCount: {
      type: Number,
      default: 0,
    },
    lastSearched: {
      type: Date,
      default: null,
    },
    popularityScore: {
      type: Number,
      default: 0,
    },
    generatedFrom: {
      type: String,
      trim: true,
    },
    privacy: {
      type: String,
      enum: ['public', 'private'],
      default: 'public',
    },
    version: {
      type: Number,
      default: 1,
    },

    // ── Chunking Information ──────────────
    chunkType: {
      type: String,
      index: true,
      default: null,
    },
    chunkIndex: {
      type: Number,
      default: null,
    },
    totalChunks: {
      type: Number,
      default: null,
    },

    // ── Embedding Metadata ──────────────
    embeddingModel: {
      type: String,
      default: DEFAULT_EMBEDDING_MODEL,
    },
    embeddingVersion: {
      type: String,
      default: DEFAULT_EMBEDDING_VERSION,
    },
    embeddingDimension: {
      type: Number,
      default: EMBEDDING_DIMENSIONS,
    },
    embeddingCreatedAt: {
      type: Date,
      default: Date.now,
    },

    // ── Semantic Relationships ──────────────
    relatedDestinations: { type: [String], default: [] },
    relatedCountries: { type: [String], default: [] },
    relatedActivities: { type: [String], default: [] },
    relatedTripStyles: { type: [String], default: [] },
    relatedCategories: { type: [String], default: [] },
    parentDocument: {
      type: Schema.Types.ObjectId,
      ref: 'VectorDocument',
      default: null,
      index: true, // Important for chunk retrieval
    },
    childDocuments: {
      type: [{ type: Schema.Types.ObjectId, ref: 'VectorDocument' }],
      default: [],
    },

    // ── Vector Lifecycle Management ──────────────
    lastAccessed: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    archived: {
      type: Boolean,
      default: false,
      index: true,
    },
    accessCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: VECTOR_COLLECTION_NAME,
  }
);

// ─── Indexes ───────────────────────────────────────────────────────────────────

// Compound unique index to prevent duplicate documents
// Includes sourceType so the same destination can exist in global, search, and trip layers.
// Includes userId so two different users' (or two trips') same-named documents don't
// collide — global/search-knowledge docs share userId: null, which still partitions
// correctly since Mongo treats null as a real value for uniqueness purposes here.
VectorDocumentSchema.index(
  { title: 1, category: 1, country: 1, city: 1, sourceType: 1, userId: 1 },
  { unique: true }
);

// Compound index for filtered queries (category + location)
VectorDocumentSchema.index({ category: 1, country: 1, city: 1 });

// Text index for basic text search fallback
VectorDocumentSchema.index({ title: 'text', content: 'text' });

// Tags index for tag-based filtering
VectorDocumentSchema.index({ tags: 1 });

// Source type + user for user-specific knowledge queries
VectorDocumentSchema.index({ sourceType: 1, userId: 1 });

// Trip reference lookup (sparse — most docs don't have tripId)
VectorDocumentSchema.index({ tripId: 1 }, { sparse: true });

// Popularity ranking within a source type
VectorDocumentSchema.index({ sourceType: 1, popularityScore: -1 });

// Vector Lifecycle index
VectorDocumentSchema.index({ archived: 1, expiresAt: 1 });

// Chunk retrieval index (find all chunks for a parent trip)
VectorDocumentSchema.index({ parentDocument: 1, chunkIndex: 1 });

// ─── Model Export ──────────────────────────────────────────────────────────────

export const VectorDocument = mongoose.model<IVectorDocumentModel>(
  'VectorDocument',
  VectorDocumentSchema
);
