import 'dotenv/config';
import { connectDB } from '../config/database.js';
import { toolRegistry } from '../agents/tool-registry.js';

/**
 * Every formatter moved out of travel-agent.ts must still produce markdown,
 * now via its domain's presentation map instead of a private format* method.
 *
 * Checks the rendered block appears as content[1] and content[0] stays
 * parseable JSON. `web_search` is the deliberate exception — its response is
 * an LLM summary built in the agent, so it must NOT gain a rendered block.
 *
 * Run with: npm run mcp:verify-present
 */

interface Case {
  tool: string;
  args: any;
  expectRendered: boolean;
  contains?: string;
  expectError?: boolean;
}

const CASES: Case[] = [
  { tool: 'search_destinations', args: { query: 'Paris', limit: 3 }, expectRendered: true, contains: 'amazing places' },
  { tool: 'search_by_category', args: { location: 'Paris', category: 'museums', limit: 3 }, expectRendered: true },
  { tool: 'search_restaurants', args: { location: 'Lisbon', limit: 3 }, expectRendered: true },
  { tool: 'get_nearby_attractions', args: { latitude: 48.8584, longitude: 2.2945, limit: 3 }, expectRendered: true, contains: 'nearby' },
  { tool: 'calculate_distance', args: { origin: 'Paris', destination: 'Lyon' }, expectRendered: true, contains: 'Distance Information' },
  { tool: 'get_directions', args: { origin: 'Paris', destination: 'Lyon' }, expectRendered: true, contains: 'Directions' },
  { tool: 'estimate_route', args: { waypoints: ['Paris', 'Lyon', 'Marseille'] }, expectRendered: true, contains: 'Multi-Stop Route' },
  { tool: 'search_travel_tips', args: { destination: 'Japan' }, expectRendered: true, contains: 'Travel Tips' },
  { tool: 'search_events', args: { city: 'Berlin' }, expectRendered: true },
  // Local, non-MCP path — proves presentation is applied there too.
  { tool: 'list_saved_trips', args: { userId: '000000000000000000000000', limit: 3 }, expectRendered: true, contains: 'saved' },
  // Deliberate exception: summarised by the agent (needs userQuery + RAG +
  // an LLM call), so it must NOT gain a rendered block.
  { tool: 'web_search', args: { query: 'budget for Bali', numResults: 3 }, expectRendered: false },
  // By design, an error result is never rendered — the executor surfaces it
  // via state.error instead. Guards against a formatter dressing up a failure
  // as a normal answer.
  { tool: 'get_travel_preferences', args: { userId: '000000000000000000000000' }, expectRendered: false, expectError: true },
  { tool: 'get_place_details', args: { placeId: 'not-a-real-xid' }, expectRendered: false, expectError: true },
];

let failures = 0;

async function main() {
  // The account tools hit Mongo directly; without this they buffer and time
  // out, which would look like a presentation failure rather than a missing
  // connection.
  await connectDB();

  console.log('='.repeat(64));
  console.log('Presentation regression — every moved formatter still renders');
  console.log('='.repeat(64) + '\n');

  for (const c of CASES) {
    let result: any;
    try {
      result = await toolRegistry.executeTool(c.tool, c.args);
    } catch (err) {
      failures++;
      console.log(`  FAIL  ${c.tool} threw: ${err}`);
      continue;
    }

    const block0 = result?.content?.[0]?.text;
    const rendered = result?.content?.[1]?.text;

    let jsonOk = false;
    try {
      JSON.parse(block0);
      jsonOk = true;
    } catch { /* reported */ }

    const renderedOk = c.expectRendered ? typeof rendered === 'string' && rendered.length > 0 : !rendered;
    const containsOk = !c.contains || (rendered ?? '').includes(c.contains);
    const errorOk = c.expectError === undefined || !!result?.isError === c.expectError;
    const ok = jsonOk && renderedOk && containsOk && errorOk;
    if (!ok) failures++;

    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${c.tool.padEnd(24)} ` +
        `json=${jsonOk} rendered=${c.expectRendered ? !!rendered : `${!rendered} (expected none)`}` +
        (c.expectError ? ` isError=${!!result?.isError} (expected)` : '') +
        (c.contains ? ` contains("${c.contains}")=${containsOk}` : ''),
    );
    if (!ok && rendered) console.log(`        got: ${rendered.slice(0, 120).replace(/\n/g, ' ')}`);
    if (!ok && !rendered && c.expectRendered) console.log('        got: no content[1] block');
  }

  console.log('\n' + '='.repeat(64));
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  console.log('='.repeat(64));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Verification crashed:', err);
  process.exit(1);
});
