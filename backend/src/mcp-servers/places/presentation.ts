import type { Presentation } from '../../mcp/createDomainServer.js';

/**
 * Markdown rendering for the places domain.
 *
 * A TravelTea convention, not an MCP concern — injected at the hub's wiring
 * site so a bare `createDomainServer('traveltea-places', tools)` stays
 * spec-standard. See mcp/createDomainServer.ts.
 *
 * Moved verbatim from TravelAgent.formatSearchResults / formatNearbyAttractions
 * / formatPlaceDetails. The old TOOL_RESULT_MAP `extract` lambdas are folded
 * in here: three tools share the same list renderer but carry their list under
 * different payload keys, which is exactly why that table existed.
 */

function formatPlaceList(results: any[], where?: string, kind = 'places'): string {
  const count = results.length;

  // An empty result set is a real outcome, not a zero-length list to
  // introduce. "I found 0 amazing places! Here are the highlights:" followed
  // by nothing was the old behaviour.
  if (count === 0) {
    const target = where ? `**${where}**` : 'that search';
    return (
      `I couldn't find any ${kind} for ${target}.\n\n` +
      `Try a nearby city or a broader area — or ask me to plan a trip there and I'll build an itinerary instead. 🗺️`
    );
  }

  let response =
    count === 1
      ? `I found 1 great place${where ? ` in **${where}**` : ''}:\n\n`
      : `I found ${count} amazing places${where ? ` in **${where}**` : ''}! Here are the highlights:\n\n`;

  results.slice(0, 5).forEach((place, index) => {
    response += `${index + 1}. **${place.name}**\n`;
    response += `   📍 Location: ${place.location.latitude.toFixed(4)}, ${place.location.longitude.toFixed(4)}\n`;

    if (place.category && place.category.length > 0) {
      response += `   🏷️  Categories: ${place.category.slice(0, 3).join(", ")}\n`;
    }

    if (place.rating) {
      response += `   ⭐ Rating: ${place.rating}/7\n`;
    }

    response += "\n";
  });

  response +=
    "\nWould you like more details about any of these places? Just let me know! 🗺️";
  return response;
}

export const placesPresentation: Presentation = {
  search_destinations: (p: any) => formatPlaceList(p?.destinations || [], p?.query),
  search_by_category: (p: any) => formatPlaceList(p?.places || [], p?.location),
  search_restaurants: (p: any) => formatPlaceList(p?.restaurants || [], p?.location, 'restaurants'),

  get_nearby_attractions: (p: any) => {
    const attractions = p?.attractions || [];
    if (attractions.length === 0) {
      const km = p?.radius ? (p.radius / 1000).toFixed(1).replace(/\.0$/, '') : null;
      return `I couldn't find any attractions${km ? ` within ${km}km of that spot` : ' nearby'}. Try widening the search radius. 🗺️`;
    }
    let response = `Here's what I found nearby:\n\n`;

    attractions.slice(0, 5).forEach((place: any, index: number) => {
      response += `${index + 1}. **${place.name}**\n`;

      if (place.distance) {
        response += `   📏 Distance: ${place.distance}m\n`;
      }

      if (place.category && place.category.length > 0) {
        response += `   🏷️  ${place.category.slice(0, 2).join(", ")}\n`;
      }

      response += "\n";
    });

    response +=
      "\nThese are all within walking distance! Want to add any to your itinerary? ✨";
    return response;
  },

  get_place_details: (details: any) => {
    let response = `# ${details.name}\n\n`;

    if (details.description) {
      response += `${details.description}\n\n`;
    }

    if (details.rating) {
      response += `⭐ **Rating**: ${details.rating}/7\n`;
    }

    if (details.category && details.category.length > 0) {
      response += `🏷️  **Categories**: ${details.category.join(", ")}\n`;
    }

    if (details.image) {
      response += `\n🖼️ [View Image](${details.image})\n`;
    }

    response += "\nWould you like more details about any of these places? ✨";
    return response;
  },
};
