import { z } from 'zod';
import { ticketmasterService } from '../../services/ticketmasterService.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Tool: Search Events
 * Find concerts, sports, festivals and live events in a city
 */
export const searchEventsTool = {
  name: 'search_events',
  description: "Find concerts, sports, festivals and live events happening in a city between two dates. Use when the user asks what's on / what events are happening somewhere.",
  inputSchema: z.object({
    city: z.string().describe('The city to search for events in'),
    startDate: z.string().regex(DATE_RE).optional().describe('Start date (YYYY-MM-DD), defaults to today'),
    endDate: z.string().regex(DATE_RE).optional().describe('End date (YYYY-MM-DD), defaults to 30 days after startDate'),
  }),
  execute: async (args: { city: string; startDate?: string; endDate?: string }) => {
    try {
      const today = new Date();
      const start = args.startDate && args.startDate >= addDays(today, 0) ? args.startDate : addDays(today, 0);
      const end = args.endDate || addDays(new Date(start), args.startDate ? 7 : 30);

      const events = await ticketmasterService.getEvents(args.city, start, end);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              city: args.city,
              startDate: start,
              endDate: end,
              count: events.length,
              events,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Failed to fetch events', details: String(error) }),
          },
        ],
        isError: true,
      };
    }
  },
};

export const eventsTools = [searchEventsTool];
