import { getJson } from "serpapi";
import { sharedCache } from "../../utils/cache.js";
import type { NormalizedHotel } from "../../models/travelData.js";

export interface HotelSearchParams {
  destination: string;
  checkIn: string;
  checkOut: string;
  adults?: number;
  currency?: string;
}

/**
 * Real hotel search via SerpAPI's google_hotels engine — same rationale as
 * flights/api.ts: legitimate scraping-as-a-service, no Amadeus.
 */
export class HotelsAPI {
  /**
   * Whether a SerpAPI key is present. Both search methods degrade to an empty
   * array on every failure — missing key, SerpAPI error, network — which means
   * a caller cannot tell "no results" from "search is unavailable". A REST
   * endpoint needs that distinction to avoid telling users there are no
   * flights when the integration simply isn't configured.
   */
  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private get apiKey(): string {
    return process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY || process.env.SERPAPI_KEY || "";
  }

  async searchHotels(params: HotelSearchParams): Promise<NormalizedHotel[]> {
    if (!this.apiKey) {
      console.warn("⚠️ [HOTELS] SERPAPI key not configured, skipping hotel search");
      return [];
    }

    const { destination, checkIn, checkOut, adults = 2, currency = "USD" } = params;
    const cacheKey = sharedCache.generateKey("serpapi_hotels", {
      destination,
      checkIn,
      checkOut,
      adults,
      currency,
    });

    try {
      return await sharedCache.fetchOrCache<NormalizedHotel[]>(
        cacheKey,
        async () => {
          console.log(`🏨 [HOTELS] Searching via SerpApi: ${destination}, ${checkIn} -> ${checkOut}`);

          const json = await getJson({
            engine: "google_hotels",
            q: destination,
            check_in_date: checkIn,
            check_out_date: checkOut,
            api_key: this.apiKey,
            adults,
            currency,
          });
          if (json.error) throw new Error(`SerpAPI google_hotels: ${json.error}`);

          return this.normalizeHotels(json.properties || [], currency);
        },
        86400, // 24h — matches amadeusService.getHotels's precedent
        { provider: "SerpApiHotels" }
      );
    } catch (err) {
      console.error("HotelsAPI.searchHotels failed:", err);
      return [];
    }
  }

  private normalizeHotels(properties: any[], currency: string): NormalizedHotel[] {
    return properties.map((p) => ({
      id: p.property_token || p.name,
      name: p.name,
      rating: p.overall_rating || 0,
      image: p.images?.[0]?.thumbnail || p.images?.[0]?.original_image || null,
      address: p.address || "",
      price: p.rate_per_night
        ? { amount: String(p.rate_per_night.extracted_lowest ?? p.rate_per_night.lowest ?? ""), currency }
        : undefined,
      amenities: (p.amenities || []).slice(0, 8),
      bookingUrl: p.link,
      location: p.gps_coordinates
        ? { latitude: p.gps_coordinates.latitude, longitude: p.gps_coordinates.longitude }
        : undefined,
    }));
  }
}

export const hotelsAPI = new HotelsAPI();
