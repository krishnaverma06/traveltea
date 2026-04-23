import { searchSavedTrips } from "../services/tripSearch.js";
import { getOpenTripMapAPI } from "../mcp-servers/places/api.js";
import { createChatModel } from "../config/llm.js";

const buildTripCandidates = (trips) =>
  trips.map((trip) => ({
    type: "trip",
    id: trip._id.toString(),
    title: trip.title,
    subtitle: trip.cities?.map((c) => c.name).join(" → ") || "",
  }));

const buildDestinationCandidates = (destinations) =>
  destinations.map((d) => ({
    type: "destination",
    id: d.id,
    title: d.name,
    subtitle: d.category?.[0] || "Destination",
  }));

const rankWithGemini = async (query, candidates) => {
  const model = createChatModel({ temperature: 0, maxOutputTokens: 500 });

  const systemPrompt = `You are a search relevance ranker for a travel app. Given a user's search text and a list of candidate results (each with type "trip" or "destination", an id, a title, and a subtitle), pick and order the candidates most relevant to the query by meaning, not just exact text match (e.g. "beach" should match a coastal city). Only return items from the given candidate list — never invent new ones. Respond with ONLY a valid JSON array of objects like [{"type": "trip", "id": "..."}], ordered most relevant first, at most 6 items.`;

  const userPrompt = `Query: "${query}"\n\nCandidates:\n${JSON.stringify(candidates)}`;

  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  const content = response.content;
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array found in ranking response");

  const ranked = JSON.parse(jsonMatch[0]);
  const byKey = new Map(candidates.map((c) => [`${c.type}:${c.id}`, c]));

  return ranked
    .map((r) => byKey.get(`${r.type}:${r.id}`))
    .filter(Boolean)
    .slice(0, 6);
};

export const getSearchSuggestions = async (req, res) => {
  try {
    const query = (req.query.q || "").trim();
    if (!query) {
      return res.json({ suggestions: [] });
    }

    // Same hybrid retrieval the Saved Trips page uses (services/tripSearch.ts),
    // rather than the regex-only lookup this used to do — typing "beach" here
    // now finds a coastal trip the user saved, not just titles containing the
    // literal word. Run alongside the destination lookup, not after it.
    const [tripSearch, destinationMatches] = await Promise.all([
      searchSavedTrips(req.userId, query, 10),
      getOpenTripMapAPI().searchPlaces(query, 8),
    ]);
    const tripMatches = tripSearch.trips;

    const candidates = [
      ...buildTripCandidates(tripMatches),
      ...buildDestinationCandidates(destinationMatches),
    ];

    if (candidates.length === 0) {
      return res.json({ suggestions: [] });
    }

    try {
      const suggestions = await rankWithGemini(query, candidates);
      return res.json({ suggestions });
    } catch (rankError) {
      console.error("Search ranking fallback (LLM failed):", rankError.message);
      return res.json({ suggestions: candidates.slice(0, 6) });
    }
  } catch (error) {
    console.error("Error fetching search suggestions:", error);
    res.status(500).json({
      error: "Failed to fetch search suggestions",
      details: error.message,
    });
  }
};
