import mongoose from "mongoose";
import SavedTrip from "../models/SavedTrip.js";
import { getOpenTripMapAPI } from "../mcp-servers/places/api.js";
import { generateEmbedding, buildTripSummary } from "../services/embedding.js";
import { searchSavedTrips } from "../services/tripSearch.js";
import { saveItineraryAsTrip } from "../services/tripPersistence.js";
import { ingestTripKnowledge, updateTripKnowledge, deleteTripKnowledge } from "../vector/services/trip-knowledge.service.js";
import { updateUserProfileKnowledge } from "../vector/services/user-profile.service.js";
import { weatherService } from "../services/weatherService.js";
import { ticketmasterService } from "../services/ticketmasterService.js";

/**
 * Mongoose reports bad client input as CastError (malformed ObjectId) and
 * ValidationError (schema violations). Returning 500 for those hides genuine
 * 4xx conditions and makes the API look broken to callers — map them here so
 * every handler in this file reports the right class of failure.
 */
function sendError(res, error, message) {
  if (error?.name === "CastError") {
    return res.status(400).json({
      error: "Invalid identifier",
      details: `${error.path}: ${error.value}`,
    });
  }
  if (error?.name === "ValidationError") {
    const details =
      Object.values(error.errors || {})
        .map((e) => e.message)
        .join("; ") || error.message;
    return res.status(400).json({ error: "Validation failed", details });
  }
  if (error?.code === 11000) {
    return res.status(409).json({ error: "Duplicate resource", details: error.message });
  }
  console.error(message, error);
  return res.status(500).json({ error: message, details: error?.message });
}

// Escape regex metacharacters so user-supplied search text can't be used
// to build unexpected/expensive patterns.
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Best-effort: resolve each city's country code for trip stats. Failures
// are non-fatal — cities just end up without a country and are skipped
// when counting countries visited.
const resolveCityCountries = async (cities) => {
  return Promise.all(
    cities.map(async (city) => {
      if (city.country) return city;
      const country = await getOpenTripMapAPI().getCityCountryCode(city.name);
      return country ? { ...city, country } : city;
    })
  );
};

// Save a trip
export const saveTrip = async (req, res) => {
  try {
    const {
      title,
      description,
      startDate,
      cities,
      totalDays,
      people,
      travelType,
      budget,
      budgetMode,
      generatedItinerary,
      isPublic = false,
      tags = [],
    } = req.body;

    // Validate required fields
    if (
      !title ||
      !startDate ||
      !cities ||
      !totalDays ||
      !people ||
      !travelType ||
      !budget ||
      !generatedItinerary
    ) {
      return res.status(400).json({
        error:
          "Missing required fields: title, startDate, cities, totalDays, people, travelType, budget, generatedItinerary",
      });
    }

    // Validate user authentication
    if (!req.userId) {
      return res.status(401).json({
        error: "User authentication required",
      });
    }

    // Create the saved trip
    const citiesWithCountry = await resolveCityCountries(cities);
    const savedTrip = new SavedTrip({
      user: req.userId,
      title,
      description,
      startDate: new Date(startDate),
      cities: citiesWithCountry,
      totalDays,
      people,
      travelType,
      budget,
      budgetMode,
      generatedItinerary,
      isPublic,
      tags,
    });

    await savedTrip.save();

    // Fire-and-forget: generate embedding for semantic search
    (async () => {
      try {
        const summary = buildTripSummary(savedTrip);
        const embedding = await generateEmbedding(summary);
        await SavedTrip.updateOne(
          { _id: savedTrip._id },
          { $set: { embedding, searchSummary: summary } }
        );
        console.log(`🔍 Embedding indexed for trip ${savedTrip._id}`);
      } catch (err) {
        console.error('⚠️ Embedding generation failed (trip still saved):', err.message);
      }

      // Fire-and-forget: ingest rich trip knowledge into vector semantic layer
      ingestTripKnowledge(savedTrip, req.userId).catch(err => 
        console.error('⚠️ Trip vector ingestion failed:', err.message)
      );

      // Fire-and-forget: update user profile
      updateUserProfileKnowledge(req.userId).catch(err => 
        console.error('⚠️ User profile update failed:', err.message)
      );

      // Fire-and-forget: enrich timeline data (Weather & Events)
      (async () => {
        try {
          const { weatherService } = await import('../services/weatherService.js');
          const { ticketmasterService } = await import('../services/ticketmasterService.js');
          
          const mainCity = savedTrip.cities[0];
          if (!mainCity) return;
          
          const lat = mainCity.coordinates?.lat || 0;
          const lon = mainCity.coordinates?.lng || 0;
          const startDate = new Date(savedTrip.startDate).toISOString().split('T')[0];
          
          const endDateObj = new Date(savedTrip.startDate);
          endDateObj.setDate(endDateObj.getDate() + savedTrip.totalDays - 1);
          const endDate = endDateObj.toISOString().split('T')[0];

          const dates = [];
          for (let i = 0; i < savedTrip.totalDays; i++) {
            const d = new Date(savedTrip.startDate);
            d.setDate(d.getDate() + i);
            dates.push(d.toISOString().split('T')[0]);
          }

          console.log(`⏳ Starting background timeline enrichment for trip ${savedTrip._id}`);
          const results = await Promise.allSettled([
            weatherService.getMappedForecast(lat, lon, dates),
            ticketmasterService.getEvents(mainCity.name, startDate, endDate)
          ]);

          const weatherData = results[0].status === 'fulfilled' ? results[0].value : null;
          const eventsData = results[1].status === 'fulfilled' ? results[1].value : [];

          await SavedTrip.updateOne(
            { _id: savedTrip._id },
            { 
              $set: { 
                timeline: {
                  weather: weatherData,
                  events: eventsData,
                  generatedAt: new Date(),
                  lastUpdated: new Date(),
                  providerStatus: {
                    weather: results[0].status === 'fulfilled' ? 'success' : 'unavailable',
                    events: results[1].status === 'fulfilled' ? 'success' : 'unavailable'
                  }
                }
              } 
            }
          );
          console.log(`✅ Background timeline enrichment completed for trip ${savedTrip._id}`);
        } catch (err) {
          console.error('⚠️ Timeline enrichment failed:', err);
        }
      })();
    })();

    res.status(201).json({
      message: "Trip saved successfully",
      savedTrip,
    });
  } catch (error) {
    return sendError(res, error, "Failed to save trip");
  }
};

// Get all saved trips for a user
export const getSavedTrips = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    const query = { user: req.userId };

    if (search) {
      const safeSearch = escapeRegex(search);
      query.$or = [
        { title: { $regex: safeSearch, $options: "i" } },
        { description: { $regex: safeSearch, $options: "i" } },
        { tags: { $in: [new RegExp(safeSearch, "i")] } },
      ];
    }

    const savedTrips = await SavedTrip.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await SavedTrip.countDocuments(query);

    res.json({
      savedTrips,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
      },
    });
  } catch (error) {
    return sendError(res, error, "Failed to fetch saved trips");
  }
};

// Get a specific saved trip
export const getSavedTrip = async (req, res) => {
  try {
    const { id } = req.params;

    const savedTrip = await SavedTrip.findOne({
      _id: id,
      user: req.userId,
    });

    if (!savedTrip) {
      return res.status(404).json({
        error: "Saved trip not found",
      });
    }

    res.json(savedTrip);
  } catch (error) {
    return sendError(res, error, "Failed to fetch saved trip");
  }
};

// Update a saved trip
export const updateSavedTrip = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Remove fields that shouldn't be updated directly
    delete updates.user;
    delete updates._id;
    delete updates.createdAt;
    delete updates.updatedAt;
    delete updates.__v;

    const savedTrip = await SavedTrip.findOneAndUpdate(
      { _id: id, user: req.userId },
      updates,
      { new: true, runValidators: true }
    );

    if (!savedTrip) {
      return res.status(404).json({
        error: "Saved trip not found",
      });
    }

    res.json({
      message: "Trip updated successfully",
      savedTrip,
    });

    // Fire-and-forget: update trip knowledge chunks
    updateTripKnowledge(id, savedTrip).catch(() => {});

    // Fire-and-forget: update user profile
    updateUserProfileKnowledge(req.userId).catch(() => {});
  } catch (error) {
    return sendError(res, error, "Failed to update saved trip");
  }
};

// Mark a saved trip as upcoming by (re)confirming its start date — "upcoming
// trips" are derived client-side by filtering saved trips with startDate in
// the future, so this just needs to set a real startDate.
export const markTripUpcoming = async (req, res) => {
  try {
    const { id } = req.params;
    const { tripStartDate } = req.body;

    if (!tripStartDate) {
      return res.status(400).json({ error: "tripStartDate is required" });
    }

    const savedTrip = await SavedTrip.findOneAndUpdate(
      { _id: id, user: req.userId },
      { startDate: tripStartDate },
      { new: true, runValidators: true }
    );

    if (!savedTrip) {
      return res.status(404).json({
        error: "Saved trip not found",
      });
    }

    res.json({
      message: "Trip marked as upcoming",
      savedTrip,
    });
  } catch (error) {
    return sendError(res, error, "Failed to mark trip as upcoming");
  }
};

// Delete a saved trip
export const deleteSavedTrip = async (req, res) => {
  try {
    const { id } = req.params;

    const savedTrip = await SavedTrip.findOneAndDelete({
      _id: id,
      user: req.userId,
    });

    if (!savedTrip) {
      return res.status(404).json({
        error: "Saved trip not found",
      });
    }

    res.json({
      message: "Trip deleted successfully",
    });

    // Fire-and-forget: delete trip knowledge from vector semantic layer
    deleteTripKnowledge(id).catch(() => {});

    // Fire-and-forget: update user profile
    updateUserProfileKnowledge(req.userId).catch(() => {});
  } catch (error) {
    return sendError(res, error, "Failed to delete saved trip");
  }
};

// Check if a trip is already saved (to prevent duplicates)
export const checkTripSaved = async (req, res) => {
  try {
    const { startDate, cities, people, travelType } = req.query;

    if (!startDate || !cities || !people || !travelType) {
      return res.status(400).json({
        error: "Missing required query parameters",
      });
    }

    const cityNames = JSON.parse(cities).map((c) => c.name);

    const existingTrip = await SavedTrip.findOne({
      user: req.userId,
      startDate: new Date(startDate),
      people: parseInt(people),
      travelType,
      // Require the same full set of cities, not just a partial overlap.
      cities: { $size: cityNames.length },
      "cities.name": { $all: cityNames },
    });

    res.json({
      isSaved: !!existingTrip,
      savedTrip: existingTrip,
    });
  } catch (error) {
    return sendError(res, error, "Failed to check trip status");
  }
};

// Hybrid (lexical + semantic) search across a user's saved trips.
//
// Was pure $vectorSearch against an index that did not exist, so every request
// threw and silently fell through to a regex fallback — semantic search had
// never actually run in production. The index is created by
// `npm run fix:trip-index`; the ranking, thresholds and lexical/semantic merge
// now live in services/tripSearch.ts so this endpoint and the global search
// bar cannot drift apart.
export const semanticSearchTrips = async (req, res) => {
  try {
    const query = (req.query.q || "").trim();
    if (!query) {
      return res.json({ savedTrips: [] });
    }

    const result = await searchSavedTrips(req.userId, query);

    console.log(
      `🔍 Trip search "${query}" → ${result.trips.length} results ` +
        `(lexical ${result.lexicalCount}, semantic ${result.semanticCount}, ` +
        `semanticAvailable=${result.semanticAvailable}, user: ${req.userId})`
    );

    // `semantic` tells the client whether the semantic half actually ran, so a
    // missing/building index degrades visibly rather than looking like "no
    // matches" — the exact confusion that hid this bug.
    res.json({ savedTrips: result.trips, semantic: result.semanticAvailable });
  } catch (error) {
    return sendError(res, error, "Failed to search trips");
  }
};

// POST /api/saved-trips/from-itinerary
//
// Saves an itinerary the agent generated in chat. The chat itinerary shape
// (tripMetadata.duration / .travelers) does not match the SavedTrip schema
// (totalDays / numberOfPeople), and the mapping plus the embedding and vector
// ingestion all live in services/tripPersistence.ts — the same helper the
// agent's own pipeline uses, so a trip saved from chat is indistinguishable
// from one saved by the planner.
export const saveItineraryFromChat = async (req, res) => {
  try {
    const { itinerary, title, startDate, travelType, travelers, budgetTotal } = req.body || {};

    if (!itinerary || !Array.isArray(itinerary.days) || itinerary.days.length === 0) {
      return res.status(400).json({ error: "An itinerary with at least one day is required" });
    }

    const trip = await saveItineraryAsTrip(req.userId, itinerary, {
      title,
      startDate,
      travelType,
      travelers,
      budgetTotal,
      source: "chat",
    });

    return res.status(201).json({ savedTrip: trip });
  } catch (error) {
    return sendError(res, error, "Failed to save this itinerary");
  }
};

// Update timeline restaurants
export const updateTimelineRestaurants = async (req, res) => {
  try {
    const { id } = req.params;
    const { restaurants } = req.body;

    const savedTrip = await SavedTrip.findOneAndUpdate(
      { _id: id, user: req.userId },
      { $set: { "timeline.restaurants": restaurants, "timeline.lastUpdated": new Date() } },
      { new: true }
    );

    if (!savedTrip) {
      return res.status(404).json({ error: "Saved trip not found" });
    }

    res.json(savedTrip);
  } catch (error) {
    return sendError(res, error, "Failed to update timeline restaurants");
  }
};