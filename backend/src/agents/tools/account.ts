import { z } from 'zod';
import SavedTrip from '../../models/SavedTrip.js';
import User from '../../models/User.js';

const ok = (payload: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
});

const fail = (error: string, details?: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify({ error, details: details ? String(details) : undefined }) }],
  isError: true,
});

// Excludes generatedItinerary/timeline: full itinerary docs would blow up LLM
// context and get persisted verbatim into Conversation.messages.
const TRIP_FIELDS = 'title description startDate cities totalDays people travelType budget budgetMode tags createdAt';

const compactTrip = (trip: any) => ({
  id: trip._id.toString(),
  title: trip.title,
  startDate: trip.startDate,
  totalDays: trip.totalDays,
  people: trip.people,
  travelType: trip.travelType,
  cities: (trip.cities || []).map((c: any) => c.name),
  budgetTotal: trip.budget?.total,
});

/**
 * Tool: List Saved Trips
 */
const listSavedTripsSchema = z.object({
  userId: z.string().min(1),
  limit: z.number().int().min(1).max(20).optional().default(5),
});

export const listSavedTripsTool = {
  name: 'list_saved_trips',
  description: "List the user's saved trips, most recent first. Use for requests like 'show my saved trips' or 'what trips have I saved'.",
  inputSchema: listSavedTripsSchema,
  userScoped: true,
  signInMessage: "you'll need to be signed in for me to look at your saved trips.",
  execute: async (args: z.infer<typeof listSavedTripsSchema>) => {
    const parsed = listSavedTripsSchema.safeParse(args);
    if (!parsed.success) return fail('Invalid arguments', parsed.error.issues);
    const { userId, limit } = parsed.data;

    try {
      const [trips, total] = await Promise.all([
        SavedTrip.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).select(TRIP_FIELDS).lean(),
        SavedTrip.countDocuments({ user: userId }),
      ]);
      return ok({ count: trips.length, total, trips: trips.map(compactTrip) });
    } catch (error) {
      return fail('Failed to list saved trips', error);
    }
  },
};

/**
 * Tool: Get Upcoming Trip
 */
const getUpcomingTripSchema = z.object({
  userId: z.string().min(1),
});

export const getUpcomingTripTool = {
  name: 'get_upcoming_trip',
  description: "Find the user's next upcoming or currently in-progress saved trip. Use for requests like 'what's my next trip' or 'when am I travelling next'.",
  inputSchema: getUpcomingTripSchema,
  userScoped: true,
  signInMessage: "you'll need to be signed in for me to check your upcoming trips.",
  execute: async (args: z.infer<typeof getUpcomingTripSchema>) => {
    const parsed = getUpcomingTripSchema.safeParse(args);
    if (!parsed.success) return fail('Invalid arguments', parsed.error.issues);
    const { userId } = parsed.data;

    try {
      const today = new Date();
      const lookbackStart = new Date(today);
      lookbackStart.setDate(lookbackStart.getDate() - 60);

      const candidates = await SavedTrip.find({ user: userId, startDate: { $gte: lookbackStart } })
        .sort({ startDate: 1 })
        .limit(10)
        .select(TRIP_FIELDS)
        .lean();

      const upcoming = candidates.find((trip: any) => {
        const start = new Date(trip.startDate);
        const end = new Date(start);
        end.setDate(end.getDate() + (trip.totalDays || 1) - 1);
        return end >= today;
      });

      if (!upcoming) return ok({ hasUpcoming: false });

      const start = new Date((upcoming as any).startDate);
      const daysUntilStart = Math.ceil((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      return ok({
        hasUpcoming: true,
        status: daysUntilStart <= 0 ? 'in_progress' : 'upcoming',
        daysUntilStart: Math.max(daysUntilStart, 0),
        trip: compactTrip(upcoming),
      });
    } catch (error) {
      return fail('Failed to find upcoming trip', error);
    }
  },
};

/**
 * Tool: Get Travel Preferences
 */
const getTravelPreferencesSchema = z.object({
  userId: z.string().min(1),
});

export const getTravelPreferencesTool = {
  name: 'get_travel_preferences',
  description: "Read the user's saved travel preferences (budget level, travel style, interests). Use for requests like 'what are my travel preferences'.",
  inputSchema: getTravelPreferencesSchema,
  userScoped: true,
  signInMessage: "you'll need to be signed in for me to look at your travel preferences.",
  execute: async (args: z.infer<typeof getTravelPreferencesSchema>) => {
    const parsed = getTravelPreferencesSchema.safeParse(args);
    if (!parsed.success) return fail('Invalid arguments', parsed.error.issues);
    const { userId } = parsed.data;

    try {
      const user = await User.findById(userId).select('preferences').lean();
      if (!user) return fail('User not found');
      return ok({ preferences: (user as any).preferences });
    } catch (error) {
      return fail('Failed to read travel preferences', error);
    }
  },
};

/**
 * Tool: Update Travel Preferences
 */
const updateTravelPreferencesSchema = z.object({
  userId: z.string().min(1),
  budget: z.enum(['budget', 'mid-range', 'luxury']).optional(),
  travelStyle: z.enum(['adventure', 'relaxation', 'cultural', 'business']).optional(),
  interests: z.array(z.string()).max(20).optional(),
});

export const updateTravelPreferencesTool = {
  name: 'update_travel_preferences',
  description: "Update one or more of the user's travel preferences (budget level, travel style, interests). Only updates the fields provided — does not clear the others. Use for requests like 'set my budget to luxury' or 'add hiking to my interests'.",
  inputSchema: updateTravelPreferencesSchema,
  userScoped: true,
  signInMessage: "you'll need to be signed in for me to update your travel preferences.",
  execute: async (args: z.infer<typeof updateTravelPreferencesSchema>) => {
    const parsed = updateTravelPreferencesSchema.safeParse(args);
    if (!parsed.success) return fail('Invalid arguments', parsed.error.issues);
    const { userId, budget, travelStyle, interests } = parsed.data;

    if (budget === undefined && travelStyle === undefined && interests === undefined) {
      return fail('Nothing to update');
    }

    const $set: Record<string, unknown> = {};
    if (budget !== undefined) $set['preferences.budget'] = budget;
    if (travelStyle !== undefined) $set['preferences.travelStyle'] = travelStyle;
    if (interests !== undefined) $set['preferences.interests'] = interests;

    try {
      const user = await User.findByIdAndUpdate(userId, { $set }, { new: true, runValidators: true })
        .select('preferences')
        .lean();
      if (!user) return fail('User not found');
      return ok({ updated: Object.keys($set), preferences: (user as any).preferences });
    } catch (error) {
      return fail('Failed to update travel preferences', error);
    }
  },
};

export const accountTools = [
  listSavedTripsTool,
  getUpcomingTripTool,
  getTravelPreferencesTool,
  updateTravelPreferencesTool,
];
