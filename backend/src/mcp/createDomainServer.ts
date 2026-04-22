import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

/**
 * The shape every domain tool already had before MCP existed here: a name, a
 * description, a real Zod schema, and an execute() returning the MCP content
 * envelope. Unchanged — nothing app-specific lives on a tool.
 */
export interface DomainTool {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any>;
  execute: (args: any) => Promise<any>;
  userScoped?: boolean;
  signInMessage?: string;
}

/**
 * toolName -> markdown renderer.
 *
 * IMPORTANT: this is a TravelTea convention, NOT part of MCP. The protocol's
 * `content` array is a tool-*result* envelope aimed at the model/client; it
 * says nothing about who owns the host application's presentation. We append
 * a second text block to it purely because it is a convenient carrier that
 * already crosses the boundary.
 *
 * Presentation is injected here at construction time rather than baked into
 * the tool definitions, so `createDomainServer(name, tools)` — with no third
 * argument — yields a clean, spec-standard server with nothing TravelTea-
 * specific in it. That is the seam; keep it.
 */
export type Presentation = Record<string, (payload: any) => string>;

/**
 * Appends the rendered markdown as a second content block, leaving content[0]
 * byte-identical.
 *
 * A crash in presentation must never destroy the payload: McpServer turns any
 * handler throw into a plain-English (non-JSON) error result, which would then
 * break the JSON.parse of content[0] downstream. Losing the markdown block is
 * recoverable; losing the data is not.
 *
 * Shared by createDomainServer and the registry's local (non-MCP) path so both
 * behave identically.
 */
export function applyPresentation(
  result: any,
  render: ((payload: any) => string) | undefined,
  label: string,
): any {
  if (!render || result?.isError) return result;

  try {
    const payload = JSON.parse(result.content[0].text);
    return {
      ...result,
      content: [...result.content, { type: 'text', text: render(payload) }],
    };
  } catch (err) {
    console.warn(`⚠️ [${label}] render failed, returning payload only:`, err);
    return result;
  }
}

export function createDomainServer(
  name: string,
  tools: DomainTool[],
  present: Presentation = {},
): McpServer {
  const server = new McpServer({ name, version: '1.0.0' });

  for (const tool of tools) {
    const render = present[tool.name];

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        // registerTool takes a ZodRawShape, not the ZodObject itself. The SDK
        // converts it to JSON Schema correctly — which is what replaced the
        // old hand-rolled converter that published every non-string type as
        // "number".
        inputSchema: tool.inputSchema.shape,
      },
      async (args: any) => {
        const result = await tool.execute(args);
        return applyPresentation(result, render, `MCP:${name}:${tool.name}`) as CallToolResult;
      },
    );
  }

  return server;
}
