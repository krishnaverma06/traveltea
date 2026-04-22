import { z } from "zod";
import { hotelsAPI } from "./api.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Defaults for a dateless "show me hotels in X" query: tomorrow for 2 nights.
 * Exported because HotelsAPI.searchHotels requires both dates — the REST search
 * controller needs the same defaults rather than a second copy that could drift.
 */
export function defaultDates(): { checkIn: string; checkOut: string } {
  const in1 = new Date();
  in1.setDate(in1.getDate() + 1);
  const in3 = new Date();
  in3.setDate(in3.getDate() + 3);
  return {
    checkIn: in1.toISOString().split("T")[0],
    checkOut: in3.toISOString().split("T")[0],
  };
}

export const searchHotelsTool = {
  name: "search_hotels",
  description:
    "Search for hotels in a destination using live Google Hotels data — real names, ratings, prices and amenities.",
  inputSchema: z.object({
    destination: z.string().min(1),
    checkIn: z.string().regex(DATE_RE).optional().describe("Check-in date, YYYY-MM-DD. Defaults to tomorrow if omitted."),
    checkOut: z.string().regex(DATE_RE).optional().describe("Check-out date, YYYY-MM-DD. Defaults to 2 nights after check-in if omitted."),
    adults: z.number().int().min(1).max(9).optional().default(2),
  }),
  execute: async (args: { destination: string; checkIn?: string; checkOut?: string; adults?: number }) => {
    const defaults = defaultDates();
    const checkIn = args.checkIn || defaults.checkIn;
    const checkOut = args.checkOut || defaults.checkOut;
    try {
      const hotels = await hotelsAPI.searchHotels({
        destination: args.destination,
        checkIn,
        checkOut,
        adults: args.adults,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ destination: args.destination, hotels, count: hotels.length, checkIn, checkOut }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: "Hotel search failed", details: String(error) }),
          },
        ],
        isError: true,
      };
    }
  },
};

export const hotelsTools = [searchHotelsTool];
