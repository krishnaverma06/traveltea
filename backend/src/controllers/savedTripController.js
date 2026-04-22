import mongoose from "mongoose";
import SavedTrip from "../models/SavedTrip.js";
import { getOpenTripMapAPI } from "../mcp-servers/places/api.js";
import { generateEmbedding, buildTripSummary } from "../services/embedding.js";
import { ingestTripKnowledge, updateTripKnowledge, deleteTripKnowledge } from "../vector/services/trip-knowledge.service.js";
import { updateUserProfileKnowledge } from "../vector/services/user-profile.service.js";
import { weatherService } from "../services/weatherService.js";
import { ticketmasterService } from "../services/ticketmasterService.js";
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
    console.error("Error saving trip:", error);
    res.status(500).json({
      error: "Failed to save trip",
      details: error.message,
    });
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
    console.error("Error fetching saved trips:", error);
    res.status(500).json({
      error: "Failed to fetch saved trips",
      details: error.message,
    });
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
    console.error("Error fetching saved trip:", error);
    res.status(500).json({
      error: "Failed to fetch saved trip",
      details: error.message,
    });
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
    console.error("Error updating saved trip:", error);
    res.status(500).json({
      error: "Failed to update saved trip",
      details: error.message,
    });
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
    console.error("Error marking trip as upcoming:", error);
    res.status(500).json({
      error: "Failed to mark trip as upcoming",
      details: error.message,
    });
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
    console.error("Error deleting saved trip:", error);
    res.status(500).json({
      error: "Failed to delete saved trip",
      details: error.message,
    });
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
    console.error("Error checking if trip is saved:", error);
    res.status(500).json({
      error: "Failed to check trip status",
      details: error.message,
    });
  }
};

// Semantic search across saved trips using Atlas Vector Search
export const semanticSearchTrips = async (req, res) => {
  try {
    const query = (req.query.q || "").trim();
    if (!query) {
      return res.json({ savedTrips: [] });
    }

    // 1. Embed the search query
    const queryEmbedding = await generateEmbedding(query);

    // 2. Atlas $vectorSearch aggregation
    const results = await SavedTrip.aggregate([
      {
        $vectorSearch: {
          index: "trip_semantic_search",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: 50,
          limit: 20,
          filter: {
            user: new mongoose.Types.ObjectId(req.userId),
          },
        },
      },
      {
        $addFields: { score: { $meta: "vectorSearchScore" } },
      },
      {
        $match: { score: { $gte: 0.75 } } // Filter out low-relevance matches (increased for strictness)
      },
      {
        // Exclude the large embedding array from results
        $project: { embedding: 0 },
      },
    ]);

    console.log(
      `🔍 Semantic search for "${query}" → ${results.length} results (user: ${req.userId})`
    );
    // Log the scores so we can see how well it's matching
    results.forEach(r => console.log(`   - [Score: ${r.score.toFixed(3)}] ${r.title}`));

    res.json({ savedTrips: results });
  } catch (error) {
    console.error("Error in semantic search:", error);

    // Fallback to regex search if vector search fails
    // (e.g., index not yet created, or no embeddings yet)
    try {
      const safeQuery = escapeRegex(req.query.q || "");
      const fallbackResults = await SavedTrip.find({
        user: req.userId,
        $or: [
          { title: { $regex: safeQuery, $options: "i" } },
          { description: { $regex: safeQuery, $options: "i" } },
          { tags: { $in: [new RegExp(safeQuery, "i")] } },
          { "cities.name": { $regex: safeQuery, $options: "i" } },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(20);

      console.log(
        `🔍 Semantic search fallback (regex) → ${fallbackResults.length} results`
      );
      return res.json({ savedTrips: fallbackResults, fallback: true });
    } catch (fallbackError) {
      res.status(500).json({
        error: "Failed to search trips",
        details: error.message,
      });
    }
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
    console.error("Error updating timeline restaurants:", error);
    res.status(500).json({
      error: "Failed to update timeline restaurants",
      details: error.message,
    });
  }
};