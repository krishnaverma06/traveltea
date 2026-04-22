import { z } from "zod";
import { flightsAPI } from "./api.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const searchFlightsTool = {
  name: "search_flights",
  description:
    "Search for flights between two airports/cities using live Google Flights data (real airlines, prices, durations). Requires a departure date — never guess one.",
  inputSchema: z.object({
    origin: z.string().min(1).describe("Departure city or 3-letter IATA airport code"),
    destination: z.string().min(1).describe("Arrival city or 3-letter IATA airport code"),
    departDate: z.string().regex(DATE_RE).describe("Outbound date, YYYY-MM-DD"),
    returnDate: z.string().regex(DATE_RE).optional().describe("Return date for a round-trip, YYYY-MM-DD"),
    adults: z.number().int().min(1).max(9).optional().default(1),
  }),
  execute: async (args: { origin: string; destination: string; departDate: string; returnDate?: string; adults?: number }) => {
    try {
      const flights = await flightsAPI.searchFlights(args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ flights, count: flights.length }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Flight search failed", details: String(error) }),
          },
        ],
        isError: true,
      };
    }
  },
};

export const flightsTools = [searchFlightsTool];
