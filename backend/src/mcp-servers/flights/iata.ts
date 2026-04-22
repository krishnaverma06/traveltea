import { createRequire } from 'module';

/**
 * City / airport name → IATA code.
 *
 * SerpAPI's `google_flights` engine takes `departure_id`/`arrival_id` as an
 * IATA code or Google kgmid. Free text is passed straight through and simply
 * returns nothing, so every "flights from Delhi to Mumbai" query silently came
 * back empty — including from the chat agent, whose own tool description
 * invites a city name ("Departure city or 3-letter IATA airport code").
 *
 * Resolution deliberately lives here rather than in the REST controller, so
 * the agent path benefits too.
 *
 * Not a full gazetteer — a curated set covering the destinations this app
 * actually sees. An unresolved input is passed through untouched, so a user who
 * already typed a valid code (or a kgmid) is never second-guessed.
 */

const require = createRequire(import.meta.url);
const AIRPORTS: Airport[] = require('../../data/airports.json');

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// city -> code. Built once. Where a city has several airports the first entry
// in airports.json wins, which is why the primary international airport is
// listed first for those cities (e.g. Delhi DEL, London LHR, New York JFK).
const byCity = new Map<string, string>();
const byName = new Map<string, string>();
const codes = new Set<string>();

for (const a of AIRPORTS) {
  codes.add(a.iata.toUpperCase());
  if (!byCity.has(norm(a.city))) byCity.set(norm(a.city), a.iata);
  if (!byName.has(norm(a.name))) byName.set(norm(a.name), a.iata);
}

/** All airports, for the autocomplete endpoint. */
export function allAirports(): Airport[] {
  return AIRPORTS;
}

/**
 * Resolve free text to an IATA code, or return the input unchanged when it
 * can't be resolved — never guess wildly, and never block a valid code the
 * table happens not to contain.
 */
export function resolveToIata(input: string): string {
  const raw = (input || '').trim();
  if (!raw) return raw;

  // Already a code we know, or at least code-shaped.
  const upper = raw.toUpperCase();
  if (codes.has(upper)) return upper;
  if (/^[A-Z]{3}$/.test(upper)) return upper;

  const key = norm(raw);
  const city = byCity.get(key);
  if (city) return city;

  const name = byName.get(key);
  if (name) return name;

  // "Delhi (DEL)" / "Delhi — Indira Gandhi Intl (DEL)" from the UI.
  const embedded = raw.match(/\(([A-Za-z]{3})\)\s*$/);
  if (embedded) return embedded[1].toUpperCase();

  // Last resort: a unique city whose name starts with the input, so "Bengal"
  // finds Bengaluru but an ambiguous prefix resolves to nothing.
  const prefixed = [...byCity.entries()].filter(([c]) => c.startsWith(key));
  if (prefixed.length === 1) return prefixed[0][1];

  return raw;
}

/** Substring search over code, city, name and country for the type-ahead. */
export function searchAirports(query: string, limit = 8): Airport[] {
  const q = norm(query);
  if (!q) return AIRPORTS.slice(0, limit);

  const scored = AIRPORTS.map((a) => {
    const code = a.iata.toLowerCase();
    const city = norm(a.city);
    const name = norm(a.name);
    const country = norm(a.country);

    let score = -1;
    if (code === q) score = 0;
    else if (city === q) score = 1;
    else if (city.startsWith(q)) score = 2;
    else if (name.startsWith(q)) score = 3;
    else if (city.includes(q)) score = 4;
    else if (name.includes(q)) score = 5;
    else if (country.startsWith(q)) score = 6;

    return { a, score };
  })
    .filter((x) => x.score >= 0)
    .sort((x, y) => x.score - y.score);

  return scored.slice(0, limit).map((x) => x.a);
}
