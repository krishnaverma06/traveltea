import type { z } from 'zod';
import { placesTools } from '../mcp-servers/places/tools.js';
import { transportTools } from '../mcp-servers/transport/tools.js';
import { webSearchTools } from '../mcp-servers/websearch/tools.js';
import { eventsTools } from '../mcp-servers/events/tools.js';
import { accountTools } from './tools/account.js';

/**
 * Tool Registry
 * Central registry of all available tools for the travel agent
 */

export interface Tool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (args: any) => Promise<any>;
  // If true, this tool requires a server-trusted userId. The planner never
  // exposes `userId` in the schema it binds to the LLM, and the tool
  // executor always overwrites `args.userId` from the authenticated
  // request — this flag is what tells both of those to kick in.
  userScoped?: boolean;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerAllTools();
  }

  /**
   * Register all available tools
   */
  private registerAllTools() {
    // Register places tools
    placesTools.forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register transport tools
    transportTools.forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register web search tools
    webSearchTools.forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register events tools
    eventsTools.forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register account tools (saved trips, preferences)
    accountTools.forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    console.log(`📦 [TOOL REGISTRY] Registered ${this.tools.size} tools`);
  }

  /**
   * Get a tool by name
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tools
   */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Execute a tool by name
   */
  async executeTool(name: string, args: any): Promise<any> {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    // Enforcing as of Phase 2: args now only ever come from Gemini's
    // structured tool_calls (schema-bound) or the fallback mapper (built
    // against the same schemas), so a mismatch means something is actually
    // wrong rather than pre-existing call-site drift. Use check.data (not
    // raw args) so Zod .default()s apply centrally.
    const check = tool.inputSchema?.safeParse?.(args);
    if (check && !check.success) {
      console.warn(`⚠️ [TOOL REGISTRY] Args for "${name}" failed schema validation:`, check.error.issues);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: `Invalid arguments for ${name}` }),
          },
        ],
        isError: true,
      };
    }

    console.log(`🔧 [TOOL REGISTRY] Executing tool: ${name}`);
    return await tool.execute(check ? check.data : args);
  }

  /**
   * Execute multiple tools in parallel
   */
  async executeTools(toolCalls: Array<{ name: string; args: any }>): Promise<any[]> {
    console.log(`🔧 [TOOL REGISTRY] Executing ${toolCalls.length} tools in parallel`);
    
    const results = await Promise.allSettled(
      toolCalls.map(({ name, args }) => this.executeTool(name, args))
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        console.error(`Tool ${toolCalls[index].name} failed:`, result.reason);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Tool execution failed: ${result.reason}` }),
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Get tool descriptions for LLM context
   */
  getToolDescriptions(): string {
    const descriptions = this.getAllTools().map(tool => 
      `- ${tool.name}: ${tool.description}`
    );
    return descriptions.join('\n');
  }

  /**
   * Map intent to tools
   */
  getToolsForIntent(intent: string): string[] {
    const intentToolMap: Record<string, string[]> = {
      search_destination: ['search_destinations', 'get_place_details'],
      search_attractions: ['search_destinations', 'get_nearby_attractions', 'search_by_category'],
      search_hotels: ['search_destinations'], // Placeholder until hotel tool is added
      search_flights: ['calculate_distance'], // Placeholder until flight tool is added
      search_restaurants: ['search_restaurants'],
      plan_trip: ['search_destinations', 'get_nearby_attractions', 'search_restaurants', 'calculate_distance'],
      get_details: ['get_place_details'],
      find_nearby: ['get_nearby_attractions'],
      calculate_distance: ['calculate_distance'],
      get_directions: ['get_directions'],
      web_search: ['web_search', 'search_travel_tips'],
      estimate_budget: ['web_search'],
      search_events: ['search_events'],
      list_saved_trips: ['list_saved_trips'],
      get_upcoming_trip: ['get_upcoming_trip'],
      get_travel_preferences: ['get_travel_preferences'],
      update_travel_preferences: ['update_travel_preferences'],
      casual_chat: [],
      unknown: [],
    };

    return intentToolMap[intent] || [];
  }
}

// Export singleton instance
export const toolRegistry = new ToolRegistry();