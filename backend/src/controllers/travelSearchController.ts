import { Request, Response } from 'express';
import { flightsAPI } from '../mcp-servers/flights/api.js';
import { hotelsAPI } from '../mcp-servers/hotels/api.js';
import { defaultDates } from '../mcp-servers/hotels/tools.js';
import { searchAirports } from '../mcp-servers/flights/iata.js';

/**
 * REST search for the Flights and Hotels pages.
 *
 * Deliberately calls the same `flightsAPI` / `hotelsAPI` singletons the MCP
 * agent tools use, so SerpAPI response caching (1h flights / 24h hotels) and
 * `sharedCache`'s in-flight request dedup are shared rather than duplicated.
 *
 * Both APIs degrade every failure into an empty array, so each handler reports
 * `configured` separately — otherwise a missing SerpAPI key is indistinguishable
 * from "no flights on that route", which is a miserable thing to debug.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export const searchFlights = async (req: Request, res: Response) => {
  try {
    const origin = str(req.query.origin);
    const destination = str(req.query.destination);
    const departDate = str(req.query.departDate);
    const returnDate = str(req.query.returnDate);
    const adults = Math.min(Math.max(parseInt(String(req.query.adults ?? '1'), 10) || 1, 1), 9);

    if (!origin || !destination) {
      return res.status(400).json({ error: 'origin and destination are required' });
    }
    if (!DATE_RE.test(departDate)) {
      return res.status(400).json({ error: 'departDate is required as YYYY-MM-DD' });
    }
    if (returnDate && !DATE_RE.test(returnDate)) {
      return res.status(400).json({ error: 'returnDate must be YYYY-MM-DD' });
    }
    if (returnDate && returnDate < departDate) {
      return res.status(400).json({ error: 'returnDate cannot be before departDate' });
    }

    // City names are resolved to IATA inside FlightsAPI, so "Delhi" works here.
    const flights = await flightsAPI.searchFlights({
      origin,
      destination,
      departDate,
      returnDate: returnDate || undefined,
      adults,
    });

    return res.json({
      flights,
      count: flights.length,
      configured: flightsAPI.isConfigured(),
      query: { origin, destination, departDate, returnDate: returnDate || null, adults },
    });
  } catch (error: any) {
    console.error('Flight search failed:', error);
    return res.status(500).json({ error: 'Flight search failed', details: error?.message });
  }
};

export const searchHotels = async (req: Request, res: Response) => {
  try {
    const destination = str(req.query.destination);
    let checkIn = str(req.query.checkIn);
    let checkOut = str(req.query.checkOut);
    const adults = Math.min(Math.max(parseInt(String(req.query.adults ?? '2'), 10) || 2, 1), 9);

    if (!destination) {
      return res.status(400).json({ error: 'destination is required' });
    }

    // HotelsAPI requires both dates; the tomorrow/+2-nights defaulting lives in
    // the MCP tool, so reuse it rather than keeping a second copy in sync.
    if (!DATE_RE.test(checkIn) || !DATE_RE.test(checkOut)) {
      const d = defaultDates();
      checkIn = DATE_RE.test(checkIn) ? checkIn : d.checkIn;
      checkOut = DATE_RE.test(checkOut) ? checkOut : d.checkOut;
    }
    if (checkOut <= checkIn) {
      return res.status(400).json({ error: 'checkOut must be after checkIn' });
    }

    const hotels = await hotelsAPI.searchHotels({ destination, checkIn, checkOut, adults });

    const nights = Math.max(
      Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000),
      1,
    );

    return res.json({
      hotels,
      count: hotels.length,
      configured: hotelsAPI.isConfigured(),
      query: { destination, checkIn, checkOut, adults, nights },
    });
  } catch (error: any) {
    console.error('Hotel search failed:', error);
    return res.status(500).json({ error: 'Hotel search failed', details: error?.message });
  }
};

/** Type-ahead for the flight origin/destination inputs. */
export const airportLookup = async (req: Request, res: Response) => {
  try {
    const q = str(req.query.q);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '8'), 10) || 8, 1), 25);
    return res.json({ airports: searchAirports(q, limit) });
  } catch (error: any) {
    console.error('Airport lookup failed:', error);
    return res.status(500).json({ error: 'Airport lookup failed', details: error?.message });
  }
};
