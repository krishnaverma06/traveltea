import mongoose from "mongoose";

const citySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    days: { type: Number, required: true, min: 1 },
    country: { type: String, trim: true },
  },
  { _id: false }
);

const budgetSchema = new mongoose.Schema(
  {
    total: { type: Number, required: true, min: 0 },
    travel: { type: Number, required: true, min: 0 },
    accommodation: { type: Number, required: true, min: 0 },
    food: { type: Number, required: true, min: 0 },
    events: { type: Number, required: true, min: 0 },
    mode: { type: String, enum: ["capped", "flexible"], default: "capped" },
  },
  { _id: false }
);

const activitySchema = new mongoose.Schema(
  {
    id: { type: String },
    name: { type: String, required: true },
    description: { type: String },
    category: { type: String },
    duration: { type: String },
    estimatedCost: { type: String },
    location: {
      lat: { type: Number },
      lon: { type: Number },
      latitude: { type: Number },
      longitude: { type: Number },
      address: { type: String },
    },
    rating: { type: Number },
    imageUrl: { type: String },
    tags: { type: [String], default: [] },
    openingHours: { type: [String], default: [] },
    isOpen: { type: Boolean },
    websiteUrl: { type: String },
    phoneNumber: { type: String },
    distanceToNext: { type: String },
    mustVisit: { type: Boolean },
    bestTimeToVisit: { type: String },
  },
  { _id: false }
);

const timeSlotSchema = new mongoose.Schema(
  {
    period: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    activities: { type: [activitySchema], default: [] },
  },
  { _id: false }
);

const daySchema = new mongoose.Schema(
  {
    dayNumber: { type: Number, required: true },
    title: { type: String, required: true },
    timeSlots: { type: [timeSlotSchema], default: [] },
  },
  { _id: false }
);

const tripMetadataSchema = new mongoose.Schema(
  {
    destination: { type: String, required: true },
    numberOfPeople: { type: Number, required: true },
    travelers: { type: Number },
    budget: {
      perDay: { type: Number },
      breakdown: {
        activities: { type: Number },
        accommodation: { type: Number },
        food: { type: Number },
        travel: { type: Number },
      },
    },
  },
  { _id: false }
);

const itinerarySchema = new mongoose.Schema(
  {
    days: { type: [daySchema], required: true },
    tripMetadata: { type: tripMetadataSchema, required: true },
  },
  { _id: false }
);

const revisionSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, default: Date.now },
    mutationId: { type: String, required: true },
    action: { type: String, required: true },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    aiSummary: { type: String }
  },
  { _id: false }
);

const timelineSchema = new mongoose.Schema(
  {
    weather: { type: mongoose.Schema.Types.Mixed }, 
    events: { type: [mongoose.Schema.Types.Mixed] }, 
    restaurants: { type: mongoose.Schema.Types.Mixed }, 
    generatedAt: { type: Date, default: Date.now },
    lastUpdated: { type: Date, default: Date.now },
    // Tracks the last applied undo/redo mutationId for idempotency — undo/redo
    // don't push a `revisions` entry of their own (that array is the linear
    // edit history undo/redo navigate through, not a log of every action),
    // so a separate field is needed to detect a retried undo/redo.
    lastMutationId: { type: String, default: null },
    providerStatus: {
      weather: { type: String, enum: ['success', 'unavailable'] },
      events: { type: String, enum: ['success', 'unavailable'] }
    },
    futureProviders: {
      hotels: { type: mongoose.Schema.Types.Mixed }, 
      flights: { type: mongoose.Schema.Types.Mixed } 
    },
    version: { type: Number, default: 0 },
    currentRevisionIndex: { type: Number, default: -1 },
    revisions: { type: [revisionSchema], default: [] }
  },
  { _id: false }
);

const savedTripSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    // Original trip data
    startDate: { type: Date, required: true },
    cities: {
      type: [citySchema],
      validate: (v) => Array.isArray(v) && v.length > 0,
    },
    totalDays: { type: Number, required: true, min: 1 },
    people: { type: Number, required: true, min: 1 },
    travelType: { type: String, required: true },
    budget: { type: budgetSchema, required: true },
    budgetMode: {
      type: String,
      enum: ["capped", "flexible"],
      default: "capped",
    },
    // Generated itinerary data
    generatedItinerary: {
      type: itinerarySchema,
      required: true,
    },
    // Additional metadata
    isPublic: { type: Boolean, default: false },
    tags: { type: [String], default: [] },
    // Semantic search fields (Atlas Vector Search)
    embedding: {
      type: [Number],
      select: false, // Exclude from default queries (large array)
    },
    searchSummary: {
      type: String,
      trim: true,
    },
    timeline: { type: timelineSchema }
  },
  { timestamps: true }
);

// Index for better query performance
savedTripSchema.index({ user: 1, createdAt: -1 });
savedTripSchema.index({ title: "text", description: "text" });

const SavedTrip = mongoose.model("SavedTrip", savedTripSchema);
export default SavedTrip;