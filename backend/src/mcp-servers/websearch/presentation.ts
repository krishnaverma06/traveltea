import type { Presentation } from '../../mcp/createDomainServer.js';

/**
 * Markdown rendering for the websearch domain.
 *
 * A TravelTea convention, not an MCP concern — see mcp/createDomainServer.ts.
 * Moved verbatim from TravelAgent.formatTravelTips.
 *
 * NOTE: `web_search` deliberately has no entry. Its response is produced by
 * TravelAgent.summarizeWebSearch, which makes an LLM call and needs
 * state.userQuery + state.ragContext — it is not a pure function of the tool
 * payload, so it cannot move behind the boundary. That is the limit of this
 * convention.
 */
export const webSearchPresentation: Presentation = {
  search_travel_tips: (data: any) => {
    const tips = data?.tips || [];
    if (tips.length === 0) {
      return `I couldn't find any travel tips for **${data?.destination}** right now.`;
    }
    let response = `## 💡 Travel Tips for ${data.destination}\n\n`;
    tips.slice(0, 5).forEach((tip: any) => {
      response += `- **${tip.title}** — ${tip.snippet}\n`;
    });
    return response;
  },
};
