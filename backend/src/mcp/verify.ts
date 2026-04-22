import 'dotenv/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { mcpHub } from './hub.js';
import { createDomainServer, type DomainTool } from './createDomainServer.js';
import { placesTools } from '../mcp-servers/places/tools.js';

/**
 * Boot-time verification for the MCP layer. Two things it proves:
 *
 *   1. tools/list publishes correct JSON Schema — specifically for the three
 *      constructs the old hand-rolled converter got wrong (it typed every
 *      non-string as "number").
 *   2. The presentation seam holds: a server built WITHOUT a presentation map
 *      returns exactly one content block of parseable JSON, i.e. it is
 *      spec-standard on its own.
 *
 * Run with: npm run mcp:verify
 */

const CHECKS: Array<{ tool: string; field: string; expect: (s: any) => boolean; describe: string }> = [
  {
    tool: 'estimate_route',
    field: 'waypoints',
    expect: (s) => s?.type === 'array' && s?.items?.type === 'string',
    describe: 'array of string',
  },
  {
    tool: 'get_directions',
    field: 'mode',
    expect: (s) => Array.isArray(s?.enum) && s.enum.includes('driving'),
    describe: 'enum incl. "driving"',
  },
  {
    tool: 'search_flights',
    field: 'returnDate',
    expect: (s) => s?.type === 'string',
    describe: 'optional string',
  },
];

function findRefs(node: any, path = ''): string[] {
  if (node == null || typeof node !== 'object') return [];
  const hits: string[] = [];
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' || k === '$defs' || k === 'definitions') hits.push(`${path}.${k}`);
    hits.push(...findRefs(v, `${path}.${k}`));
  }
  return hits;
}

async function main() {
  let failures = 0;

  console.log('='.repeat(64));
  console.log('MCP layer verification');
  console.log('='.repeat(64));

  const servers = await mcpHub.listTools();
  const byName = new Map<string, any>();
  for (const s of servers) {
    console.log(`\n  ${s.server} — ${s.tools.length} tool(s)`);
    for (const t of s.tools) {
      byName.set(t.name, t);
      const props = Object.keys(t.inputSchema?.properties ?? {});
      console.log(`    · ${t.name}(${props.join(', ')})`);
    }
  }

  console.log('\n' + '-'.repeat(64));
  console.log('1. Schema types the old converter got wrong');
  console.log('-'.repeat(64));
  for (const c of CHECKS) {
    const schema = byName.get(c.tool)?.inputSchema?.properties?.[c.field];
    const ok = c.expect(schema);
    if (!ok) failures++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.tool}.${c.field} -> ${c.describe}`);
    if (!ok) console.log(`        got: ${JSON.stringify(schema)}`);
  }

  console.log('\n' + '-'.repeat(64));
  console.log('2. No $ref / $defs (the one construct Gemini cannot resolve)');
  console.log('-'.repeat(64));
  for (const [name, tool] of byName) {
    const refs = findRefs(tool.inputSchema);
    if (refs.length) {
      failures++;
      console.log(`  FAIL  ${name}: ${refs.join(', ')}`);
    }
  }
  if (!failures) console.log('  PASS  none found across all tools');

  console.log('\n' + '-'.repeat(64));
  console.log('3. Presentation seam: server built with NO presentation map');
  console.log('-'.repeat(64));
  const bare = createDomainServer('bare-places', placesTools as DomainTool[]);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await bare.connect(st);
  const bareClient = new Client({ name: 'bare-client', version: '1.0.0' });
  await bareClient.connect(ct);

  const res: any = await bareClient.callTool({
    name: 'search_destinations',
    arguments: { query: 'Paris', limit: 2 },
  });
  const blocks = res?.content?.length ?? 0;
  let parseable = false;
  try {
    JSON.parse(res.content[0].text);
    parseable = true;
  } catch { /* reported below */ }

  const seamOk = blocks === 1 && parseable;
  if (!seamOk) failures++;
  console.log(`  ${seamOk ? 'PASS' : 'FAIL'}  ${blocks} content block(s), JSON parseable: ${parseable}`);
  console.log('        (a bare server must carry no TravelTea markdown)');

  console.log('\n' + '='.repeat(64));
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  console.log('='.repeat(64));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Verification crashed:', err);
  process.exit(1);
});
