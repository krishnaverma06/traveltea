import axios from 'axios';
import { logger } from '../utils/logger';
import { sharedCache } from '../utils/cache';
import { NormalizedFlight, NormalizedHotel } from '../models/travelData';

export class AmadeusService {
  private get apiKey(): string {
    return process.env.AMADEUS_API_KEY || '';
  }

  private get apiSecret(): string {
    return process.env.AMADEUS_API_SECRET || '';
  }

  private get baseUrl(): string {
    return process.env.AMADEUS_HOSTNAME === 'production' 
      ? 'https://api.amadeus.com' 
      : 'https://test.api.amadeus.com';
  }

  private async fetchWithRetry<T>(fn: () => Promise<T>, retries = 2, delay = 1000): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      if (retries === 0 || (error.response && error.response.status >= 400 && error.response.status < 500 && error.response.status !== 429 && error.response.status !== 401)) {
        throw error;
      }
      // If 401, we might need a new token, but the token fetcher should handle that logic.
      logger.warn(`Retrying Amadeus API. Retries left: ${retries - 1}`);
      await new Promise((res) => setTimeout(res, delay));
      return this.fetchWithRetry(fn, retries - 1, delay * 2);
    }
  }

  private async getAccessToken(): Promise<string> {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error("Amadeus credentials missing");
    }

    return sharedCache.fetchOrCache<string>(
      'amadeus_token',
      async () => {
        const response = await axios.post(
          `${this.baseUrl}/v1/security/oauth2/token`,
          new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.apiKey,
            client_secret: this.apiSecret
          }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        return response.data.access_token;
      },
      1700, // Amadeus tokens expire in 1800s (30m), cache for 28m
      { provider: 'AmadeusAuth' }
    );
  }

  private normalizeFlights(flightOffers: any[]): NormalizedFlight[] {
    if (!flightOffers || !Array.isArray(flightOffers)) return [];

    return flightOffers.map(offer => {
      const it = offer.itineraries?.[0];
      const segments = it?.segments || [];
      const firstSegment = segments[0];
      const lastSegment = segments[segments.length - 1];

      return {
        id: offer.id,
        airline: firstSegment?.carrierCode || 'Unknown',
        departure: {
          iata: firstSegment?.departure?.iataCode || '',
          at: firstSegment?.departure?.at || ''
        },
        arrival: {
          iata: lastSegment?.arrival?.iataCode || '',
          at: lastSegment?.arrival?.at || ''
        },
        duration: it?.duration || '',
        price: {
          amount: offer.price?.total || '',
          currency: offer.price?.currency || ''
        },
        stops: segments.length - 1
      };
    });
  }

  async getFlights(originIata: string, destIata: string, date: string): Promise<NormalizedFlight[]> {
    if (!this.apiKey || !originIata || !destIata) {
      logger.warn('Amadeus API Key or IATA codes missing. Returning empty flights.');
      return [];
    }

    const cacheKey = sharedCache.generateKey('amadeus_flights', { originIata, destIata, date });

    return sharedCache.fetchOrCache<NormalizedFlight[]>(
      cacheKey,
      async () => {
        const token = await this.getAccessToken();
        const fetcher = async () => {
          const response = await axios.get(`${this.baseUrl}/v2/shopping/flight-offers`, {
            params: {
              originLocationCode: originIata,
              destinationLocationCode: destIata,
              departureDate: date,
              adults: 1,
              max: 5
            },
            headers: { Authorization: `Bearer ${token}` },
            timeout: 10000
          });
          return this.normalizeFlights(response.data.data || []);
        };
        return this.fetchWithRetry(fetcher);
      },
      3600,
      { provider: 'Amadeus' }
    );
  }

  private normalizeHotels(hotelOffers: any[]): NormalizedHotel[] {
    if (!hotelOffers || !Array.isArray(hotelOffers)) return [];

    return hotelOffers.map(item => {
      const hotel = item.hotel;
      const offer = item.offers?.[0];

      return {
        id: hotel.hotelId,
        name: hotel.name,
        rating: hotel.rating || 3,
        image: null, // Amadeus v3 hotel-search usually requires separate media calls
        address: hotel.address?.lines?.join(', ') || hotel.cityCode,
        price: offer ? {
          amount: offer.price?.total || '',
          currency: offer.price?.currency || ''
        } : undefined,
        amenities: hotel.amenities?.slice(0, 5) || [],
        location: hotel.latitude && hotel.longitude ? {
          latitude: hotel.latitude,
          longitude: hotel.longitude
        } : undefined
      };
    });
  }

  async getHotels(cityCode: string): Promise<NormalizedHotel[]> {
    if (!this.apiKey || !cityCode) {
      return [];
    }

    const cacheKey = sharedCache.generateKey('amadeus_hotels', { cityCode });

    return sharedCache.fetchOrCache<NormalizedHotel[]>(
      cacheKey,
      async () => {
        const token = await this.getAccessToken();
        const fetcher = async () => {
          const response = await axios.get(`${this.baseUrl}/v3/shopping/hotel-offers`, {
            params: {
              cityCode,
              radius: 5,
              radiusUnit: 'KM'
            },
            headers: { Authorization: `Bearer ${token}` },
            timeout: 10000
          });
          return this.normalizeHotels(response.data.data || []);
        };
        return this.fetchWithRetry(fetcher);
      },
      86400,
      { provider: 'Amadeus' }
    );
  }
}

export const amadeusService = new AmadeusService();
