import axios from 'axios';
import { logger } from '../utils/logger';
import { sharedCache } from '../utils/cache';
import { NormalizedEvent } from '../models/travelData';

export class TicketmasterService {
  private get apiKey(): string {
    return process.env.TICKETMASTER_API_KEY || '';
  }

  private async fetchWithRetry<T>(fn: () => Promise<T>, retries = 2, delay = 1000): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      if (retries === 0 || (error.response && error.response.status >= 400 && error.response.status < 500 && error.response.status !== 429)) {
        throw error;
      }
      logger.warn(`Retrying Ticketmaster API. Retries left: ${retries - 1}`);
      await new Promise((res) => setTimeout(res, delay));
      return this.fetchWithRetry(fn, retries - 1, delay * 2);
    }
  }

  private normalizeEvents(eventsData: any[]): NormalizedEvent[] {
    if (!eventsData || !Array.isArray(eventsData)) return [];

    return eventsData.map(event => {
      const venue = event._embedded?.venues?.[0]?.name || 'Venue TBA';
      const city = event._embedded?.venues?.[0]?.city?.name || '';
      const fullVenue = city ? `${venue}, ${city}` : venue;
      
      const images = event.images || [];
      const optimalImage = images.find((img: any) => img.ratio === '16_9' && img.width > 600) || images[0] || null;

      return {
        id: event.id,
        name: event.name,
        startDate: event.dates?.start?.localDate || '',
        time: event.dates?.start?.localTime || '',
        venue: fullVenue,
        imageUrl: optimalImage?.url || null,
        ticketUrl: event.url,
        category: event.classifications?.[0]?.segment?.name || 'Event'
      };
    });
  }

  async getEvents(city: string, startDate: string, endDate: string): Promise<NormalizedEvent[]> {
    if (!this.apiKey) {
      logger.warn('Ticketmaster API Key is missing. Returning empty events.');
      return [];
    }

    const cacheKey = sharedCache.generateKey('ticketmaster', { city: city.toLowerCase(), startDate, endDate });

    return sharedCache.fetchOrCache<NormalizedEvent[]>(
      cacheKey,
      async () => {
        const fetcher = async () => {
          const url = `https://app.ticketmaster.com/discovery/v2/events.json`;
          const params = {
            apikey: this.apiKey,
            city,
            startDateTime: `${startDate}T00:00:00Z`,
            endDateTime: `${endDate}T23:59:59Z`,
            sort: 'date,asc',
            size: 20
          };
          
          const response = await axios.get(url, { params, timeout: 8000 });
          return this.normalizeEvents(response.data._embedded?.events || []);
        };
        return this.fetchWithRetry(fetcher);
      },
      86400, // cache for 24 hours
      { provider: 'Ticketmaster' }
    );
  }
}

export const ticketmasterService = new TicketmasterService();
