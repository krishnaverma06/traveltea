import type { Presentation } from '../../mcp/createDomainServer.js';

/**
 * Markdown rendering for the events domain.
 *
 * This is a TravelTea convention, not an MCP concern — the map is injected at
 * the hub's wiring site, so `createDomainServer('traveltea-events', tools)`
 * without it still yields a clean, spec-standard server. See
 * mcp/createDomainServer.ts.
 *
 * Moved verbatim from TravelAgent.formatEvents.
 */
export const eventsPresentation: Presentation = {
  search_events: (data: any) => {
    const events = data?.events || [];
    if (events.length === 0) {
      return `I couldn't find any listed events in **${data?.city}** between ${data?.startDate} and ${data?.endDate}.`;
    }

    let response = `## 🎟️ Events in ${data.city}\n\n`;
    for (const event of events.slice(0, 8)) {
      const when = event.time ? `${event.startDate} at ${event.time}` : event.startDate;
      response += `- **[${event.name}](${event.ticketUrl})** — ${when}, ${event.venue}\n`;
    }
    return response;
  },
};
