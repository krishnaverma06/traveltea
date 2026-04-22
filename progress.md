# TravelTea AI Travel Agent — Progress Log

Running log of the phased transformation into a full AI travel agent (see roadmap constraints in the assistant's project memory: additive scope, no Amadeus, web scraping for flights/hotels, OpenTripMap for restaurants, dummy-but-real-feeling payment flow). One entry per completed phase.

---

## Phase 0 — AI setup & clean architecture (2026-08-11)

**Done:**
- Created `backend/src/config/llm.ts`: single factory for the Gemini chat client — `createChatModel(overrides)` and `createStructuredChatModel(schema, overrides)` — resolving `GEMINI_API_KEY`/`GEMINI_MODEL` in one place instead of 5 separate inline instantiations.
- Updated the 5 call sites to use the shared factory instead of constructing `ChatGoogleGenerativeAI` directly:
  - `backend/src/agents/travel-agent.ts`
  - `backend/src/agents/intent-detector.ts`
  - `backend/src/services/geminiWebSearch.ts` (now uses `createStructuredChatModel`)
  - `backend/src/controllers/searchController.js`
  - `backend/src/controllers/exploreController.js`
- Fixed latent model-name drift: the 5 files previously had 3 different fallback defaults (`gemini-3.1-flash-lite`, `gemini-2.0-flash`, `gemini-1.5-flash`) used only when `GEMINI_MODEL` was unset. Now there's one fallback, defined once.
- Added `backend/src/agents/README.md` documenting the current LangGraph workflow (planner → tool_executor/timeline_editor → response_formatter), the tool-registry/MCP layer, intent detection, the new LLM client convention, and persistence/RAG layer — the architecture baseline for later phases.
- Left untouched by design: all manual regex/JSON parsing of LLM output (intent detector, timeline editor, search-ranking helpers) — that's Phase 2/3 work, not a Phase 0 concern.

**Verification:**
- `npm run build` (tsc): confirmed zero new type errors — diffed against a stashed pre-change baseline, error list is identical (pre-existing issues elsewhere in the codebase, none in the touched files).
- `npm run lint`: skipped — the repo has no `eslint.config.js` (ESLint v9 requires flat config), so lint is broken repo-wide independent of this change; not a Phase 0 fix.
- Grep confirms no remaining inline `new ChatGoogleGenerativeAI(` outside `config/llm.ts`.
- Booted the dev server (`tsx src/server.ts`): all modules loaded without error (tool registry registered 10 tools, auth loaded, env checks passed), confirming the refactored imports/construction work at runtime. Server startup failed only at the MongoDB Atlas connection step due to this sandbox's IP not being allowlisted — a pre-existing environment constraint, unrelated to this change.

---

## Phase 1 — LangChain tool layer (2026-08-11)

**Done:**
- Added 5 new tools: `search_events` (`backend/src/mcp-servers/events/tools.ts`, wraps `ticketmasterService.getEvents`) and 4 saved-trip/preferences tools (`backend/src/agents/tools/account.ts`, a new non-MCP location for internal-DB-backed tools — `list_saved_trips`, `get_upcoming_trip`, `get_travel_preferences`, `update_travel_preferences`, all calling `SavedTrip`/`User` models directly). Registered in `tool-registry.ts` (10 → 15 tools).
- `tool-registry.ts`: tightened `Tool.inputSchema` from `any` to `z.ZodTypeAny`; added warn-only `safeParse` validation in `executeTool` (logs on schema mismatch, doesn't block — `search_by_category`'s existing schema already doesn't match its real call-site args, so enforcing now would break it); extended `getToolsForIntent`.
- `intent-detector.ts`: added the 5 new intents to `IntentSchema`'s enum + system prompt (with explicit disambiguation between `update_travel_preferences` and `edit_timeline`), and 5 new `fallbackDetection` regex branches ordered ahead of the existing generic branches to avoid collisions (e.g. "add hiking to my interests" would otherwise hit the existing `edit_timeline` "add" keyword).
- `travel-agent.ts`: added `userId`/`entities`/`toolData` to `AgentStateAnnotation`; threaded `userId` (already a `chat()` param, previously only used for RAG) into `initialState`; `plannerNode` now passes through detected `entities`; added the 5 new intents to `intentsThatNeedTools` (the conditional-edge gate — easy to miss, and without it new cases never run); added 5 new `toolExecutorNode` cases (the 4 account ones start with a `state.userId` auth guard — user id only ever comes from state, never from LLM-extracted entities); added a `toolData` branch in `responseFormatterNode` plus 6 new deterministic markdown formatters (`formatToolData`, `formatSavedTripsList`, `formatUpcomingTrip`, `formatPreferences`, `formatPreferencesUpdated`, `formatEvents`) — no LLM call, matching the existing `formatDistance`/`formatItinerary` style.
- Updated `backend/src/agents/README.md` (tool-layer, agent-state sections) with the new tool locations, state fields, and the 3-step reachability checklist for adding a tool-backed intent.

**Deferred (flagged, not fixed — future phases):**
- Schema/call-site drift on `search_by_category` (comma-joined categories, `"accomodations"` not in its enum) — validation is warn-only until this is fixed.
- `IntentSchema.tools_to_call` is computed but still unused; dispatch is still the hardcoded switch. Wiring dynamic tool-calling is Phase 2.
- `backend/src/routes/itinerary.ts` calls `agent.chat(msg, undefined)` with no `userId` — account tools reached that way correctly ask the user to sign in, but passing `req.userId` there would be a one-line improvement if that route is authenticated.

**Bug found and fixed during verification:** the LLM-based intent path (`intentDetector.detectIntent`) currently always fails and falls to `fallbackDetection` — same pre-existing `GEMINI_MODEL` deprecation issue flagged in Phase 0, still unfixed. That path never extracted preference *values* (budget/travel style/interests) from the query text, only the LLM path did — so `update_travel_preferences` always failed with "I couldn't tell which preference you wanted to change" even for a clear command like "set my budget to luxury". Fixed by adding value extraction directly into `fallbackDetection`'s new branch (`intent-detector.ts`) so the feature works correctly on the fallback path too, not just once the model issue is eventually fixed.

**Verification:**
- `npx tsc` (via `npm run build`): zero new type errors — diffed against the Phase 0 baseline, identical error list (same files/messages, only line-number shifts in `travel-agent.ts` from the added code). `account.ts` and `events/tools.ts` compile with zero errors.
- Booted the dev server: confirmed "Registered 15 tools".
- Chat probes via curl (JWT auth, same approach as Phase 0): "show my saved trips" → correct empty-state message; "what's my next trip" → correct empty-state message; "what are my travel preferences" → correct defaults (`mid-range`/`cultural`/none); "set my budget to luxury" → correctly updated and persisted (confirmed via re-read, `travelStyle`/`interests` untouched by the partial `$set`); "what concerts are on in Lisbon next month" → correctly routed and executed, empty result because `TICKETMASTER_API_KEY` isn't configured (pre-existing env gap, handled gracefully — not a bug).
- Regression probes: "distance from Paris to London" and "move Hemis Monastery to day 2" (edit_timeline) behave identically to before Phase 1. "things to do in Paris" hits the same pre-existing `GEMINI_MODEL` 404 on the casual-chat conversational fallback already documented in the Phase 0 log — unrelated to this phase's changes.

---

## Cross-phase gap fixes (2026-08-11)

Full tracker now lives in `tasks.md` (roadmap status + known-gaps checklist). Fixed 4 real gaps found while building/smoke-testing Phases 0–1, all excluding `GEMINI_MODEL` (deferred — user replacing the key separately):

- **`backend/eslint.config.js`** (new) — backend had no ESLint v9 flat config, so `npm run lint` errored outright. Added a minimal config using only already-installed packages (`@typescript-eslint/parser`+`eslint-plugin` v8's `flat/recommended`, hand-defined Node globals — avoided adding `@eslint/js`/`globals` as new deps after `npm install` hit a peer-dependency conflict with the actually-installed `eslint` version). Lint now runs; surfaces 213 pre-existing findings (mostly `no-explicit-any`), left alone — that's existing code style debt, not something in scope to mass-fix here.
- **`backend/src/types/tripContext.ts`, `calculateDailyBudget`** — divided/multiplied using budget sub-fields with no guard against them being missing, producing `$NaN` in itinerary output. Fixed: all sub-fields default to 0, `days` guarded to a minimum of 1. Verified: a request omitting `budget.events` now shows `Activities/Day: $0` instead of `$NaN`.
- **`backend/src/mcp-servers/places/tools.ts`, `searchByCategoryTool`** — its Zod `category` enum was a stale hardcoded list (missing `"accomodations"`, missing codes the app actually generates) that the tool's own `execute` never used for branching anyway. Loosened to `z.string().min(1)`.
- **`backend/src/routes/itinerary.ts`, `/refine` route** — authenticated route never passed `req.userId` to `agent.chat(...)`, so Phase 1's account tools could never work from that path. Fixed: added as the 3rd positional arg.
- **Bug found live during verification, not in the original gap list**: fixing the category schema surfaced a real crash — `toolExecutorNode` (`travel-agent.ts`) read `.places`/`.destinations`/`.restaurants`/`.attractions` off a tool result without checking for tool failure first; on failure that key is `undefined` and the next line's `.length` access threw an unhandled `TypeError`, aborting the whole chat turn instead of degrading gracefully like every other error path in the file. Fixed all 4 occurrences of the same pattern in that switch.

**Verification:** `tsc --noEmit` diffed against the Phase 1 baseline — identical error count (50 lines), zero new errors. Live curl probes: itinerary generation with a missing budget field (confirmed `$0` not `$NaN`), "hotels in Rome" chat query (confirmed clean `0 results` log instead of a crash — request then correctly hit the pre-existing, unrelated Gemini quota-exhaustion fallback). The `/refine` route fix is verified by type-check plus matching an already-proven-working call pattern (`chatController.ts` already passes `req.userId` the same way) — a full live probe wasn't completed since Gemini's free-tier quota (20 requests/day) was exhausted by this session's testing.

---

## Deep audit: RAG/vector pipeline, backend, frontend (2026-08-11)

Full, requested (not incidental) audit via 3 parallel research passes, followed by fixing everything found except items explicitly deferred with a reason. Complete findings list, with fixed/deferred status, lives in `tasks.md` under "Deep audit" — this entry covers what actually got changed and how it was verified.

**RAG/vector subsystem (`backend/src/vector/`) — 9 real bugs fixed:**
- `search-knowledge.service.ts`: destination naming/country resolution were both wrong (used the first nearby POI's name instead of the searched city, and checked fields that never exist on OpenTripMap results, always yielding `'Unknown'`). Fixed by using the search query itself as the name and OpenTripMap's `getCityCountryCode` (an already-existing method) for a real ISO country code. Also fixed the dedup existence-check to match the actual upsert key, so it can't silently merge a new destination into an unrelated document.
- `VectorDocument.ts`: added `userId` to the unique index (two users/trips with the same title+city could collide and abort ingestion); removed a validator loophole that let empty (unsearchable) embeddings pass as valid.
- `trip-knowledge.service.ts`: wrapped each knowledge chunk's write in its own try/catch — previously one collision aborted ingestion for a trip's entire knowledge base with no user-visible error.
- `vector-retrieval.service.ts`: a malformed `userId` threw *outside* its try/catch, silently killing all 4 knowledge layers (including the 2 that don't even use `userId`) via the shared `Promise.all`. Fixed with `ObjectId.isValid` guarding. Also added an `archived`/`expiresAt` filter so the existing (previously inert) lifecycle-management fields actually do something if ever set.
- `embedding.ts`/`vector.constants.ts`: the recorded embedding-model metadata (`'models/text-embedding-004'`) didn't match the model actually used (`'gemini-embedding-2'`) — fixed by exporting the real model name from `embedding.ts` as the single source of truth.
- `seed-knowledge.ts`: the documented Atlas Search index setup was missing `sourceType`/`userId`/`archived`/`expiresAt` as filter fields, even though retrieval filters on all of them — following the script's own instructions on a fresh environment would have made every vector search silently return 0 results.

**Backend — chat/mutation reliability:**
- `chatController.ts`: reordered so a timeline-mutation failure's error message actually reaches the user (was computed, then discarded — the response had already been captured and sent). Fixed a real crash risk (an agent call that loses the 30s timeout race and later rejects was an unhandled promise rejection with no global handler — crashes the process by default). Fixed the error response/socket-emit to always carry a real `conversationId`. Renamed the `timeline_updated` socket emit to `itinerary_updated` to match what the frontend actually listens for (see below) — that mismatch meant live itinerary updates never reached the UI.
- `timelineMutationEngine.ts`: `undo`/`redo` accepted `mutationId`/`aiSummary` and silently discarded both — meant a retried undo/redo (network retry, double-click) could apply twice with no idempotency protection, and the AI-generated summary was always replaced with generic text. Added a `lastMutationId` field to the timeline schema to fix both.
- `weatherService.ts`: guarded against malformed OpenWeatherMap payloads, which previously threw and got treated as a retryable network error (2 pointless retries before finally degrading).
- Added the missing `PUT /api/saved-trips/:id/upcoming` route — the frontend has called this since at least the current build, 404ing silently every time.

**Frontend:**
- Wired `savedTripId` from a save/mark-upcoming response into `TripContext`, and `Chat.jsx` now includes `activeTripId`/`timelineVersion`/`mutationId` in its chat request when an active trip is loaded — previously the backend's entire timeline-mutation-via-chat feature was unreachable because the frontend never sent the fields it requires.
- Added a client-side timeout so the chat loading indicator can't spin forever if a socket event is dropped, and fixed the catch block to actually show the real error message it already computed instead of a hardcoded generic string.
- Fixed `useSocket.js` to read `VITE_SOCKET_URL` (previously defined but never referenced — silently reused `VITE_API_URL` instead).
- Replaced the "Interactive Map Coming Soon" placeholder on the itinerary page with the same `Map` component already used and working in `Chat.jsx`.
- Bonus find: frontend ESLint was also broken (pre-existing, unrelated to this session — `reactHooks.configs.flat.recommended` doesn't exist in the installed plugin version). Fixed to use `recommended-latest`.

**Deliberately not fixed (see `tasks.md` for full reasoning per item):** Amadeus-related hotel code (being replaced by web scraping in Phase 5), the transport tool's straight-line-distance-as-directions approximation (real routing is Phase 5 scope), Socket.io's `join:conversation` missing an ownership check (needs a coordinated auth handshake I can't fully test here), the orphaned mock-data `TripDetailsPage.jsx` (needs a product decision, not mine to make), and both the 213 backend / 338 frontend pre-existing lint findings (large separate cleanups, not functional gaps).

**Verification:** Backend `tsc --noEmit` — zero new errors (46 lines vs. the prior 50, actually *fewer* since fixing `mutationId`/`aiSummary` usage resolved 4 pre-existing unused-variable warnings as a side effect). Frontend `npm run build` — clean. Live-verified: the new `/upcoming` route (clean 404 on a bad id, no crash); the search-knowledge country fix, by directly querying MongoDB after a live "Lisbon" search — confirmed `country: "PT"` instead of the old `"Unknown"`, and `title: "Lisbon"` instead of a mislabeled POI name.

---

## New Gemini key verification (2026-08-11)

User replaced the deprecated `GEMINI_MODEL` key. This was the first time the LLM pipeline actually ran for real all session (everything before this ran on keyword/deterministic fallback), which surfaced 2 new real bugs — full detail in `tasks.md`'s "New Gemini key verification" section, summary here:

- **Blank itinerary on new trip plans, no error shown**: `frontend/src/pages/ResultsPage.jsx`'s generation guard silently returned when trip data looked incomplete (e.g. a `0` flexible budget total, treated as falsy), leaving all 3 of its render branches (loading/error/success) unmatched — the page showed nothing beneath the header. Fixed by surfacing a specific error message instead of failing silently, reusing the page's existing error UI.
- **Itinerary quality**: `geminiWebSearch.ts`'s structured attraction extraction had no `maxOutputTokens` override (4096 default) and `enhancedItineraryBuilder.ts` requested a flat 30 fully-detailed attractions regardless of trip length — Gemini's response was truncating mid-JSON, and the structured-output parser discarded the whole (real, valid-so-far) response rather than salvaging it, silently falling back to generic OpenTripMap-only content. Fixed: `maxOutputTokens: 8192`, and the requested count now scales with trip length (`min(30, max(12, days*6))`). Verified live: went from 0 parsed attractions (fallback) to 13 successfully parsed, with real content (Basilica of Bom Jesus, Dudhsagar Falls) replacing the generic placeholder text.

**Also verified in this pass:**
- SerpAPI key is valid with quota remaining (89/250 monthly searches) — checked directly against SerpAPI's own account endpoint.
- Chat's intent detection now produces genuine LLM reasoning (confirmed via logs, not the fallback's hardcoded string) for both general queries and Phase 1 account-tool queries.

**Verification:** Backend `tsc --noEmit` — zero new errors. Frontend `npm run build` — clean. Both fixes confirmed live via the actual running app (server logs + a repeated itinerary-generation request showing the before/after).

---

## Phase 2: Basic LLM/tool-calling agent (2026-08-12)

Replaced the prompt+regex-JSON intent classifier as the primary dispatch
mechanism with native Gemini function-calling, and replaced the ~13-case
hardcoded `switch` in `toolExecutorNode` with a generic dispatcher driven by
whatever `tool_calls` Gemini actually returns — the exact TODOs the
`agents/README.md` baseline had flagged for this phase.

**Done:**
- `tool-registry.ts`: added `Tool.userScoped?: boolean`; flipped
  `executeTool`'s schema check from warn-only to enforcing (returns an
  MCP-shaped `{isError:true}` on mismatch instead of proceeding, and now
  passes `check.data` through so Zod `.default()`s apply centrally). Safe
  now that args only ever come from Gemini's structured `tool_calls` or the
  degraded-path fallback mapper, not free-text regex guesses.
- `agents/tools/account.ts`: marked all 4 account tools `userScoped: true`.
- `intent-detector.ts`: made `fallbackDetection` public — it's the sole
  degraded-path mechanism now (called directly when native tool-calling
  itself throws, skipping a doomed retry through `detectIntent()` first).
- `prompts.ts`: added `TOOL_SELECTION_SYSTEM_PROMPT`, a short
  dispatcher-persona prompt. Deliberately doesn't re-list the tool catalog
  in prose — Gemini gets the real tool list + schemas structurally via
  `bindTools`, which is the whole point of retiring the old approach.
- `travel-agent.ts` (bulk of the change): the constructor now builds
  `toolCallingModel = this.model.bindTools(specs)` once, from every
  registered tool (schema minus `userId` for `userScoped` ones) plus two
  virtual actions that aren't registry tools — `plan_trip` (destination/
  duration extracted natively instead of via regex) and `edit_timeline` (a
  marker only, still routes straight to the untouched `timelineEditorNode`).
  `plannerNode` invokes it and reads `response.tool_calls` directly. The
  conditional edge after `planner` shrank from a maintained ~20-item intent
  list to: a call named `edit_timeline` → `timeline_editor`; any tool calls
  → `tool_executor`; none → `response_formatter` (casual chat). `state`
  gained `toolCalls`; the Phase-1 `categories`/`entities` fields were
  removed (nothing outside this file read them, and their data now arrives
  as real structured `tool_calls[].args`). `toolExecutorNode` is now a
  generic loop over `state.toolCalls`, dispatched through a new
  `TOOL_RESULT_MAP` (tool name → state slot / `toolData.kind`) instead of
  per-case logic — executes every call so nothing is silently dropped, but
  only the first result's mapping populates the state slot
  `responseFormatterNode` reads (matches the old "one thing per turn" UX).
  For `userScoped` tools, the bound schema omits `userId` so Gemini can't
  fill it in, the tool is never called without an authenticated
  `state.userId`, and `args.userId` is always overwritten from
  `state.userId` regardless of anything the LLM produced — defense in
  depth, not reliant on string-matching arg names. Added 3 new formatters
  (`formatDirections`/`formatRoute`/`formatTravelTips`) so `get_directions`/
  `estimate_route`/`search_travel_tips` — registered since Phase 1 but never
  reachable through the old switch — now actually work. Old regex helpers
  (`extractDestination`/`extractDuration`/`extractCategory`, plus the 4
  distance-parsing patterns, now in `parseOriginDestination`) were kept but
  demoted: they only run inside `legacyFallbackToToolCalls`, the new
  degraded-path arg builder used when the native tool-calling call itself
  throws (quota/network) — same graceful-degradation convention this
  codebase already uses everywhere else.
- Updated `agents/README.md`: new "Dispatch: native tool-calling" section
  replacing the old switch description; intent-detector section rewritten
  to describe it as degraded-path only; agent-state section updated for the
  `toolCalls` field and `intent`'s reduced (label-only) role; tool-layer
  section notes validation is now enforcing and all 15 tools are reachable.

**Known, deliberate behavior changes (not regressions):**
- `find_nearby`/`get_nearby_attractions` previously always used hardcoded
  Paris coordinates regardless of what the user asked (a pre-existing bug).
  It now requires real coordinates and fails cleanly if Gemini can't infer
  them, instead of silently answering about Paris. Confirmed with the user
  before shipping.
- `get_details`/`get_place_details`'s old case read `state.searchResults[0]`
  from the same graph run — but `initialState` resets `searchResults` to
  `undefined` at the top of every `chat()` call, so that case was already
  dead/always-erroring in production. Native dispatch doesn't make this any
  worse; the special-case code just disappears.

**Verification:**
- `npx tsc --noEmit` (same as `npm run build`): diffed the touched files
  against the pre-change error list — zero new errors introduced (the 2
  `travel-agent.ts` warnings that show up, an unused `openTripMapAPI`
  import and an unused Proxy `target` param, are both pre-existing,
  confirmed against `git show HEAD:...`). The wider codebase's existing
  pre-existing error set (unrelated files, same as previous phases) is
  unchanged.
- Live-ran the real agent (`tsx`) end-to-end and caught one real bug this
  way before shipping: `plan_trip` was missing from `TOOL_RESULT_MAP`
  entirely, so a correctly-built itinerary was silently discarded every
  time. Fixed, then re-verified — `plan a 2 day trip to Goa` now correctly
  extracts `{destination: "Goa", duration: 2}` natively (no regex) and
  returns a real 2-day itinerary end-to-end through `chat()`.
- Also live-verified via targeted direct calls (Gemini free-tier quota
  — 20 requests/day — was largely exhausted by this session's testing, so
  most later checks went through the degraded fallback path, which is
  itself part of what needed verifying): the signed-out account-tool guard
  (clean sign-in message, tool never called — confirmed no "Executing tool"
  log line); the userId-override defense (a smuggled `userId` in the tool
  call args gets overwritten by the real authenticated one before
  execution); `edit_timeline` routing; the 3 newly-reachable tools
  (`get_directions`, `estimate_route`, `search_travel_tips`) all execute
  and format correctly; `calculate_distance`'s `intent` label still reaches
  `formatDistance` correctly; a deliberate multi-tool-call turn executed
  both calls and correctly surfaced the first one's outcome.
- One live multi-tool-call test hit `{error: "Location not found"}` for
  "Rome" via `search_restaurants` — traced directly to
  `openTripMapAPI.searchPlaces` geocoding, an existing, untouched code path
  (confirmed by calling the tool directly outside the agent) — not a
  dispatch regression.
