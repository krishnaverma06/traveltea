import type { z } from 'zod';
import { placesTools } from '../mcp-servers/places/tools.js';
import { transportTools } from '../mcp-servers/transport/tools.js';
import { webSearchTools } from '../mcp-servers/websearch/tools.js';
import { eventsTools } from '../mcp-servers/events/tools.js';
import { flightsTools } from '../mcp-servers/flights/tools.js';
import { hotelsTools } from '../mcp-servers/hotels/tools.js';
import { accountTools } from './tools/account.js';
import { accountPresentation } from './tools/account-presentation.js';
import { mcpHub } from '../mcp/hub.js';
import { applyPresentation, type Presentation } from '../mcp/createDomainServer.js';

/**
 * Tool Registry
 *
 * An aggregator over two execution paths:
 *
 *  - The 13 domain tools run inside in-process MCP servers and are called over
 *    real `tools/call` JSON-RPC via `mcpHub`.
 *  - The 4 account tools stay local and off the protocol. They take a
 *    server-trusted `userId`; putting that in an MCP input schema would leak
 *    authentication across the boundary.
 *
 * The tool objects themselves are still imported statically, because they
 * remain the single local source of truth for Zod schemas — `travel-agent.ts`
 * binds those to Gemini. Only *execution* crosses the protocol.
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
  // Shown instead of calling the tool when there's no authenticated user.
  signInMessage?: string;
}

/**
 * Presentation for the local (non-MCP) account tools. The MCP domains get
 * theirs at the hub's wiring site; this is the same convention on the path
 * that doesn't cross the protocol.
 */
const LOCAL_PRESENTATION: Presentation = accountPresentation;

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private localTools: Set<string> = new Set();

  constructor() {
    this.registerAllTools();
  }

  private registerAllTools() {
    const mcpBacked = [
      placesTools,
      transportTools,
      webSearchTools,
      eventsTools,
      flightsTools,
      hotelsTools,
    ];

    for (const group of mcpBacked) {
      for (const tool of group) {
        this.tools.set(tool.name, tool as Tool);
      }
    }

    // Account tools (saved trips, preferences) — local, never over MCP.
    for (const tool of accountTools) {
      this.tools.set(tool.name, tool as Tool);
      this.localTools.add(tool.name);
    }

    console.log(
      `📦 [TOOL REGISTRY] ${this.tools.size} tools ` +
        `(${this.tools.size - this.localTools.size} via MCP, ${this.localTools.size} local)`,
    );
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Execute a tool by name.
   *
   * Signature and return shape are unchanged from before MCP: callers still
   * get `{content:[{type:'text',text:<JSON>}], isError?}` and can JSON.parse
   * content[0].text directly. `mcpHub.callTool` normalises MCP's own
   * non-JSON error paths back into that contract.
   */
  async executeTool(name: string, args: any): Promise<any> {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    // Validate locally before dispatching. MCP would validate again
    // server-side, but doing it here preserves the specific error message
    // this app already returns, and applies Zod .default()s centrally.
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

    const validated = check ? check.data : args;

    if (this.localTools.has(name)) {
      console.log(`🔧 [TOOL REGISTRY] Executing local tool: ${name}`);
      const result = await tool.execute(validated);
      return applyPresentation(result, LOCAL_PRESENTATION[name], `LOCAL:${name}`);
    }

    console.log(`🔧 [TOOL REGISTRY] Executing via MCP: ${name}`);
    return await mcpHub.callTool(name, validated);
  }
}

// Export singleton instance
export const toolRegistry = new ToolRegistry();
