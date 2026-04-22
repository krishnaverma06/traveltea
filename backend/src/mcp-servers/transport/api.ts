import axios from 'axios';
import { sharedCache } from '../../utils/cache.js';
import { geocodePlace } from '../../services/geocoding.js';

/**
 * Transport and Distance API
 * Real routing via Geoapify's Routing API (GEOAPIFY_API_KEY, already
 * configured). Falls back to Nominatim geocoding + a Haversine
 * straight-line estimate if the real routing call fails for any reason
 * (no key, network error, malformed response) — matches this codebase's
 * pervasive degrade-gracefully convention rather than a hard dependency
 * on a third external API.
 */

export interface DistanceResult {
  distance_km: number;
  duration_minutes: number;
  origin: { lat: number; lon: number; name: string };
  destination: { lat: number; lon: number; name: string };
}

export interface DirectionsResult {
  distance_km: number;
  duration_minutes: number;
  steps: Array<{
    instruction: string;
    distance_km: number;
    duration_minutes: number;
  }>;
  geometry: {
    type: string;
    coordinates: number[][];
  };
}

const GEOAPIFY_MODE: Record<'driving' | 'walking' | 'cycling', 'drive' | 'walk' | 'bicycle'> = {
  driving: 'drive',
  walking: 'walk',
  cycling: 'bicycle',
};

type Coords = { lat: number; lon: number };

export class TransportAPI {
  private get geoapifyKey(): string {
    return process.env.GEOAPIFY_API_KEY || '';
  }
  private geoapifyBaseURL = 'https://api.geoapify.com/v1/routing';

  /**
   * Calculate distance between two locations
   */
  async calculateDistance(
    origin: string,
    destination: string
  ): Promise<DistanceResult | null> {
    const [originCoords, destCoords] = await Promise.all([
      this.geocodeLocation(origin),
      this.geocodeLocation(destination),
    ]);

    if (!originCoords || !destCoords) {
      return null;
    }

    const geo = await this.routeGeoapify([originCoords, destCoords], 'drive');
    const feature = geo?.features?.[0]?.properties;
    if (feature) {
      return {
        distance_km: Math.round((feature.distance / 1000) * 10) / 10,
        duration_minutes: Math.round(feature.time / 60),
        origin: { ...originCoords, name: origin },
        destination: { ...destCoords, name: destination },
      };
    }

    return this.haversineDistanceResult(originCoords, destCoords, origin, destination);
  }

  /**
   * Geocode a location name to coordinates
   * Uses OpenStreetMap Nominatim (free, no API key required)
   */
  /**
   * Delegates to the shared resolver in services/geocoding.ts. This used to be
   * its own un-throttled, un-cached Nominatim call sending a stale
   * "TripWhat Travel Planner" User-Agent — a second implementation that could
   * breach Nominatim's 1 req/s policy whenever it ran alongside a places
   * lookup. One implementation now, with a shared queue and a 30-day cache.
   */
  private async geocodeLocation(locationName: string): Promise<{ lat: number; lon: number } | null> {
    const hit = await geocodePlace(locationName);
    return hit ? { lat: hit.lat, lon: hit.lon } : null;
  }

  /**
   * Real routing via Geoapify — the single network call backing all 3
   * public methods, cached (road-network geometry is effectively static).
   * Returns null on any failure so callers can fall back to Haversine.
   */
  private async routeGeoapify(points: Coords[], mode: 'drive' | 'walk' | 'bicycle'): Promise<any | null> {
    if (!this.geoapifyKey || points.length < 2) return null;

    const waypoints = points.map((p) => `${p.lat},${p.lon}`).join('|');
    const cacheKey = sharedCache.generateKey('geoapify_route', { waypoints, mode });

    try {
      return await sharedCache.fetchOrCache(
        cacheKey,
        async () => {
          const response = await axios.get(this.geoapifyBaseURL, {
            params: { waypoints, mode, apiKey: this.geoapifyKey },
          });
          if (!response.data?.features?.[0]) {
            throw new Error('Geoapify: empty route response');
          }
          return response.data;
        },
        86400, // 24h
        { provider: 'Geoapify' }
      );
    } catch (error) {
      console.error('Geoapify routing failed, falling back to Haversine:', error);
      return null;
    }
  }

  /**
   * Haversine formula for great-circle distance
   * Returns distance in kilometers
   */
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /** Fallback: the original Haversine + flat-60km/h estimate. */
  private haversineDistanceResult(
    originCoords: Coords,
    destCoords: Coords,
    origin: string,
    destination: string
  ): DistanceResult {
    const distance = this.haversineDistance(originCoords.lat, originCoords.lon, destCoords.lat, destCoords.lon);
    const duration = (distance / 60) * 60; // assumes flat 60 km/h, in minutes

    return {
      distance_km: Math.round(distance * 10) / 10,
      duration_minutes: Math.round(duration),
      origin: { ...originCoords, name: origin },
      destination: { ...destCoords, name: destination },
    };
  }

  /**
   * Get routing directions
   */
  async getDirections(
    origin: string,
    destination: string,
    mode: 'driving' | 'walking' | 'cycling' = 'driving'
  ): Promise<DirectionsResult | null> {
    const [originCoords, destCoords] = await Promise.all([
      this.geocodeLocation(origin),
      this.geocodeLocation(destination),
    ]);
    if (!originCoords || !destCoords) return null;

    const geo = await this.routeGeoapify([originCoords, destCoords], GEOAPIFY_MODE[mode]);
    const feature = geo?.features?.[0];
    if (feature) {
      const props = feature.properties;
      const rawSteps = props.legs?.[0]?.steps || [];
      return {
        distance_km: Math.round((props.distance / 1000) * 10) / 10,
        duration_minutes: Math.round(props.time / 60),
        steps:
          rawSteps.length > 0
            ? rawSteps.map((s: any) => ({
                instruction: s.instruction?.text || `Continue for ${Math.round(s.distance)}m`,
                distance_km: Math.round((s.distance / 1000) * 10) / 10,
                duration_minutes: Math.round(s.time / 60),
              }))
            : [
                {
                  instruction: `Head from ${origin} to ${destination}`,
                  distance_km: Math.round((props.distance / 1000) * 10) / 10,
                  duration_minutes: Math.round(props.time / 60),
                },
              ],
        // Geoapify returns MultiLineString; flatten to the single flat
        // coordinate list DirectionsResult.geometry.coordinates expects.
        geometry: {
          type: feature.geometry.type,
          coordinates: feature.geometry.coordinates.flat(1),
        },
      };
    }

    return this.haversineDirectionsResult(originCoords, destCoords, origin, destination, mode);
  }

  /** Fallback: the original flat-per-mode-speed + straight-line estimate. */
  private haversineDirectionsResult(
    originCoords: Coords,
    destCoords: Coords,
    origin: string,
    destination: string,
    mode: 'driving' | 'walking' | 'cycling'
  ): DirectionsResult {
    const distanceInfo = this.haversineDistanceResult(originCoords, destCoords, origin, destination);

    let duration = distanceInfo.duration_minutes;
    if (mode === 'walking') {
      duration = (distanceInfo.distance_km / 5) * 60; // 5 km/h walking speed
    } else if (mode === 'cycling') {
      duration = (distanceInfo.distance_km / 15) * 60; // 15 km/h cycling speed
    }

    return {
      distance_km: distanceInfo.distance_km,
      duration_minutes: Math.round(duration),
      steps: [
        {
          instruction: `Head from ${origin} to ${destination}`,
          distance_km: distanceInfo.distance_km,
          duration_minutes: Math.round(duration),
        },
      ],
      geometry: {
        type: 'LineString',
        coordinates: [
          [distanceInfo.origin.lon, distanceInfo.origin.lat],
          [distanceInfo.destination.lon, distanceInfo.destination.lat],
        ],
      },
    };
  }

  /**
   * Estimate travel time between multiple waypoints. Uses Geoapify's
   * native multi-waypoint support (one request) when every waypoint
   * geocodes successfully; falls back to the pairwise loop (which itself
   * tries Geoapify per-leg, then Haversine) otherwise — preserving the
   * original "skip just the bad leg" behavior when one waypoint fails to
   * geocode, since a single multi-waypoint Geoapify request can't skip an
   * index.
   */
  async estimateMultiStopRoute(waypoints: string[]): Promise<{
    total_distance_km: number;
    total_duration_minutes: number;
    legs: Array<{ from: string; to: string; distance_km: number; duration_minutes: number }>;
  } | null> {
    const coords = await Promise.all(waypoints.map((w) => this.geocodeLocation(w)));

    if (!coords.some((c) => !c)) {
      const geo = await this.routeGeoapify(coords as Coords[], 'drive');
      const props = geo?.features?.[0]?.properties;
      if (props?.legs) {
        const legs = props.legs.map((leg: any, i: number) => ({
          from: waypoints[i],
          to: waypoints[i + 1],
          distance_km: Math.round((leg.distance / 1000) * 10) / 10,
          duration_minutes: Math.round(leg.time / 60),
        }));
        return {
          total_distance_km: Math.round((props.distance / 1000) * 10) / 10,
          total_duration_minutes: Math.round(props.time / 60),
          legs,
        };
      }
    }

    return this.pairwiseFallbackRoute(waypoints);
  }

  /** Fallback: the original pairwise-loop-over-calculateDistance logic. */
  private async pairwiseFallbackRoute(waypoints: string[]): Promise<{
    total_distance_km: number;
    total_duration_minutes: number;
    legs: Array<{ from: string; to: string; distance_km: number; duration_minutes: number }>;
  } | null> {
    try {
      const legs: Array<{ from: string; to: string; distance_km: number; duration_minutes: number }> = [];
      let totalDistance = 0;
      let totalDuration = 0;

      for (let i = 0; i < waypoints.length - 1; i++) {
        const leg = await this.calculateDistance(waypoints[i], waypoints[i + 1]);
        if (leg) {
          legs.push({
            from: waypoints[i],
            to: waypoints[i + 1],
            distance_km: leg.distance_km,
            duration_minutes: leg.duration_minutes,
          });
          totalDistance += leg.distance_km;
          totalDuration += leg.duration_minutes;
        }
      }

      return {
        total_distance_km: Math.round(totalDistance * 10) / 10,
        total_duration_minutes: Math.round(totalDuration),
        legs,
      };
    } catch (error) {
      console.error('Multi-stop route error:', error);
      return null;
    }
  }
}

// Export singleton instance
export const transportAPI = new TransportAPI();
