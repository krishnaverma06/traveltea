import 'dotenv/config';
import { toolRegistry } from '../agents/tool-registry.js';

/**
 * Step-2 validation: execution now crosses the MCP boundary, but every caller
 * contract must be byte-for-byte what it was before.
 *
 * The thing that matters most here is that content[0].text is ALWAYS
 * parseable JSON — booking-pipeline.ts JSON.parses it directly, so any MCP
 * error path leaking plain English through would break booking.
 *
 * Run with: npm run mcp:verify-exec
 */

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`        ${detail}`);
}

function assertEnvelope(label: string, result: any) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== 'string') {
    check(label, false, `content[0].text missing: ${JSON.stringify(result)?.slice(0, 200)}`);
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    check(label, true, `isError=${!!result.isError}, keys=[${Object.keys(parsed).join(', ')}]`);
    return parsed;
  } catch {
    check(label, false, `content[0].text is NOT JSON: ${text.slice(0, 160)}`);
    return null;
  }
}

async function main() {
  console.log('='.repeat(64));
  console.log('MCP execution contract');
  console.log('='.repeat(64));

  console.log('\n-- happy path (MCP-backed) --');
  assertEnvelope(
    'search_destinations returns parseable JSON',
    await toolRegistry.executeTool('search_destinations', { query: 'Paris', limit: 2 }),
  );

  console.log('\n-- bad args must still yield parseable JSON, not MCP plain text --');
  const bad = await toolRegistry.executeTool('search_flights', { origin: 'DEL' }); // missing required fields
  const badPayload = assertEnvelope('search_flights(bad args) returns parseable JSON', bad);
  check('bad args flagged as isError', bad?.isError === true);
  check('bad args carry an `error` field', typeof badPayload?.error === 'string', badPayload?.error);

  console.log('\n-- unknown tool still throws (unchanged contract) --');
  let threw = false;
  try {
    await toolRegistry.executeTool('no_such_tool', {});
  } catch {
    threw = true;
  }
  check('unknown tool throws', threw);

  console.log('\n-- local (non-MCP) account tool, fail-closed without a user --');
  const acct = await toolRegistry.executeTool('list_saved_trips', { userId: '', limit: 3 });
  assertEnvelope('list_saved_trips returns parseable JSON', acct);

  console.log('\n-- booking pipeline call sites (JSON.parse content[0].text directly) --');
  const hotels = await toolRegistry.executeTool('search_hotels', { destination: 'Lisbon', adults: 2 });
  const hotelPayload = assertEnvelope('search_hotels returns parseable JSON', hotels);
  check(
    'search_hotels payload has hotels[] or error',
    Array.isArray(hotelPayload?.hotels) || typeof hotelPayload?.error === 'string',
  );

  console.log('\n' + '='.repeat(64));
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  console.log('='.repeat(64));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Verification crashed:', err);
  process.exit(1);
});
