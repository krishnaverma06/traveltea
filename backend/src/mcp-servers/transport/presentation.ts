import type { Presentation } from '../../mcp/createDomainServer.js';

/**
 * Markdown rendering for the transport domain.
 *
 * A TravelTea convention, not an MCP concern — see mcp/createDomainServer.ts.
 * Moved verbatim from TravelAgent.formatDistance / formatDirections /
 * formatRoute.
 */
export const transportPresentation: Presentation = {
  calculate_distance: (details: any) => {
    if (!details) {
      return "❌ No distance information found.";
    }

    if (details.error) {
      return `❌ ${details.error}`;
    }

    if (!details.distance) {
      console.log("Unexpected distance object:", details);
      return "❌ Invalid distance data received.";
    }

    return `
## 📍 Distance Information

**From:** ${details.origin}
**To:** ${details.destination}

🚗 Distance: ${details.distance.kilometers} km (${details.distance.miles} miles)

⏱️ Estimated Time: ${details.estimated_travel_time.by_car_hours} hours
(${details.estimated_travel_time.by_car_minutes} minutes)
`;
  },

  get_directions: (data: any) => {
    if (!data || data.error) {
      return `❌ ${data?.error || "Couldn't get directions for that."}`;
    }
    return `## 🧭 Directions\n\n${data.summary}\n\n🚦 Mode: ${data.mode}\n⏱️ ${data.duration_formatted}`;
  },

  estimate_route: (data: any) => {
    if (!data || data.error) {
      return `❌ ${data?.error || "Couldn't estimate that route."}`;
    }
    let response = `## 🗺️ Multi-Stop Route\n\n**${data.number_of_stops}** stops · ${data.total_distance_km} km · ${data.total_duration_formatted}\n\n`;
    (data.legs || []).forEach((leg: any, i: number) => {
      response += `${i + 1}. ${leg.from} → ${leg.to} (${leg.distance_km} km)\n`;
    });
    return response;
  },
};
