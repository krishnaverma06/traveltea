import SavedTrip from "../models/SavedTrip.js";
import { getOpenTripMapAPI } from "../mcp-servers/places/api.js";
import { ingestSearchKnowledge } from "../vector/services/search-knowledge.service.js";
import { createChatModel } from "../config/llm.js";
import { sharedCache } from "../utils/cache.js";

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

/**
 * Pick the spelling to show for a group of case-variant city names.
 * Prefers one that's already capitalised ("Paris" over "paris"); if none is,
 * title-cases the normalised key so "banglore" doesn't render lowercase.
 */
const pickDisplayName = (spellings, normalisedKey) => {
  const capitalised = spellings.filter((s) => /^\p{Lu}/u.test(s));
  if (capitalised.length > 0) {
    // Longest wins as a tiebreak — "New York City" over a truncated variant.
    return capitalised.sort((a, b) => b.length - a.length)[0];
  }
  return normalisedKey.replace(/(^|\s|-)\p{Ll}/gu, (m) => m.toUpperCase());
};

export const getTrending = async (req, res) => {
  try {
    // Cached for an hour. Trending is derived from saved trips, so it barely
    // moves — while computing it costs up to 14 OpenTripMap round trips, and
    // api.ts deliberately paces every one of those 250ms apart to avoid 429s.
    // That throttle is the real floor here (parallelising the calls alone only
    // took ~7.4s to ~6.7s), so the win has to come from not recomputing it on
    // every page load. Global key: trending is the same for all users.
    const trending = await sharedCache.fetchOrCache(
      'explore:trending:v1',
      () => computeTrending(),
      3600,
      { provider: 'ExploreTrending' },
    );

    res.json({ trending });
  } catch (error) {
    console.error("Error fetching trending destinations:", error);
    res.status(500).json({
      error: "Failed to fetch trending destinations",
      details: error.message,
    });
  }
};

const TRENDING_SIZE = 8;

const computeTrending = async () => {
  // Group case-insensitively (and trimmed). Grouping on the raw name split
  // "Paris" and "paris" into two entries of count 1 each — which both
  // rendered as duplicate cards when they made the cut, and understated the
  // city's real popularity so it ranked below cities with fewer actual trips.
  //
  // Over-fetch candidates: not every city name resolves in OpenTripMap (a
  // user's "banglore" typo doesn't, and neither does "Bengaluru"), and an
  // unresolved city is dropped. Taking exactly TRENDING_SIZE candidates meant
  // the row silently shrank — observed returning 6, 7 and 8 items on
  // consecutive loads. Ask for twice as many and keep the first that resolve.
  const topCities = await SavedTrip.aggregate([
    { $unwind: "$cities" },
    {
      $group: {
        _id: { $toLower: { $trim: { input: "$cities.name" } } },
        count: { $sum: 1 },
        spellings: { $addToSet: "$cities.name" },
      },
    },
    { $sort: { count: -1, _id: 1 } },
    { $limit: TRENDING_SIZE * 2 },
  ]);

  // Look the cities up concurrently. This was a sequential await inside a
  // for-loop, so the endpoint cost the sum of up to 8 OpenTripMap round
  // trips (~7s warm, worse cold) when they can all run at once.
  const settled = await Promise.all(
    topCities.map(async (city) => {
      const name = pickDisplayName(city.spellings || [], city._id);
      try {
        const results = await getOpenTripMapAPI().searchPlaces(name, 1);
        return results[0] ? { ...results[0], name, tripCount: city.count } : null;
      } catch (err) {
        // One unresolvable city must not take down the whole endpoint.
        console.warn(`[trending] lookup failed for "${name}": ${err.message}`);
        return null;
      }
    }),
  );

  // Promise.all preserves input order, so the count-desc ranking survives.
  const trending = settled.filter(Boolean).slice(0, TRENDING_SIZE);

  return await getOpenTripMapAPI().enrichWithPhotos(trending, trending.length);
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

    const model = createChatModel({ temperature: 0.7, maxOutputTokens: 300 });

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
