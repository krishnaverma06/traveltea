import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import type {
  OpenTripMapPlace,
  PlaceDetails,
  Destination,
  GeoJSONFeatureCollection,
} from "./types.js";

// Ensure environment variables are loaded
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// OpenTripMap API - Get free key at https://opentripmap.io/product
const BASE_URL = "https://api.opentripmap.com/0.1/en/places";

// ---------------------------------------------------------------------------
// Centralized rate limiting
//
// All requests (across every method, and every instance) funnel through a
// single queue so calls are spaced out by MIN_REQUEST_INTERVAL_MS, and any
// 429 / network error is retried with exponential backoff. This replaces the
// three copy-pasted retry blocks that used to live in searchPlaces,
// searchByCategory, and getPlaceDetails (and the missing retry logic in
// getNearbyAttractions).
// ---------------------------------------------------------------------------

const MIN_REQUEST_INTERVAL_MS = 250; // min gap between any two OpenTripMap requests
const DEFAULT_RETRIES = 3;
const BACKOFF_STEP_MS = 500; // attempt 1 -> 500ms, attempt 2 -> 1000ms, ...

let lastRequestTime = 0;
let requestQueue: Promise<void> = Promise.resolve();

/**
 * Runs `fn` after waiting for its turn in the global queue, ensuring at
 * least MIN_REQUEST_INTERVAL_MS has elapsed since the previous request
 * started. Requests are still issued sequentially, but this guarantees
 * pacing even if callers fire things off concurrently.
 */
function throttledRequest<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, lastRequestTime + MIN_REQUEST_INTERVAL_MS - Date.now());
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestTime = Date.now();
    return fn();
  };

  const result = requestQueue.then(run);
  // Keep the chain alive even if this request fails, without leaking the
  // rejection into future `.then`s on requestQueue itself.
  requestQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Wraps a request with the shared throttle plus retry/backoff on 429s and
 * network errors. `label` is only used for log messages.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries: number = DEFAULT_RETRIES,
): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await throttledRequest(fn);
    } catch (error: any) {
      const isRateLimit = error?.response?.status === 429;
      const isNetworkError = !error?.response;
      const canRetry = (isRateLimit || isNetworkError) && attempt < retries;

      console.error(`[OpenTripMapAPI] ${label} error:`, error?.message || "Unknown error");

      if (!canRetry) {
        throw error;
      }

      const backoffMs = (attempt + 1) * BACKOFF_STEP_MS;
      console.log(
        `[OpenTripMapAPI] Rate limit hit or network error, retrying "${label}" in ${backoffMs}ms (${retries - attempt} retries left)`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      attempt++;
    }
  }
}

export class OpenTripMapAPI {
  private apiKey: string;

  constructor(apiKey?: string) {
    // Use provided key, environment variable, or warn
    this.apiKey = apiKey || process.env.OPENTRIPMAP_API_KEY || "";

    console.log("[OpenTripMapAPI] Constructor called");
    console.log(
      "[OpenTripMapAPI] Provided key:",
      apiKey ? `${apiKey.substring(0, 10)}...` : "undefined",
    );
    console.log(
      "[OpenTripMapAPI] Env key:",
      process.env.OPENTRIPMAP_API_KEY
        ? `${process.env.OPENTRIPMAP_API_KEY.substring(0, 10)}...`
        : "undefined",
    );
    console.log(
      "[OpenTripMapAPI] Final key:",
      this.apiKey ? `${this.apiKey.substring(0, 10)}...` : "EMPTY!",
    );

    if (!this.apiKey) {
      console.warn(
        "⚠️  OpenTripMap API key not found. Get your free key at https://opentripmap.io/product",
      );
      console.warn("   Add it to .env as OPENTRIPMAP_API_KEY=your_key_here");
    }
  }

  /**
   * Search for places by name/query.
   * Rate limiting/retry is handled centrally by withRetry/throttledRequest.
   */
  async searchPlaces(query: string, limit: number = 10): Promise<Destination[]> {
    try {
      // First, geocode the query to get coordinates
      const geoResponse = await withRetry(
        () =>
          axios.get(`${BASE_URL}/geoname`, {
            params: { name: query, apikey: this.apiKey },
          }),
        `geoname("${query}")`,
      );

      if (!geoResponse.data || !geoResponse.data.lat) {
        return [];
      }

      const { lat, lon } = geoResponse.data;

      // Get places around those coordinates with GeoJSON format
      const placesResponse = await withRetry(
        () =>
          axios.get(`${BASE_URL}/radius`, {
            params: {
              radius: 5000, // 5km radius
              lon,
              lat,
              limit,
              format: "geojson",
              apikey: this.apiKey,
            },
          }),
        `radius search("${query}")`,
      );

      const geoData = placesResponse.data as GeoJSONFeatureCollection;

      if (!geoData.features || !Array.isArray(geoData.features)) {
        console.error("Unexpected response format:", geoData);
        return [];
      }

      return this.transformGeoJSONFeatures(geoData.features);
    } catch (error) {
      // withRetry already logged the underlying error/backoff attempts
      return [];
    }
  }

  /**
   * Search places by category (museums, restaurants, nature, etc.)
   * Useful for building diverse itineraries.
   */
  async searchByCategory(
    lat: number,
    lon: number,
    category: string,
    radius: number = 5000,
    limit: number = 10,
  ): Promise<Destination[]> {
    try {
      const response = await withRetry(
        () =>
          axios.get(`${BASE_URL}/radius`, {
            params: {
              radius,
              lon,
              lat,
              kinds: category, // e.g., 'museums', 'restaurants', 'natural'
              limit,
              format: "geojson",
              apikey: this.apiKey,
            },
          }),
        `category search(${category})`,
      );

      const geoData = response.data as GeoJSONFeatureCollection;
      if (!geoData.features || !Array.isArray(geoData.features)) {
        return [];
      }

      return this.transformGeoJSONFeatures(geoData.features);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get multiple categories of places for itinerary building.
   * Returns a diverse set of attractions, restaurants, and activities.
   * The shared throttle/queue already spaces these out, so the manual
   * inter-request delays are no longer needed.
   */
  async getItineraryPlaces(
    lat: number,
    lon: number,
    radius: number = 5000,
  ): Promise<{
    attractions: Destination[];
    restaurants: Destination[];
    nature: Destination[];
    culture: Destination[];
  }> {
    try {
      const attractions = await this.searchByCategory(lat, lon, "interesting_places", radius, 10);
      const restaurants = await this.searchByCategory(lat, lon, "foods", radius, 5);
      const nature = await this.searchByCategory(lat, lon, "natural", radius, 5);
      const culture = await this.searchByCategory(
        lat,
        lon,
        "cultural,museums,theatres_and_entertainments",
        radius,
        8,
      );

      return { attractions, restaurants, nature, culture };
    } catch (error) {
      console.error("[OpenTripMapAPI] itinerary places error:", error);
      return { attractions: [], restaurants: [], nature: [], culture: [] };
    }
  }

  /**
   * Get detailed information about a specific place.
   */
  async getPlaceDetails(xid: string): Promise<PlaceDetails | null> {
    try {
      const response = await withRetry(
        () => axios.get(`${BASE_URL}/xid/${xid}`, { params: { apikey: this.apiKey } }),
        `place details(${xid})`,
      );

      const details = response.data as PlaceDetails;

      if (!details) {
        console.error("Unexpected response format:", details);
        return null;
      }

      return details;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get nearby attractions given coordinates.
   * (Previously had no retry/backoff at all — now consistent with the rest
   * of the class.)
   */
  async getNearbyAttractions(
    lat: number,
    lon: number,
    radius: number = 3000,
    limit: number = 20,
    kinds?: string,
  ): Promise<Destination[]> {
    try {
      const response = await withRetry(
        () =>
          axios.get(`${BASE_URL}/radius`, {
            params: {
              radius,
              lon,
              lat,
              limit,
              kinds,
              format: "geojson",
              apikey: this.apiKey,
            },
          }),
        "nearby attractions",
      );

      const geoData = response.data as GeoJSONFeatureCollection;

      if (!geoData.features || !Array.isArray(geoData.features)) {
        console.error("Unexpected response format:", geoData);
        return [];
      }

      return this.transformGeoJSONFeatures(geoData.features);
    } catch (error) {
      return [];
    }
  }

  /**
   * Transform GeoJSON features to our destination format
   */
  private transformGeoJSONFeatures(
    features: GeoJSONFeatureCollection["features"],
  ): Destination[] {
    return features
      .filter(
        (feature) =>
          feature.properties.name && feature.properties.name.trim() !== "",
      )
      .map((feature) => ({
        id: feature.properties.xid,
        name: feature.properties.name,
        location: {
          latitude: feature.geometry.coordinates[1], // GeoJSON is [lon, lat]
          longitude: feature.geometry.coordinates[0],
        },
        category: feature.properties.kinds
          ? feature.properties.kinds.split(",")
          : [],
        distance: feature.properties.dist,
        rating: feature.properties.rate,
      }));
  }

  /**
   * Get enriched place details with description and image
   */
  async getEnrichedPlaceDetails(xid: string): Promise<Destination | null> {
    const details = await this.getPlaceDetails(xid);

    if (!details) {
      return null;
    }

    return {
      id: details.xid,
      name: details.name,
      description: details.wikipedia_extracts?.text || details.kinds,
      location: {
        latitude: details.point.lat,
        longitude: details.point.lon,
      },
      category: details.kinds ? details.kinds.split(",") : [],
      rating: details.rate,
      image: details.preview?.source || details.image,
    };
  }
}

// Lazy singleton instance - only created when first accessed
let _openTripMapAPIInstance: OpenTripMapAPI | null = null;

export function getOpenTripMapAPI(): OpenTripMapAPI {
  if (!_openTripMapAPIInstance) {
    // Explicitly pass API key from environment
    const apiKey = process.env.OPENTRIPMAP_API_KEY || "";
    _openTripMapAPIInstance = new OpenTripMapAPI(apiKey);
  }
  return _openTripMapAPIInstance;
}

// For backward compatibility
export const openTripMapAPI = new Proxy({} as OpenTripMapAPI, {
  get(target, prop) {
    return getOpenTripMapAPI()[prop as keyof OpenTripMapAPI];
  },
});