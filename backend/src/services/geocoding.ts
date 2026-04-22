import axios from 'axios';
import { sharedCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';

/**
 * Place-name → coordinates, shared by the places and transport layers.
 *
 * Why this exists: OpenTripMap's /geoname endpoint is a populated-places
 * gazetteer that returns exactly ONE result with no alternatives and no way to
 * disambiguate. It picked the wrong place on plain, exact-name queries:
 *
 *     Leh            -> LEH, France       (not Leh, Ladakh)
 *     San Francisco  -> El Salvador       (pop 16,152)
 *     Colosseum      -> Australia         (pop 229)
 *     Eiffel Tower   -> "Eiffel", ZA      (a partial match)
 *
 * That is actively wrong for real user data — a saved "Leh → Ladakh" trip
 * would have had its itinerary built around northern France.
 *
 * Nominatim resolves all of those correctly and additionally handles
 * landmarks, which a populated-places gazetteer cannot represent at all.
 *
 * OpenTripMap is kept as a fallback so a Nominatim outage degrades to the old
 * behaviour rather than breaking search outright.
 */

export interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
  country?: string;
  source: 'nominatim' | 'opentripmap';
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OPENTRIPMAP_GEONAME_URL = 'https://api.opentripmap.com/0.1/en/places/geoname';

// Nominatim's usage policy caps clients at 1 request/second and requires a
// User-Agent identifying the application. Requests go through a single queue
// so concurrent callers can't breach it.
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const USER_AGENT = 'TravelTea/1.0 (travel itinerary planner)';

// Coordinates for a named place don't move. Cache hard.
const GEOCODE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

let lastNominatimAt = 0;
let nominatimQueue: Promise<unknown> = Promise.resolve();

function throttledNominatim<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, lastNominatimAt + NOMINATIM_MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimAt = Date.now();
    return fn();
  };
  const result = nominatimQueue.then(run, run);
  nominatimQueue = result.catch(() => undefined);
  return result;
}

async function viaNominatim(query: string): Promise<GeocodeResult | null> {
  const res = await throttledNominatim(() =>
    axios.get(NOMINATIM_URL, {
      params: { q: query, format: 'json', limit: 1, addressdetails: 1 },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10_000,
    }),
  );

  const hit = Array.isArray(res.data) ? res.data[0] : null;
  if (!hit?.lat || !hit?.lon) return null;

  return {
    lat: parseFloat(hit.lat),
    lon: parseFloat(hit.lon),
    displayName: hit.display_name || query,
    country: hit.address?.country,
    source: 'nominatim',
  };
}

async function viaOpenTripMap(query: string): Promise<GeocodeResult | null> {
  const apikey = process.env.OPENTRIPMAP_API_KEY;
  if (!apikey) return null;

  const res = await axios.get(OPENTRIPMAP_GEONAME_URL, {
    params: { name: query, apikey },
    timeout: 10_000,
  });

  const d = res.data;
  // A partial match means it fuzzy-matched something else entirely; that is
  // never the answer to the question that was asked.
  if (!d?.lat || d.partial_match) return null;

  return {
    lat: d.lat,
    lon: d.lon,
    displayName: d.name || query,
    country: d.country,
    source: 'opentripmap',
  };
}

/**
 * Resolve a place name to coordinates. Returns null when nothing sensible
 * matches, so callers can report an honest "not found" rather than silently
 * using somewhere on the wrong continent.
 */
export async function geocodePlace(query: string): Promise<GeocodeResult | null> {
  const trimmed = (query || '').trim();
  if (!trimmed) return null;

  const cacheKey = sharedCache.generateKey('geocode', { q: trimmed.toLowerCase() });

  return sharedCache.fetchOrCache<GeocodeResult | null>(
    cacheKey,
    async () => {
      try {
        const primary = await viaNominatim(trimmed);
        if (primary) return primary;
        logger.warn(`[geocode] nominatim found nothing for "${trimmed}", trying OpenTripMap`);
      } catch (err: any) {
        logger.warn(`[geocode] nominatim failed for "${trimmed}": ${err.message}`);
      }

      try {
        return await viaOpenTripMap(trimmed);
      } catch (err: any) {
        logger.warn(`[geocode] OpenTripMap fallback failed for "${trimmed}": ${err.message}`);
        return null;
      }
    },
    GEOCODE_TTL_SECONDS,
    { provider: 'Geocoding' },
  );
}
