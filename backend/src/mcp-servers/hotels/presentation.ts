import type { Presentation } from '../../mcp/createDomainServer.js';

/**
 * Markdown rendering for hotel search.
 *
 * These results previously had no renderer because the only consumer was the
 * booking pipeline, which formats its own option cards. Now that the planner
 * distinguishes browsing ("find hotels in X") from booking ("book a hotel in
 * X"), a plain search reaches the formatter directly and needs its own output.
 */
export const hotelsPresentation: Presentation = {
  search_hotels: (p: any) => {
    const hotels = p?.hotels || [];
    const where = p?.destination;

    if (hotels.length === 0) {
      return (
        `I couldn't find any hotels${where ? ` in **${where}**` : ''} for those dates.\n\n` +
        `Try different dates, or a nearby city. 🏨`
      );
    }

    const dates = p?.checkIn && p?.checkOut ? ` · ${p.checkIn} → ${p.checkOut}` : '';
    let out = `## 🏨 Hotels${where ? ` in ${where}` : ''}${dates}\n\n`;

    hotels.slice(0, 5).forEach((h: any, i: number) => {
      out += `${i + 1}. **${h.name}**\n`;
      if (h.price?.amount) out += `   💰 ${h.price.currency || ''} ${h.price.amount} per night\n`;
      if (h.rating) out += `   ⭐ ${h.rating}\n`;
      if (h.address) out += `   📍 ${h.address}\n`;
      out += '\n';
    });

    if (hotels.length > 5) out += `_…and ${hotels.length - 5} more._\n\n`;
    out += `Say "book a hotel in ${where || 'there'}" and I'll walk you through reserving one. ✨`;
    return out;
  },
};
