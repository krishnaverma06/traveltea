import type { Presentation } from '../../mcp/createDomainServer.js';

/**
 * Markdown rendering for the account tools.
 *
 * These four tools stay local and off the protocol — they take a
 * server-trusted userId, and putting that in an MCP input schema would leak
 * authentication across the boundary. So this map is applied by
 * ToolRegistry.executeTool's local branch rather than by createDomainServer,
 * using the same shared `applyPresentation` helper so both paths behave
 * identically.
 *
 * Moved verbatim from TravelAgent.formatSavedTripsList / formatUpcomingTrip /
 * formatPreferences / formatPreferencesUpdated.
 */
export const accountPresentation: Presentation = {
  list_saved_trips: (data: any) => {
    const trips = data?.trips || [];
    if (trips.length === 0) {
      return "You haven't saved any trips yet — want me to help plan one? ✈️";
    }

    let response = `## 🧳 Your Saved Trips\n\nYou have **${data.total}** saved trip${data.total === 1 ? "" : "s"}. Here are your most recent:\n\n`;
    for (const trip of trips) {
      const cities = (trip.cities || []).join(", ") || "Unknown destination";
      response += `**${trip.title}** — ${cities} · ${trip.totalDays} day${trip.totalDays === 1 ? "" : "s"} · starting ${trip.startDate}\n`;
    }
    return response;
  },

  get_upcoming_trip: (data: any) => {
    if (!data?.hasUpcoming) {
      return "You don't have any upcoming trips saved right now. Want to plan one? ✈️";
    }

    const { trip, status, daysUntilStart } = data;
    const cities = (trip.cities || []).join(", ") || "your destination";

    if (status === "in_progress") {
      return `## 🧳 You're on your trip right now!\n\nYou're currently on **${trip.title}** (${cities}) — a ${trip.totalDays}-day trip.`;
    }

    return `## 🧳 Your Next Trip\n\nYour next trip is **${trip.title}** (${cities}), starting in ${daysUntilStart} day${daysUntilStart === 1 ? "" : "s"} on ${trip.startDate}.`;
  },

  get_travel_preferences: (data: any) => {
    const prefs = data?.preferences || {};
    const interests = (prefs.interests || []).length > 0 ? prefs.interests.join(", ") : "none set";
    return `## ⚙️ Your Travel Preferences\n\n- **Budget**: ${prefs.budget || "not set"}\n- **Travel style**: ${prefs.travelStyle || "not set"}\n- **Interests**: ${interests}`;
  },

  update_travel_preferences: (data: any) => {
    const updated = data?.updated || [];
    const prefs = data?.preferences || {};
    const interests = (prefs.interests || []).length > 0 ? prefs.interests.join(", ") : "none set";
    return `## ✅ Preferences Updated\n\nI've updated your **${updated.map((f: string) => f.replace("preferences.", "")).join(", ")}**.\n\nYour preferences are now:\n- **Budget**: ${prefs.budget || "not set"}\n- **Travel style**: ${prefs.travelStyle || "not set"}\n- **Interests**: ${interests}`;
  },
};
