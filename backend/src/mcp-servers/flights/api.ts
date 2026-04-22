import { getJson } from "serpapi";
import { sharedCache } from "../../utils/cache.js";
import type { NormalizedFlight } from "../../models/travelData.js";
import { resolveToIata } from "./iata.js";

export interface FlightSearchParams {
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  adults?: number;
  currency?: string;
}

/**
 * Real flight search via SerpAPI's google_flights engine — a legitimate
 * scraping-as-a-service (SerpAPI scrapes Google Flights' result pages for
 * us), not a raw HTML scraper against airline sites. No Amadeus (not free,
 * per the roadmap's decision).
 *
 * departure_id/arrival_id are documented by SerpAPI as IATA code or Google
 * location kgmid — free-text city names are passed through as-is, not
 * guaranteed to resolve. No city->IATA lookup table is built here; an
 * unresolvable input degrades to an empty result, same as every other
 * graceful-degradation path in this codebase.
 */
export class FlightsAPI {
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

  async searchFlights(params: FlightSearchParams): Promise<NormalizedFlight[]> {
    if (!this.apiKey) {
      console.warn("⚠️ [FLIGHTS] SERPAPI key not configured, skipping flight search");
      return [];
    }

    const { origin: rawOrigin, destination: rawDestination, departDate, returnDate, adults = 1, currency = "USD" } = params;

    // Resolve city names to IATA codes before anything else. SerpAPI silently
    // returns nothing for free text, so "Delhi -> Mumbai" used to come back
    // empty for both the REST search and the chat agent. Unresolvable input is
    // passed through untouched.
    const origin = resolveToIata(rawOrigin);
    const destination = resolveToIata(rawDestination);
    if (origin !== rawOrigin || destination !== rawDestination) {
      console.log(`✈️ [FLIGHTS] Resolved "${rawOrigin}" -> ${origin}, "${rawDestination}" -> ${destination}`);
    }

    const cacheKey = sharedCache.generateKey("serpapi_flights", {
      origin,
      destination,
      departDate,
      returnDate: returnDate || "",
      adults,
      currency,
    });

    try {
      return await sharedCache.fetchOrCache<NormalizedFlight[]>(
        cacheKey,
        async () => {
          console.log(`✈️ [FLIGHTS] Searching via SerpApi: ${origin} -> ${destination} on ${departDate}`);

          const query: Record<string, any> = {
            engine: "google_flights",
            departure_id: origin.trim(),
            arrival_id: destination.trim(),
            outbound_date: departDate,
            api_key: this.apiKey,
            currency,
            adults,
            type: returnDate ? 1 : 2, // 1=round-trip, 2=one-way
          };
          if (returnDate) query.return_date = returnDate;

          const json = await getJson(query);
          // Thrown here (not returned) so cache.set only ever caches a
          // real, successful result — a transient SerpAPI error can be
          // retried on the next search instead of being cached as empty.
          if (json.error) throw new Error(`SerpAPI google_flights: ${json.error}`);

          const options = [...(json.best_flights || []), ...(json.other_flights || [])];
          return this.normalizeFlights(options, currency);
        },
        3600, // 1h — matches amadeusService.getFlights's precedent
        { provider: "SerpApiFlights" }
      );
    } catch (err) {
      console.error("FlightsAPI.searchFlights failed:", err);
      return [];
    }
  }

  private normalizeFlights(options: any[], currency: string): NormalizedFlight[] {
    return options.map((opt, idx) => {
      const legs = opt.flights || [];
      const first = legs[0];
      const last = legs[legs.length - 1];
      const totalMinutes = opt.total_duration || 0;

      return {
        id: opt.booking_token || opt.departure_token || `flight-${idx}`,
        airline: first?.airline || "Unknown",
        departure: {
          iata: first?.departure_airport?.id || "",
          at: first?.departure_airport?.time || "",
        },
        arrival: {
          iata: last?.arrival_airport?.id || "",
          at: last?.arrival_airport?.time || "",
        },
        duration: `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`,
        price: { amount: String(opt.price ?? ""), currency },
        stops: Math.max(legs.length - 1, 0),
      };
    });
  }
}

export const flightsAPI = new FlightsAPI();
