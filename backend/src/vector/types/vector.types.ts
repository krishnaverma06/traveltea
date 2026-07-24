/**
 * Vector Document Types
 *
 * Core type definitions for the MongoDB Atlas Vector Search knowledge layer.
 * These types define the shape of vector documents, metadata, search results,
 * and ingestion pipeline contracts.
 */

// ─── Document Categories ───────────────────────────────────────────────────────

/**
 * All supported knowledge document categories.
 * Each category represents a distinct type of travel knowledge.
 */
export enum VectorDocumentCategory {
  DESTINATION = 'destination',
  ATTRACTION = 'attraction',
  RESTAURANT = 'restaurant',
  HOTEL = 'hotel',
  ACTIVITY = 'activity',
  GUIDE = 'guide',
  FAQ = 'faq',
  HIDDEN_GEM = 'hidden_gem',
  ITINERARY = 'itinerary',
  BUDGET_TEMPLATE = 'budget_template',
  SEASONAL_INFO = 'seasonal_info',
  FESTIVAL = 'festival',
  EMERGENCY_INFO = 'emergency_info',
  PLANNING_RULE = 'planning_rule',
  TRAVEL_TIP = 'travel_tip',
}

// ─── Knowledge Source Types ────────────────────────────────────────────────────

/**
 * Identifies the origin of a vector document.
 * Used to partition the knowledge base into independent layers.
 */
export enum KnowledgeSourceType {
  /** Seeded travel guides, FAQs, rules, tips, hidden gems, festivals */
  GLOBAL_KNOWLEDGE = 'global_knowledge',
  /** Lightweight summaries auto-generated from user destination searches */
  SEARCH_KNOWLEDGE = 'search_knowledge',
  /** Rich documents auto-generated from saved user itineraries */
  USER_TRIPS = 'user_trips',
  /** Aggregated semantic profile summarizing user preferences and behavior */
  USER_PROFILE = 'user_profile',
}

// ─── Chunk Types ───────────────────────────────────────────────────────────────

/**
 * Identifies the type of chunk for semantically split documents.
 */
export enum ChunkType {
  SUMMARY = 'summary',
  ITINERARY_DAY = 'itinerary_day',
  HOTEL = 'hotel',
  RESTAURANT = 'restaurant',
  ACTIVITY = 'activity',
  TRANSPORT = 'transport',
}

// ─── Metadata ──────────────────────────────────────────────────────────────────

/**
 * Structured metadata attached to each vector document.
 * Fields are optional — different categories use different subsets.
 */
export interface IVectorDocumentMetadata {
  /** Star rating (1–5) for attractions, hotels, restaurants */
  rating?: number;
  /** Price level indicator ($, $$, $$$, $$$$) */
  priceLevel?: string;
  /** Best months/seasons to visit */
  bestTimeToVisit?: string[];
  /** Estimated duration (e.g., "2-3 hours", "full day") */
  duration?: string;
  /** Difficulty level for activities */
  difficulty?: 'easy' | 'moderate' | 'hard' | 'extreme';
  /** Local currency */
  currency?: string;
  /** Primary language(s) spoken */
  languages?: string[];
  /** Geographic coordinates */
  coordinates?: {
    lat: number;
    lon: number;
  };
  /** Population or visitor count */
  population?: number;
  /** Relevant phone numbers (emergency, tourist helpline) */
  phoneNumbers?: string[];
  /** Useful URLs */
  urls?: string[];
  /** Opening hours description */
  openingHours?: string;
  /** Estimated cost range */
  estimatedCost?: string;
  /** Applicable travel types */
  travelTypes?: string[];

  // ── Extended Metadata (Rich filtering for RAG) ──────────────
  continent?: string;
  state?: string;
  timezone?: string;
  tripStyle?: string;
  budgetTier?: string;
  travelSeason?: string;
  travelCompanions?: string;
  durationCategory?: string;
  destinationType?: string;
  activityTypes?: string[];

  /** Any extra key-value pairs */
  [key: string]: unknown;
}

// ─── Core Document ─────────────────────────────────────────────────────────────

/**
 * Full vector document as stored in MongoDB.
 * Includes system-managed fields (embedding, hash, timestamps).
 */
export interface IVectorDocument {
  _id?: string;
  /** Human-readable title */
  title: string;
  /** Knowledge category */
  category: VectorDocumentCategory;
  /** Optional subtype within the category (e.g., "fort", "beach", "street food") */
  subtype?: string;
  /** Country name */
  country: string;
  /** City or region name */
  city: string;
  /** Searchable tags */
  tags: string[];
  /** Full textual content — this is what gets embedded */
  content: string;
  /** Structured metadata */
  metadata: IVectorDocumentMetadata;
  /** Data provenance */
  source: string;
  /** Vector embedding (256 dimensions) — excluded from default queries */
  embedding?: number[];
  /** SHA-256 hash of content for duplicate detection */
  contentHash?: string;

  // ── Dynamic Knowledge Fields (added for multi-source support) ──────────────

  /** Knowledge source layer — defaults to 'global_knowledge' for seed data */
  sourceType?: KnowledgeSourceType;
  /** Owner user ID — only set for user_trips documents */
  userId?: string;
  /** Reference to the SavedTrip document — only set for user_trips */
  tripId?: string;
  /** Number of times this destination was searched — for search_knowledge */
  searchCount?: number;
  /** Last time this destination was searched */
  lastSearched?: Date;
  /** Popularity score computed from searchCount + recency */
  popularityScore?: number;
  /** Which API or process generated this document */
  generatedFrom?: string;
  /** Access control: public (search knowledge) or private (user trips) */
  privacy?: 'public' | 'private';
  // ── Chunking Information ──────────────
  chunkType?: ChunkType;
  chunkIndex?: number;
  totalChunks?: number;

  // ── Embedding Metadata ──────────────
  embeddingModel?: string;
  embeddingVersion?: string;
  embeddingDimension?: number;
  embeddingCreatedAt?: Date;

  // ── Semantic Relationships ──────────────
  relatedDestinations?: string[];
  relatedCountries?: string[];
  relatedActivities?: string[];
  relatedTripStyles?: string[];
  relatedCategories?: string[];
  parentDocument?: string; // ObjectId as string
  childDocuments?: string[]; // ObjectId as string

  // ── Vector Lifecycle Management ──────────────
  lastAccessed?: Date;
  expiresAt?: Date;
  archived?: boolean;
  accessCount?: number;

  /** Document version for optimistic update tracking */
  version?: number;

  /** Timestamps managed by Mongoose */
  createdAt?: Date;
  updatedAt?: Date;
}

// ─── Search ────────────────────────────────────────────────────────────────────

/**
 * A vector document returned from a similarity search, with a relevance score.
 * Reserved for future RAG integration — not used in this phase.
 */
export interface VectorSearchResult {
  document: IVectorDocument;
  /** Cosine similarity score (0–1) */
  score: number;
}

/**
 * Filters for vector search queries.
 */
export interface VectorSearchFilter {
  category?: VectorDocumentCategory;
  country?: string;
  city?: string;
  tags?: string[];
  sourceType?: KnowledgeSourceType;
  userId?: string;
}

// ─── Ingestion ─────────────────────────────────────────────────────────────────

/** Supported ingestion source formats */
export type IngestionSource = 'json' | 'markdown' | 'csv' | 'manual';

/**
 * Input shape for creating/upserting a vector document.
 * Excludes system-managed fields (embedding, contentHash, timestamps).
 */
export interface VectorDocumentInput {
  title: string;
  category: VectorDocumentCategory;
  subtype?: string;
  country: string;
  city: string;
  tags?: string[];
  content: string;
  metadata?: IVectorDocumentMetadata;
  source?: string;
}

/**
 * Result of a single document ingestion operation.
 */
export interface IngestionResult {
  success: boolean;
  title: string;
  documentId?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Aggregate result of a bulk ingestion operation.
 */
export interface BulkIngestionResult {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ title: string; error: string }>;
  duration: number; // milliseconds
}

// ─── Dynamic Knowledge Inputs ──────────────────────────────────────────────────

/**
 * Input for creating/updating a search-generated knowledge document.
 * Produced automatically when users search for destinations.
 */
export interface SearchKnowledgeInput {
  /** The search query (used to derive title) */
  query: string;
  /** Destination name */
  destinationName: string;
  /** Country (resolved from API or defaulted) */
  country: string;
  /** City or region */
  city: string;
  /** Top attraction names returned by the API */
  topAttractions: string[];
  /** Categories present in the results */
  categories: string[];
  /** Which API produced the data */
  sourceAPI: string;
}

/**
 * Input for creating/updating a trip-generated knowledge document.
 * Produced automatically when users save itineraries.
 */
export interface TripKnowledgeInput {
  /** The SavedTrip MongoDB document (full object) */
  tripDoc: any;
  /** The owning user's ID */
  userId: string;
}
