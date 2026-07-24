import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import SavedTrip from "../models/SavedTrip.js";
import { getOpenTripMapAPI } from "../mcp-servers/places/api.js";
import { ingestSearchKnowledge } from "../vector/services/search-knowledge.service.js";

const DEFAULT_QUERY = "Paris";

export const getDestinations = async (req, res) => {
  try {
    const query = (req.query.q || "").trim() || DEFAULT_QUERY;
    const category = (req.query.category || "").trim();

    let destinations = await getOpenTripMapAPI().searchPlaces(query, 24);

    if (category) {
      destinations = destinations.filter((d) =>
        d.category?.some((c) => c.toLowerCase().includes(category.toLowerCase()))
      );
    }

    destinations = await getOpenTripMapAPI().enrichWithPhotos(destinations, 12);

    res.json({ destinations });

    // Fire-and-forget: ingest search knowledge
    ingestSearchKnowledge(query, destinations, "opentripmap").catch(() => {});
  } catch (error) {
    console.error("Error fetching explore destinations:", error);
    res.status(500).json({
      error: "Failed to fetch destinations",
      details: error.message,
    });
  }
};

export const getTrending = async (req, res) => {
  try {
    const topCities = await SavedTrip.aggregate([
      { $unwind: "$cities" },
      { $group: { _id: "$cities.name", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]);

    const trending = [];
    for (const city of topCities) {
      const results = await getOpenTripMapAPI().searchPlaces(city._id, 1);
      if (results[0]) {
        trending.push({ ...results[0], name: city._id, tripCount: city.count });
      }
    }

    const enrichedTrending = await getOpenTripMapAPI().enrichWithPhotos(trending, trending.length);

    res.json({ trending: enrichedTrending });
  } catch (error) {
    console.error("Error fetching trending destinations:", error);
    res.status(500).json({
      error: "Failed to fetch trending destinations",
      details: error.message,
    });
  }
};

export const getRecommendations = async (req, res) => {
  try {
    const trips = await SavedTrip.find({ user: req.userId })
      .sort({ createdAt: -1 })
      .limit(20);

    if (trips.length === 0) {
      return res.json({ recommendations: [] });
    }

    const visitedCities = [
      ...new Set(trips.flatMap((t) => t.cities?.map((c) => c.name) || [])),
    ];
    const tags = [...new Set(trips.flatMap((t) => t.tags || []))];

    const model = new ChatGoogleGenerativeAI({
      model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
      temperature: 0.7,
      maxOutputTokens: 300,
      apiKey: process.env.GEMINI_API_KEY,
    });

    const systemPrompt = `You are a travel recommendation engine. Given a traveler's previously visited cities and travel style tags, suggest destinations they have NOT visited yet that match their taste. Respond with ONLY a valid JSON array of city or destination names (strings), at most 6 items, no explanations.`;
    const userPrompt = `Visited cities: ${visitedCities.join(", ") || "none"}\nTravel style tags: ${tags.join(", ") || "none"}`;

    let suggestedNames = [];
    try {
      const response = await model.invoke([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        suggestedNames = JSON.parse(jsonMatch[0]).filter(
          (name) => !visitedCities.some((v) => v.toLowerCase() === String(name).toLowerCase())
        );
      }
    } catch (llmError) {
      console.error("Recommendation LLM failed:", llmError.message);
    }

    const recommendations = [];
    for (const name of suggestedNames.slice(0, 6)) {
      const results = await getOpenTripMapAPI().searchPlaces(name, 1);
      if (results[0]) {
        recommendations.push({ ...results[0], name });
      }
    }

    const enrichedRecommendations = await getOpenTripMapAPI().enrichWithPhotos(
      recommendations,
      recommendations.length
    );

    res.json({ recommendations: enrichedRecommendations });
  } catch (error) {
    console.error("Error fetching recommendations:", error);
    res.status(500).json({
      error: "Failed to fetch recommendations",
      details: error.message,
    });
  }
};
