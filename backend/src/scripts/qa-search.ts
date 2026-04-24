import 'dotenv/config';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { searchSavedTrips } from '../services/tripSearch.js';

/**
 * Search and retrieval: the saved-trips search bar, the global (plan page)
 * search bar, and the RAG layers the agent reads from.
 *
 * The bug this exists to prevent: the `trip_semantic_search` Atlas index did
 * not exist, `$vectorSearch` throws against a missing index, and the caller
 * caught that into a regex fallback — so semantic search had never actually
 * run while looking like it worked. Index health is therefore asserted
 * directly, not inferred from "some results came back".
 *
 * Run: npm run qa:search   (needs the server on :5000)
 */

const BASE = 'http://localhost:5000';
const USER_ID = process.env.QA_USER_ID || '6a5fdc43ac8fc4f60b8b1793';
const TOKEN = jwt.sign({ sub: USER_ID }, process.env.JWT_SECRET as string, {
  expiresIn: '1h' as jwt.SignOptions['expiresIn'],
});
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

let pass = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
}

const get = async (path: string) => {
  const r = await fetch(BASE + path, { headers: H });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const db = mongoose.connection.db!;
  console.log('\n=== Search & retrieval ===\n');

  // ── 1. The index that was missing ──────────────────────────────────────
  console.log('1. Atlas indexes exist and are queryable');
  {
    const tripIdx = ((await db.collection('savedtrips').listSearchIndexes().toArray()) as any[]).find(
      (i) => i.name === 'trip_semantic_search',
    );
    check('savedtrips has trip_semantic_search', !!tripIdx, `found=${!!tripIdx}`);
    check('  and it is READY', tripIdx?.status === 'READY', `status=${tripIdx?.status}`);

    // Atlas rejects the whole query when a pre-filtered path is not indexed.
    const filterPaths = (tripIdx?.latestDefinition?.fields || [])
      .filter((f: any) => f.type === 'filter')
      .map((f: any) => f.path);
    check('  and indexes `user` as a filter path', filterPaths.includes('user'), filterPaths.join(','));

    const ragIdx = ((await db.collection('vector_documents').listSearchIndexes().toArray()) as any[]).find(
      (i) => i.name === 'vector_index',
    );
    check('vector_documents has vector_index READY', ragIdx?.status === 'READY', `status=${ragIdx?.status}`);
  }

  // ── 2. Every saved trip is actually searchable ─────────────────────────
  console.log('\n2. Trips are embedded (agent-created ones too)');
  {
    const col = db.collection('savedtrips');
    const mine = { user: new mongoose.Types.ObjectId(USER_ID) };
    const unembeddedFilter = {
      $or: [{ embedding: { $exists: false } }, { embedding: null }, { embedding: { $size: 0 } }],
    };

    const total = await col.countDocuments(mine);
    const unembedded = await col.countDocuments({ ...mine, ...unembeddedFilter });
    check('no saved trip is missing its embedding', unembedded === 0, `${unembedded} of ${total} unembedded`);

    // The agent pipeline used to persist trips without embedding or ingesting
    // them, so they were saved but invisible to both search bars and to RAG.
    const agentMade = await col.countDocuments({ ...mine, tags: 'agent-planned' });
    const agentUnembedded = await col.countDocuments({ ...mine, tags: 'agent-planned', ...unembeddedFilter });
    check(
      'agent-planned trips are embedded like REST-saved ones',
      agentUnembedded === 0,
      `${agentUnembedded} of ${agentMade} unembedded`,
    );
  }

  // ── 3. Hybrid ranking ──────────────────────────────────────────────────
  console.log('\n3. Hybrid search: lexical precision + semantic recall');
  {
    const goa = await searchSavedTrips(USER_ID, 'Goa');
    check('an exact place name matches lexically', goa.lexicalCount > 0, `lexical=${goa.lexicalCount}`);
    check('  and the top hit is that place', /goa/i.test(goa.trips[0]?.title || ''), goa.trips[0]?.title);

    // The case pure-lexical search could never serve: no title contains "beach".
    const beach = await searchSavedTrips(USER_ID, 'beach');
    check(
      'a descriptive query matches semantically with zero lexical hits',
      beach.lexicalCount === 0 && beach.semanticCount > 0,
      `lexical=${beach.lexicalCount} semantic=${beach.semanticCount}`,
    );
    check(
      'the semantic half is genuinely available (not silently degraded)',
      beach.semanticAvailable,
      String(beach.semanticAvailable),
    );
  }

  // ── 4. Noise is rejected ───────────────────────────────────────────────
  console.log('\n4. Gibberish returns nothing');
  {
    // Scores sit in a narrow 0.75-0.88 band, so this guards the absolute
    // floor: gibberish still scores ~0.78 against a healthy index.
    for (const q of ['zzzzzz', 'qwerty asdf', 'sushi in tokyo']) {
      const r = await searchSavedTrips(USER_ID, q);
      check(`  "${q}" -> no matches`, r.trips.length === 0, `${r.trips.length} results`);
    }
  }

  // ── 5. Both HTTP surfaces ──────────────────────────────────────────────
  console.log('\n5. Endpoints');
  {
    const r = await get('/api/saved-trips/search?q=Goa');
    check(
      'GET /api/saved-trips/search returns results',
      r.status === 200 && r.body.savedTrips?.length > 0,
      `status=${r.status} n=${r.body.savedTrips?.length}`,
    );
    check('  and reports that semantic search ran', r.body.semantic === true, String(r.body.semantic));

    const empty = await get('/api/saved-trips/search?q=');
    check(
      '  an empty query returns an empty list, not an error',
      empty.status === 200 && Array.isArray(empty.body.savedTrips) && empty.body.savedTrips.length === 0,
      `status=${empty.status}`,
    );

    // The plan-page bar was regex-only; "beach" proves it retrieves semantically now.
    const sugg = await get('/api/search/suggestions?q=beach');
    check(
      'GET /api/search/suggestions retrieves trips semantically',
      sugg.status === 200 && (sugg.body.suggestions || []).some((s: any) => s.type === 'trip'),
      `status=${sugg.status} types=${(sugg.body.suggestions || []).map((s: any) => s.type).join(',')}`,
    );
  }

  // ── 6. RAG layers the agent reads ──────────────────────────────────────
  console.log('\n6. Agent RAG layers');
  {
    const { generateEmbedding } = await import('../services/embedding.js');
    const { VectorRetrievalService } = await import('../vector/services/vector-retrieval.service.js');
    const emb = await generateEmbedding('what do you know about me and my past trips');
    const r = await VectorRetrievalService.retrieveRelevantKnowledge(emb, USER_ID);
    check('user profile layer returns their own details', r.userProfile.length > 0, `n=${r.userProfile.length}`);
    check('user trips layer returns past trips', r.userTrips.length > 0, `n=${r.userTrips.length}`);
    check('global knowledge layer is populated', r.globalKnowledge.length > 0, `n=${r.globalKnowledge.length}`);
  }

  await mongoose.disconnect();
  console.log(`\n=== ${pass} passed, ${failures.length} failed ===`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  FAIL  ${f}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
