import mongoose from 'mongoose';
import SavedTrip from '../models/SavedTrip.js';
import { generateEmbedding } from './embedding.js';

/**
 * Hybrid search over a user's saved trips: lexical (regex) and semantic
 * (Atlas $vectorSearch) run together, lexical first.
 *
 * Why hybrid rather than either alone:
 *
 *  - Pure lexical was what actually shipped, because the `trip_semantic_search`
 *    index did not exist and $vectorSearch throws against a missing index —
 *    which the caller caught into a regex fallback. So "beach trip" matched
 *    nothing, since no title contains that substring.
 *
 *  - Pure semantic misses the most common case of all: typing a trip's exact
 *    name. Embeddings of short titles are noisy, and a user who types "Goa"
 *    expects their Goa trip first, deterministically, not "ranked 0.87".
 *
 * Scores here sit in a narrow band (measured: 0.75-0.88 across this corpus),
 * so a single absolute cutoff can't separate signal from noise — "sushi in
 * tokyo" scores 0.758 against a Lisbon trip, barely below a real match. The
 * cutoff is therefore RELATIVE to the best hit for the query, with an absolute
 * floor underneath it: keep what is close to the top match, and if even the top
 * match is weak, keep nothing.
 */

/**
 * Below this, even the best hit is treated as noise. Measured, not guessed:
 * across this corpus every genuine query tops out at 0.82+ ("Goa" 0.875,
 * "Lisbon" 0.868, "Paris" 0.851, "mountain trekking" 0.838, "beach" 0.821)
 * while gibberish still reaches 0.78 ("zzzzzz" 0.781, "qwerty asdf" 0.774,
 * "sushi in tokyo" 0.758 against a corpus with no Japanese trips). 0.80 is the
 * gap between those two clusters.
 */
const ABSOLUTE_FLOOR = 0.80;
/**
 * Keep hits within this much of the best score for the query. This is what
 * makes a precise query stay precise: "Paris" scores 0.851 on the Paris trip
 * and 0.774 on the next one, so the margin returns exactly one result, while
 * "Goa" (0.875/0.867/0.866/0.865) returns all four Goa trips.
 */
const RELATIVE_MARGIN = 0.05;

const VECTOR_INDEX = 'trip_semantic_search';

const REGEX_METACHARS = new RegExp('[.*+?^${}()|[\\]\\\\]', 'g');
export const escapeRegex = (str: string) => str.replace(REGEX_METACHARS, '\\$&');

export interface TripSearchResult {
  trips: any[];
  /** How each half contributed — surfaced so callers can log/debug the mix. */
  lexicalCount: number;
  semanticCount: number;
  semanticAvailable: boolean;
}

/** Substring match across the fields a user would actually type. */
async function lexicalSearch(userId: string, query: string, limit: number): Promise<any[]> {
  const safe = escapeRegex(query);
  return SavedTrip.find({
    user: userId,
    $or: [
      { title: { $regex: safe, $options: 'i' } },
      { description: { $regex: safe, $options: 'i' } },
      { tags: { $in: [new RegExp(safe, 'i')] } },
      { 'cities.name': { $regex: safe, $options: 'i' } },
      { travelType: { $regex: safe, $options: 'i' } },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Returns [] rather than throwing when the index is missing or still building,
 * so search degrades to lexical instead of erroring — but the caller can tell
 * the difference via `semanticAvailable`.
 */
async function semanticSearch(
  userId: string,
  query: string,
  limit: number,
): Promise<{ hits: any[]; available: boolean }> {
  try {
    const queryEmbedding = await generateEmbedding(query);
    const raw = await SavedTrip.aggregate([
      {
        $vectorSearch: {
          index: VECTOR_INDEX,
          path: 'embedding',
          queryVector: queryEmbedding,
          numCandidates: Math.max(100, limit * 5),
          limit,
          filter: { user: new mongoose.Types.ObjectId(userId) },
        },
      },
      { $addFields: { score: { $meta: 'vectorSearchScore' } } },
      { $project: { embedding: 0 } },
    ]);

    if (raw.length === 0) return { hits: [], available: true };

    const top = raw[0].score as number;
    const cutoff = Math.max(ABSOLUTE_FLOOR, top - RELATIVE_MARGIN);
    return { hits: raw.filter((r: any) => r.score >= cutoff), available: true };
  } catch (error: any) {
    console.error(`[tripSearch] semantic half unavailable: ${error.message}`);
    return { hits: [], available: false };
  }
}

/**
 * Lexical hits rank above semantic ones — an exact substring the user typed is
 * a stronger signal than any similarity score — and duplicates across the two
 * halves are collapsed by id, keeping the lexical position.
 */
export async function searchSavedTrips(
  userId: string,
  query: string,
  limit = 20,
): Promise<TripSearchResult> {
  const trimmed = (query || '').trim();
  if (!trimmed) {
    return { trips: [], lexicalCount: 0, semanticCount: 0, semanticAvailable: true };
  }

  const [lexical, semantic] = await Promise.all([
    lexicalSearch(userId, trimmed, limit),
    semanticSearch(userId, trimmed, limit),
  ]);

  const seen = new Set<string>();
  const merged: any[] = [];
  for (const trip of [...lexical, ...semantic.hits]) {
    const id = String(trip._id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(trip);
  }

  return {
    trips: merged.slice(0, limit),
    lexicalCount: lexical.length,
    semanticCount: semantic.hits.length,
    semanticAvailable: semantic.available,
  };
}
