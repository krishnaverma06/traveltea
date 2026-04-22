import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createDomainServer, type DomainTool, type Presentation } from './createDomainServer.js';

import { placesTools } from '../mcp-servers/places/tools.js';
import { transportTools } from '../mcp-servers/transport/tools.js';
import { webSearchTools } from '../mcp-servers/websearch/tools.js';
import { eventsTools } from '../mcp-servers/events/tools.js';
import { flightsTools } from '../mcp-servers/flights/tools.js';
import { hotelsTools } from '../mcp-servers/hotels/tools.js';

import { placesPresentation } from '../mcp-servers/places/presentation.js';
import { transportPresentation } from '../mcp-servers/transport/presentation.js';
import { webSearchPresentation } from '../mcp-servers/websearch/presentation.js';
import { eventsPresentation } from '../mcp-servers/events/presentation.js';
import { hotelsPresentation } from '../mcp-servers/hotels/presentation.js';
import { flightsPresentation } from '../mcp-servers/flights/presentation.js';

interface DomainSpec {
  name: string;
  tools: DomainTool[];
  present?: Presentation;
}

/**
 * The six domain servers. Presentation maps get added here as each domain is
 * migrated — the wiring site is the only place TravelTea-specific rendering
 * is attached (see createDomainServer.ts).
 */
const DOMAINS: DomainSpec[] = [
  { name: 'traveltea-places', tools: placesTools as DomainTool[], present: placesPresentation },
  { name: 'traveltea-transport', tools: transportTools as DomainTool[], present: transportPresentation },
  { name: 'traveltea-websearch', tools: webSearchTools as DomainTool[], present: webSearchPresentation },
  { name: 'traveltea-events', tools: eventsTools as DomainTool[], present: eventsPresentation },
  { name: 'traveltea-flights', tools: flightsTools as DomainTool[], present: flightsPresentation },
  { name: 'traveltea-hotels', tools: hotelsTools as DomainTool[], present: hotelsPresentation },
];

const CONNECT_TIMEOUT_MS = 5000;

/**
 * Runs the six domain servers in-process and talks to them over real MCP
 * JSON-RPC via InMemoryTransport — no subprocesses, no added latency, but a
 * genuine protocol boundary between the agent and the domain code.
 */
class McpHub {
  private clients = new Map<string, Client>();
  private ready?: Promise<void>;

  /**
   * Readiness is memoized *inside* the hub rather than left to callers.
   * `tool-registry.ts` builds its singleton at module-eval time — strictly
   * before startServer() runs — and a constructor cannot await. Scripts like
   * `test-agents.ts` never call startServer() at all. Awaiting this from
   * every entry point is what keeps all of those working without each one
   * having to remember to initialise first.
   */
  private ensureReady(): Promise<void> {
    return (this.ready ??= this.connectAll());
  }

  /** Optional warm start; correctness does not depend on it being called. */
  async init(): Promise<void> {
    await this.ensureReady();
  }

  private async connectAll(): Promise<void> {
    const work = (async () => {
      for (const domain of DOMAINS) {
        const server = createDomainServer(domain.name, domain.tools, domain.present);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

        // Server first. Client.connect() sends `initialize` and awaits the
        // reply; if the server side isn't listening yet the message just sits
        // in the transport queue and connect() never resolves.
        await server.connect(serverTransport);

        const client = new Client({ name: `${domain.name}-client`, version: '1.0.0' });
        await client.connect(clientTransport);

        for (const tool of domain.tools) {
          this.clients.set(tool.name, client);
        }
      }
    })();

    // Fail loudly at boot rather than hanging startServer() before listen().
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`MCP hub failed to connect within ${CONNECT_TIMEOUT_MS}ms`)),
        CONNECT_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([work, timeout]);
      console.log(`🔌 [MCP HUB] Connected ${DOMAINS.length} servers, ${this.clients.size} tools`);
    } finally {
      clearTimeout(timer!);
    }
  }

  /** Tool names served over MCP (i.e. everything except the local account tools). */
  async getToolNames(): Promise<string[]> {
    await this.ensureReady();
    return [...this.clients.keys()];
  }

  /** Real `tools/list` per domain — used for boot-time verification. */
  async listTools(): Promise<Array<{ server: string; tools: any[] }>> {
    await this.ensureReady();
    const seen = new Set<Client>();
    const out: Array<{ server: string; tools: any[] }> = [];

    for (const client of this.clients.values()) {
      if (seen.has(client)) continue;
      seen.add(client);
      const listed = await client.listTools();
      out.push({ server: client.getServerVersion()?.name ?? 'unknown', tools: listed.tools });
    }
    return out;
  }

  has(name: string): boolean {
    return this.clients.has(name);
  }

  /**
   * Calls a tool over MCP and normalises the result back to the contract the
   * rest of the app already relies on: content[0].text is ALWAYS parseable
   * JSON.
   *
   * MCP emits plain-English (non-JSON) text on three separate paths — input
   * validation failure, tool-not-found, and any unexpected throw — and throws
   * McpError on timeout. Without this normalisation, `booking-pipeline.ts`,
   * which JSON.parses content[0].text directly, would break.
   */
  async callTool(name: string, args: any): Promise<any> {
    await this.ensureReady();

    const client = this.clients.get(name);
    if (!client) return errorEnvelope(`Tool not found: ${name}`);

    try {
      const result: any = await client.callTool({ name, arguments: args });
      const text = result?.content?.[0]?.text;

      if (typeof text !== 'string') return errorEnvelope(`Tool ${name} returned no content`);

      try {
        JSON.parse(text);
      } catch {
        // Non-JSON means MCP generated the error text, not our tool.
        return errorEnvelope(text);
      }

      return result;
    } catch (err) {
      return errorEnvelope(err instanceof Error ? err.message : String(err));
    }
  }
}

function errorEnvelope(error: string) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error }) }],
    isError: true,
  };
}

export const mcpHub = new McpHub();
