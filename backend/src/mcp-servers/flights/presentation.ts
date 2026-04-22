import type { Presentation } from '../../mcp/createDomainServer.js';

/**
 * Markdown rendering for flight search — same reasoning as the hotels
 * renderer: previously only the booking pipeline consumed these results, but
 * a plain "find flights from A to B" now reaches the formatter directly.
 */
const timeOf = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      });
};

export const flightsPresentation: Presentation = {
  search_flights: (p: any) => {
    const flights = p?.flights || [];

    if (flights.length === 0) {
      return (
        `I couldn't find any flights for that route and date.\n\n` +
        `Double-check the airports and try a nearby date — flight data is only ` +
        `available for real scheduled routes. ✈️`
      );
    }

    let out = `## ✈️ Flights\n\n`;
    flights.slice(0, 5).forEach((f: any, i: number) => {
      const route = `${f.departure?.iata || '?'} → ${f.arrival?.iata || '?'}`;
      out += `${i + 1}. **${f.airline || 'Airline'}** — ${route}\n`;
      if (f.departure?.at) out += `   🛫 ${timeOf(f.departure.at)}`;
      if (f.arrival?.at) out += `   🛬 ${timeOf(f.arrival.at)}`;
      if (f.departure?.at || f.arrival?.at) out += '\n';
      if (f.duration) out += `   ⏱️ ${f.duration}\n`;
      if (f.price?.amount) out += `   💰 ${f.price.currency || ''} ${f.price.amount}\n`;
      out += '\n';
    });

    if (flights.length > 5) out += `_…and ${flights.length - 5} more._\n\n`;
    out += `Say "book a flight" with your route and date and I'll take you through it. ✨`;
    return out;
  },
};
