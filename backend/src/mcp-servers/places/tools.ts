import { z } from 'zod';
import { openTripMapAPI } from './api.js';
import { coerceCategoryCodes } from '../../config/opentripmap-categories.js';

/**
 * OpenTripMap's geocoder resolves bare place names only — "Prague" returns
 * results, "attractions in Prague" returns none. The LLM naturally echoes the
 * user's whole phrase into the query arg, so strip the common lead-ins before
 * geocoding rather than relying on the prompt alone.
 *
 * Defence in depth: the schema descriptions also now ask for a bare place
 * name, but a wrong arg must degrade to a correct search, not zero results.
 */
const LEAD_IN_RE =
  /^\s*(?:(?:find|show|get|search(?:\s+for)?|list|explore)\s+(?:me\s+)?)?(?:the\s+)?(?:top\s+|best\s+|popular\s+|famous\s+|good\s+)?(?:tourist\s+)?(?:attractions?|things\s+to\s+do|places(?:\s+to\s+(?:visit|see|go))?|sights?|sightseeing|landmarks?|monuments?|museums?|beaches?|parks?|restaurants?|hotels?|activities|spots?)\s+(?:in|at|near|around|of)\s+/i;

const TRAILING_RE = /\s*(?:,?\s*(?:india|usa|uk))?\s*[.!?]*\s*$/i;

export function normalizePlaceQuery(raw: string): string {
  if (!raw) return raw;
  let q = raw.trim();

  // Strip repeatedly: "show me the best attractions in Paris" -> "Paris"
  let prev: string;
  do {
    prev = q;
    q = q.replace(LEAD_IN_RE, '').trim();
  } while (q !== prev && q.length > 0);

  q = q.replace(TRAILING_RE, (m) => (m.trim().startsWith(',') ? m : '')).trim();

  // Never return empty — fall back to the original rather than searching "".
  return q.length > 0 ? q : raw.trim();
}

/**
 * Tool 1: Search Destinations
 * Find places by name or query
 */
export const searchDestinationsTool = {
  name: 'search_destinations',
  description: 'Search for travel destinations, cities, or tourist attractions by name. Returns a list of places with their coordinates and categories.',
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        'A bare place name ONLY — a city, region, or landmark (e.g. "Paris", "Thailand", "Eiffel Tower"). ' +
          'Never a phrase or sentence: pass "Prague", NOT "attractions in Prague" or "things to do in Prague". ' +
          'Extract just the place from the user\'s message.',
      ),
    limit: z.number().optional().default(10).describe('Maximum number of results to return (default: 10)'),
  }),
  execute: async (args: { query: string; limit?: number }) => {
    try {
      const query = normalizePlaceQuery(args.query);
      const results = await openTripMapAPI.searchPlaces(query, args.limit || 10);
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              query,
              count: results.length,
              destinations: results,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Failed to search destinations', details: String(error) }),
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Tool 2: Get Place Details
 * Get detailed information about a specific place
 */
export const getPlaceDetailsTool = {
  name: 'get_place_details',
  description: 'Get detailed information about a specific place including description, rating, images, and Wikipedia extracts.',
  inputSchema: z.object({
    placeId: z.string().describe('The unique identifier (xid) of the place from search results'),
  }),
  execute: async (args: { placeId: string }) => {
    try {
      const details = await openTripMapAPI.getEnrichedPlaceDetails(args.placeId);
      
      if (!details) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'Place not found' }),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(details, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Failed to get place details', details: String(error) }),
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Tool 3: Get Nearby Attractions
 * Find tourist attractions near specific coordinates
 */
export const getNearbyAttractionsTool = {
  name: 'get_nearby_attractions',
  description: 'Find tourist attractions, museums, monuments, and points of interest near specific GPS coordinates.',
  inputSchema: z.object({
    latitude: z.number().describe('Latitude coordinate'),
    longitude: z.number().describe('Longitude coordinate'),
    radius: z.number().optional().default(3000).describe('Search radius in meters (default: 3000m = 3km)'),
    limit: z.number().optional().default(20).describe('Maximum number of results (default: 20)'),
    kinds: z.string().optional().describe('Comma-separated categories (e.g., "museums,parks,monuments"). Leave empty for all tourist attractions.'),
  }),
  execute: async (args: { latitude: number; longitude: number; radius?: number; limit?: number; kinds?: string }) => {
    try {
      const results = await openTripMapAPI.getNearbyAttractions(
        args.latitude,
        args.longitude,
        args.radius || 3000,
        args.limit || 20,
        args.kinds
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              location: {
                latitude: args.latitude,
                longitude: args.longitude,
              },
              radius: args.radius || 3000,
              count: results.length,
              attractions: results,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Failed to get nearby attractions', details: String(error) }),
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Tool 4: Search Restaurants
 * Find restaurants and dining options
 */
export const searchRestaurantsTool = {
  name: 'search_restaurants',
  description: 'Find restaurants, cafes, and dining options in a specific location. Can filter by cuisine type.',
  inputSchema: z.object({
    location: z.string().describe('City or area to search for restaurants'),
    cuisine: z.string().optional().describe('Cuisine type (e.g., "italian", "asian", "french")'),
    limit: z.number().optional().default(10).describe('Maximum number of results'),
  }),
  execute: async (args: { location: string; cuisine?: string; limit?: number }) => {
    try {
      // First geocode the location
      const location = normalizePlaceQuery(args.location);
      const tempResults = await openTripMapAPI.searchPlaces(location, 1);
      if (tempResults.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'Location not found' }),
            },
          ],
          isError: true,
        };
      }

      const { latitude, longitude } = tempResults[0].location;
      
      // Search for restaurants
      const restaurants = await openTripMapAPI.searchByCategory(
        latitude,
        longitude,
        'foods',
        5000, // 5km radius
        args.limit || 10
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              location,
              cuisine: args.cuisine,
              count: restaurants.length,
              restaurants: restaurants.map(r => ({
                name: r.name,
                category: r.category,
                rating: r.rating,
                location: r.location,
              })),
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Restaurant search failed', details: String(error) }),
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Tool 5: Search by Category
 * Search for places by specific category
 */
export const searchByCategoryTool = {
  name: 'search_by_category',
  description: 'Search for specific types of places like museums, parks, monuments, historical sites, etc.',
  inputSchema: z.object({
    location: z.string().describe('City or area to search in'),
    category: z.string().min(1).describe(
      'OpenTripMap "kinds" code(s), comma-separated. Must be real codes from this list: ' +
        'interesting_places, cultural, historic, natural, religion, architecture, museums, ' +
        'theatres_and_entertainments, urban_environment, amusements, sport, beaches, foods, ' +
        'shops, accomodations, tourist_facilities. Use "interesting_places" for a general ' +
        '"attractions"/"things to do" request. Never invent a code such as "tourist_attraction".'
    ),
    limit: z.number().optional().default(10).describe('Maximum number of results'),
  }),
  execute: async (args: { location: string; category: string; limit?: number }) => {
    try {
      // Geocode location
      const location = normalizePlaceQuery(args.location);
      const tempResults = await openTripMapAPI.searchPlaces(location, 1);
      if (tempResults.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'Location not found' }),
            },
          ],
          isError: true,
        };
      }

      const { latitude, longitude } = tempResults[0].location;
      
      // Coerce the LLM's category into codes OpenTripMap actually accepts —
      // an invented kind like "tourist_attraction" 400s, which surfaced to
      // the user as "I couldn't find any places".
      const category = coerceCategoryCodes(args.category);

      const results = await openTripMapAPI.searchByCategory(
        latitude,
        longitude,
        category,
        10000, // 10km radius
        args.limit || 10
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              location,
              category,
              count: results.length,
              places: results,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Category search failed', details: String(error) }),
          },
        ],
        isError: true,
      };
    }
  },
};

// Export all tools
export const placesTools = [
  searchDestinationsTool,
  getPlaceDetailsTool,
  getNearbyAttractionsTool,
  searchRestaurantsTool,
  searchByCategoryTool,
];