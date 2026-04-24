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

---

## Phase 3: LangGraph booking-pipeline workflow (2026-08-12)

Added the booking-pipeline nodes the roadmap called for (search →
present-options → await-confirmation → execute-booking) as a structural
skeleton — deliberately scoped short of full cross-turn functionality,
confirmed with the user up front, since two things it will eventually
depend on don't exist yet: Phase 5's real flight/hotel data (no Amadeus,
Phase 6's real `Booking`/`Transaction` persistence) and Phase 4's
cross-turn memory (LangGraph `interrupt`/`Command`/checkpointer, confirmed
available in the installed `@langchain/langgraph@1.4.7` but intentionally
not used yet). A repo-wide search before starting confirmed no
booking/Transaction/payment domain existed anywhere in the codebase — this
was genuinely new ground, not an extension of something partial.

**Done:**
- New file `backend/src/agents/booking-pipeline.ts` — plain exported
  functions/types (not `TravelAgent` methods), so the 4 new node functions
  are directly unit-testable and Phase 4-7 have a dedicated home to extend
  without growing the already-1600+-line `travel-agent.ts` further.
  - Two virtual tools (bound alongside `plan_trip`/`edit_timeline`, same
    mechanism, no new `toolRegistry` entries): `book_hotel` and
    `book_flight`, each with an optional `confirmed` field the LLM is
    instructed to only set true when the user has already explicitly said
    to go ahead and book, in that same message.
  - `bookingSearchNode` — hotels reuse the existing, real
    `search_by_category` tool (`category: "accomodations"`, real OpenTripMap
    places, not real pricing/availability); flights honestly return an
    empty result since there's no data source at all right now, instead of
    fabricating options.
  - `bookingPresentOptionsNode` / `bookingConfirmNode` (the
    "await-confirmation" node) / `bookingExecuteNode` — the confirm node is
    the phase's explicit boundary: it can only resolve `confirmed` from the
    *same* triggering message (auto-selects the first option), since there's
    no persisted "pending booking" state yet for a later "yes" to resume —
    that's Phase 4's job, designed to layer onto this same node without
    graph restructuring. Execute produces a clearly labeled mock result
    (`MOCK-HOTEL-...` id, a note stating no payment was taken and nothing
    was persisted) — no DB write, no `Booking` model (Phase 6's job).
  - 3 new deterministic formatters (`formatBookingOptions`/
    `formatBookingConfirmPrompt`/`formatBookingResult`), wired into
    `travel-agent.ts`'s existing `formatToolData` switch as one-line
    delegates — same `toolData.kind` convention every other capability uses.
- `travel-agent.ts`: exported `AgentState` (was file-local) so
  `booking-pipeline.ts` can import it as a type-only import (no runtime
  circular dependency); added 4 state fields (`bookingRequest`,
  `bookingOptions`, `selectedBookingOption`, `bookingConfirmed`); added the
  4 new nodes and edges to `buildGraph()`, with one more branch in the
  planner's conditional edge (`book_hotel`/`book_flight` → `booking_search`,
  checked alongside the existing `edit_timeline` branch, both bypassing
  `tool_executor`); a new conditional edge after `booking_confirm`
  (`bookingConfirmed` → `booking_execute`, else → `response_formatter`).
- `prompts.ts`: added 3 routing bullets to `TOOL_SELECTION_SYSTEM_PROMPT`
  for `book_hotel`/`book_flight`/the `confirmed` field's semantics.

**Deliberately not built (see plan/README for the reasoning):** cross-turn
memory of a pending booking, real flight data, real `Booking` persistence —
all named as later phases' jobs, not gaps. The pre-existing quota-fallback
path (`legacyFallbackToToolCalls`) also intentionally still routes
hotel/flight requests through the old pre-Phase-3 plain-search behavior on
a Gemini outage, not the new pipeline — building fallback support for a
brand new pipeline was out of scope for a structural-skeleton phase.

**Verification:**
- `npx tsc --noEmit` — zero new errors versus the pre-Phase-3 baseline (the
  2 pre-existing `travel-agent.ts` unused-import warnings are unchanged,
  confirmed against `git show`).
- Node-level: imported and directly invoked all 4 functions with hand-built
  state — real hotel search returned 5 real OpenTripMap options with the
  right shape; flight search returned an empty list; present-options set
  the right `toolData.kind`; confirm correctly branched both ways
  (not-confirmed → prompt; confirmed+resolvable → auto-selects first
  option; confirmed-but-flight → still resolves to the prompt, not a false
  success); execute produced a correctly shaped mock result, and a
  no-option-selected call degraded to a clean error instead of throwing.
- Full-graph: `chat()`'s real compiled `StateGraph` was exercised end to
  end (stubbing only the planner's LLM call, since Gemini's free-tier
  quota — 20 requests/day — was already exhausted by this session's
  earlier testing) for all 5 routing branches: hotel search-only ends
  correctly asking to confirm; a same-turn `confirmed:true` message
  correctly reaches `booking_execute` and returns a real mock booking ID;
  flight requests get the honest "not available yet" message end to end;
  `edit_timeline` still correctly bypasses the new booking branch entirely
  (unchanged pre-existing behavior); an empty tool-call list still reaches
  `response_formatter` directly for casual chat. This is the real graph's
  actual conditional edges firing, not just the isolated node functions.

---

## Phase 4: State, memory & conversation context (2026-08-12)

Gave Phase 3's `bookingConfirmNode` real cross-turn memory — the gap it was
deliberately left with. Before this phase, a booking confirmation could
only resolve from the *same* message that started the search ("book the
first hotel in Lisbon right now, I confirm"); a normal two-step
conversation ("find me a hotel in Lisbon" this turn, "yes" the next) had
nothing to survive between chat turns and couldn't complete a booking.
This is the first real use of LangGraph's `interrupt`/`Command`/checkpointer
mechanism anywhere in this codebase — the exact API was verified by reading
the actual installed `@langchain/langgraph@1.4.7` source directly (not
assumed from general knowledge), which caught a real bug before it shipped:
once a checkpointer is configured, `graph.invoke()` throws immediately if
`configurable` is ever omitted.

**Two decisions confirmed with the user up front:**
1. Checkpointer: `MemorySaver` (in-process, zero setup). Accepted
   limitation: a server restart silently loses all pending confirmations —
   the next message is then treated as fresh rather than a resume. A
   durable backend is a future upgrade, not this phase.
2. An unrelated message while a booking is pending is treated as an
   implicit decline (not left pending indefinitely) — no smarter
   disambiguation, that's Phase 7's slot-filling/UX scope.

**Done:**
- `booking-pipeline.ts`: `bookingConfirmNode` now calls `interrupt({kind, request, options})`
  for the normal (not-already-confirmed, resolvable) case, genuinely
  pausing the graph instead of just returning a terminal prompt. Added
  `interpretBookingDecision` (a small keyword regex — "yes"/"confirm"/
  "book it"/etc. → true, anything else → false) to parse the resumed
  value, and a new `booking_declined` `toolData` kind +
  `formatBookingDeclined` formatter for the decline path.
- `travel-agent.ts`: added a `private checkpointer: MemorySaver`, compiled
  the graph with it. Rewrote `chat()`: always builds a real
  `{configurable:{thread_id}}` (using `conversationId`, or a throwaway UUID
  for callers without one — fixes the bug the source read caught); checks
  `graph.getState(config)` for a pending interrupt *before* running RAG,
  and skips RAG entirely on a resume turn (both resume outcomes are
  deterministic formatters that never read `ragContext` — this was pure
  waste before the fix, not a resume-semantics issue); resumes via
  `graph.invoke(new Command({resume: userQuery}), config)` instead of a
  fresh `initialState` when paused; detects a fresh pause via
  `isInterrupted(result)` and formats the response directly from the
  interrupt's payload (`response_formatter` is never reached on a paused
  run, so `result.response` doesn't exist there). `chat()`'s return value
  gained `pendingBooking` (`undefined`/`null`/object — not-a-booking-turn/
  clear/set).
- `Conversation.ts`: added `pendingBooking` (Mixed, sibling to the existing
  `itinerary` field) — a durability/observability mirror of the
  checkpointer's state, not the resume mechanism itself (that's entirely
  the checkpointer's job); lets a pending booking be inspected/persisted in
  Mongo even though `MemorySaver` itself is in-process only.
- `chatController.ts`: syncs `agentResult.pendingBooking` onto the
  conversation doc right before the existing assistant-message save — no
  new DB write.

**Known, accepted edge cases (documented in the plan/README, not built
around):** server restart loses pending confirmations; unrelated replies
are implicit declines; a narrow, self-healing timeout-race window where the
30s chat timeout could abandon the *first* message in a flow whose promise
later completes anyway and writes a checkpoint Mongo never learns about —
next ordinary message gets consumed as a decline instead of processing
fresh, resolves itself after that one turn. All three are the same tier as
each other, not gaps.

**Verification:**
- `npx tsc --noEmit` — identical 38-line error count to the Phase 3
  baseline; the only 2 new lines that appeared mid-work were fixed (an
  `Interrupt.value` possibly-undefined case needing a typed fallback), not
  left in.
- Node-level, via a fresh `TravelAgent` instance (own `MemorySaver`, stubbed
  planner + hotel search so no live quota is needed for the part that
  matters): full confirm round trip across two separate `chat()` calls on
  the same `conversationId` — first call correctly paused
  (`pendingBooking.awaitingConfirmation === true`), second call ("yes,
  book it") made **zero** LLM/tool calls yet still completed the booking
  with a real `MOCK-HOTEL-...` id and cleared `pendingBooking` — proof the
  state genuinely round-tripped through `MemorySaver` between calls, not
  same-turn confirmation. Repeated with an unrelated second message
  ("what is the weather in Paris") — correctly resolved as a decline with
  `formatBookingDeclined`'s exact text, `pendingBooking` cleared.
- Direct MongoDB round-trip test of the new `Conversation.pendingBooking`
  field (save → reload → matches → clear to `null` → reload → confirmed
  cleared) — the one part of the flow the node-level test doesn't exercise
  (it calls `travelAgent.chat()` directly, bypassing `chatController.ts`'s
  persistence write).

---

## Phase 5: Flight, hotel, food, places & local-transport search (2026-08-12)

Replaced two of the booking pipeline's remaining stand-ins with real data:
flights (previously always empty — no data source existed at all) and
hotels (previously OpenTripMap place matches with a "no real pricing"
disclaimer). Also replaced local transport's 100%-synthetic Haversine
routing with real Geoapify routing. Restaurants were left untouched —
`search_restaurants` already used real OpenTripMap data before this phase,
which literally already satisfies the roadmap's "OpenTripMap for
restaurants" line as written.

**Two decisions confirmed with the user up front:**
1. Flights/hotels: SerpAPI's dedicated `google_flights`/`google_hotels`
   engines (legitimate scraping-as-a-service — reuses the app's existing
   SerpAPI integration, previously only used with the generic organic
   Google-search engine), not a raw HTML scraper against airline/hotel
   sites (fragile, likely ToS-violating).
2. Local transport: wire in `GEOAPIFY_API_KEY`, which was already sitting
   configured in `.env` but completely unused anywhere in the code —
   zero new setup needed, directly resolved a gap flagged in an earlier
   audit as "Phase 5 scope."

**Done:**
- New `mcp-servers/flights/{api.ts,tools.ts}` — `FlightsAPI.searchFlights`
  wraps SerpAPI's `google_flights` engine, cached 1h (matches
  `amadeusService.getFlights`'s exact TTL precedent), degrades to `[]` on
  any failure (missing key, unresolvable airport, network error, SerpAPI
  error) — never a crash, never fabricated data. `search_flights` tool:
  `departDate` is a **required** schema field (SerpAPI requires
  `outbound_date`) — forces Gemini to extract a real date or ask the user
  directly instead of the tool silently failing.
- New `mcp-servers/hotels/{api.ts,tools.ts}` — same pattern for
  `google_hotels`, 24h cache TTL. `checkIn`/`checkOut` default server-side
  (tomorrow, 2 nights) when omitted, since a dateless "show me hotels in
  Lisbon" is a much more natural request than a dateless flight search.
- `mcp-servers/transport/api.ts` rewritten: `calculateDistance`/
  `getDirections`/`estimateMultiStopRoute` now try real Geoapify routing
  first, falling back to the **original** Haversine logic (kept as private
  methods, not deleted) on any failure — no hard dependency on a third
  external API. `estimateMultiStopRoute` uses Geoapify's native
  multi-waypoint support (one request) instead of the old N-pairwise-call
  loop when every waypoint geocodes; falls back to the pairwise loop
  (itself Geoapify-then-Haversine per leg) otherwise, preserving the
  original "skip just the bad leg" behavior exactly. `DistanceResult`/
  `DirectionsResult` shapes and `transport/tools.ts` are unchanged — zero
  ripple to callers.
- `tool-registry.ts`: registered the 2 new tool domains (17 tools total,
  up from 15).
- `booking-pipeline.ts`: `bookingSearchNode` now calls the real
  `search_flights`/`search_hotels` tools instead of returning empty
  (flights) or calling the OpenTripMap `search_by_category` stand-in
  (hotels). `BookingOption` gained an optional `price` field, surfaced in
  `formatBookingOptions`/`formatBookingConfirmPrompt`/`formatBookingResult`.
  `bookFlightToolSchema.departDate` became required. Fixed two real bugs
  found while wiring this up:
  - `bookingConfirmNode`'s `resolvable` check was hardcoded
    `req?.type === "hotel" && options.length > 0` — flights could *never*
    be confirmed regardless of how many real options existed. Now
    type-agnostic (`options.length > 0`).
  - `formatBookingOptions` hardcoded `⭐ ${opt.rating}/7` — OpenTripMap's
    1-7 scale. Real hotels from SerpAPI use a 0-5 `overall_rating` scale;
    left as-is, results would have shown false ratings like "4.3/7".
    Fixed by dropping the hardcoded denominator.
  Also dropped the `type === "flight"` special-case that unconditionally
  rendered "flights aren't available yet" regardless of actual results —
  now driven by whether options actually exist, for either type.

**Deliberately not built:** booking-URL resolution for flights (SerpAPI's
`booking_token` needs a second API call — out of scope for search-only,
Phase 6 is booking execution and even that stays mocked); a city→IATA
lookup table (unresolvable airport/city inputs degrade gracefully to empty
results instead); restaurant data enrichment (OpenTripMap's data is thin
by nature — a separate, unconfirmed scope decision, not this phase's job).

**Verification:**
- `npx tsc --noEmit` — zero new errors versus the Phase 4 baseline; every
  remaining error is pre-existing and in files this phase never touched.
- Unit-level, stubbed (no live quota): `FlightsAPI`/`HotelsAPI` normalize
  canned SerpAPI-shaped JSON correctly; `bookingSearchNode` end-to-end for
  hotel/flight success, flight-missing-`departDate` (clean error, not a
  crash), and empty-results for both types; `bookingConfirmNode` proven
  type-agnostic — a flight with real options now correctly reaches
  `bookingConfirmed: true` same-turn, which was structurally impossible
  before this phase's fix; `TransportAPI` against a stubbed Geoapify
  response, plus a forced-failure test confirming the Haversine fallback
  genuinely engages and returns the correct shape.
- Full-graph cross-turn test (real `TravelAgent`, stubbed planner only):
  hotel search → real `interrupt()` pause with real SerpAPI-shaped data →
  "yes, book it" on a second `chat()` call → real `MOCK-HOTEL-...` result
  with the real price shown — confirms Phase 4's interrupt/resume
  machinery and Phase 5's real data compose correctly together. Also
  confirmed flight search now returns real, presentable options through
  the full graph (previously always empty by design).
- Live smoke test against real credentials: `search_hotels` for Lisbon
  returned 20 real hotels (e.g. Hyatt Regency Lisbon, $247/night, real
  amenities and booking URL); `search_flights` JFK→LAX returned 35 real
  flights (e.g. JetBlue, $189, nonstop); real Geoapify driving/multi-stop
  routing for Paris-Lyon-Marseille returned realistic road-distance figures
  (465km/239min, not the ~380km straight-line Haversine number). Bonus
  finding from this live pass: Geoapify's `walk` mode rejects any pair over
  100km with a real 400 error (Paris-Lyon is ~392km) — this correctly
  triggered the Haversine fallback path in production conditions, not just
  in a simulated test, confirming the fallback design holds up against a
  real, previously-unknown failure mode.

---

## Phase 6: Simulated booking & transaction execution (2026-08-12)

Replaced the chat pipeline's throwaway mock booking result
(`` `MOCK-${type}-${Date.now()}` ``, zero persistence) with a real backend:
`Booking`/`Transaction` models, human-readable ID generation, a service
layer implementing a genuine create → pay → confirm flow with realistic
(entirely fake) dummy-card validation, and REST routes exposing that flow
directly — ahead of Phase 8, which is where the actual frontend payment
form will eventually drive it. Confirmed before starting that zero
payment/checkout code existed anywhere in the repo — genuinely new ground.

**Decision confirmed with the user:** the AI-chat booking flow
(`bookingExecuteNode`) auto-completes payment under the hood — creates a
real `Booking`, then immediately pays it with an internally-synthesized
dummy card (never real user input, since chat can't collect that) through
the exact same `submitPayment` path the REST `/pay` route uses. Keeps
today's "booking confirmed" chat UX, now backed by real IDs/persistence
instead of a mock string.

**Done:**
- `models/Booking.ts` + `models/Transaction.ts` — self-contained snapshots
  of the selected `BookingOption`/`BookingRequest` (search results aren't
  persisted anywhere else); `Transaction` references `Booking` (not the
  reverse) since a booking can accumulate multiple payment attempts (one
  declined, one later succeeding); a `paymentInFlight` boolean lock kept
  separate from the business-facing `status` enum for the concurrency
  guard (see below); masked-only payment method snapshot (`{brand, last4}`
  — full card number/CVV never stored, modeling real PCI-conscious
  behavior even though the data is entirely fake).
- `utils/idGenerator.ts` — `generateBookingReference`/`generateTransactionId`
  (`TT-XXXXXXXX`/`TXN-XXXXXXXXXX`, `crypto.randomBytes` over a
  confusable-character-excluded charset, no new npm dependency). No
  collision pre-check (racy anyway) — relies on the model's unique index
  + a retry-on-duplicate-key loop in the service layer.
- `services/bookingService.ts` — `createBooking`, `validateCardFormat`
  (superficial format checks only: digit count, expiry, CVV shape — never
  a real gateway call), `submitPayment` (the real REST-facing path — a
  well-formed-but-declined card still creates a `failed` Transaction and
  leaves the booking retry-friendly at `pending_payment` rather than a
  400, matching "full flow, not one-click fake"), `autoPayDummy` (chat
  path — synthesizes an always-valid dummy card, calls the exact same
  `submitPayment`, zero duplicated logic), `getBooking`/`listBookings`/
  `cancelBooking` (only cancellable while unpaid — a confirmed booking
  would need a refund-shaped flow, out of scope for a simulated system).
  `submitPayment` is idempotent (replaying on an already-`confirmed`
  booking returns the existing `Transaction`, doesn't duplicate) and
  race-safe against a genuine concurrent double-submit via an atomic
  `findOneAndUpdate` claim on `paymentInFlight` before any validation work.
- `controllers/bookingController.ts` + `routes/bookingRoutes.ts`, mounted
  as `/api/bookings` in `server.ts` — follows `savedTripController.js`/
  `savedTripRoutes.js`'s conventions exactly (blanket `auth` middleware,
  ownership via `{user: req.userId}` in every query, `{message, booking}`
  response shapes, 404/409/500 handling). `POST /` hardcodes
  `source: 'web'` — never trusts a client-supplied value, since only
  `bookingExecuteNode` should ever produce `source: 'chat'`.
- `bookingExecuteNode` (`booking-pipeline.ts`) rewritten to call the real
  service instead of returning a mock string; guards on missing
  `state.userId` first (same fail-closed pattern
  `agents/tools/account.ts`'s `userScoped` tools already use — a Booking
  must belong to a real user). `formatBookingResult` updated to render
  the real `bookingReference`/`transactionId`; heading changed from
  "Booking Placeholder Confirmed" to "Booking Confirmed" — no longer a
  placeholder.

**Deliberately not built:** any real payment gateway integration (never
planned to exist — explicit roadmap constraint); the actual frontend
payment form (Phase 8's job — this phase is the backend it will call);
cancellation/refund of an already-confirmed booking (a refund-shaped flow,
not needed for a fully simulated system).

**Verification:**
- `npx tsc --noEmit` — zero new errors versus the Phase 5 baseline (fixed
  5 `noImplicitReturns` violations in the new controller along the way by
  adding explicit `return`s — a real, if minor, correctness gap, not a
  style nit, since an implicit `undefined` return path in an Express
  handler is a bug waiting to happen).
- Service-layer script (DB-connected): valid-card payment → confirmed;
  malformed-card payment → stays `pending_payment` with a `failed`
  Transaction and a real reason; retried payment after a failure →
  succeeds, both attempts preserved (2 Transactions for 1 Booking,
  confirming the reference-direction design choice); idempotent replay on
  an already-confirmed booking → no duplicate Transaction; cancel then
  double-cancel → correctly rejected the second time; paying a cancelled
  booking → correctly rejected; **a genuine concurrent double-submit test
  (two simultaneous `submitPayment` calls on the same booking) → exactly
  one succeeded, one correctly rejected with `PaymentInProgressError`, and
  exactly one Transaction was created** — confirms the atomic
  `findOneAndUpdate` claim actually closes the race, not just in theory.
- REST smoke test against the real running server with a minted JWT:
  `POST /api/bookings` → `POST /:id/pay` (valid card) → `GET /api/bookings`
  → `GET /:id` → separate `POST /:id/cancel`, plus a 404 for a bogus id
  and a 401 for a missing token — all real HTTP round trips, correct
  status codes and response shapes throughout.
- Chat-path integration (real `TravelAgent`, stubbed planner + hotel
  search only): full two-turn flow (search → real interrupt pause → "yes,
  book it" → real `Booking`+`Transaction`) confirmed via direct MongoDB
  read afterward — real `bookingReference`, `status: 'confirmed'`, correct
  user ownership, real linked `Transaction` with `status: 'succeeded'`.
  Also confirmed an unauthenticated chat booking attempt (even a same-turn
  "confirmed:true" one) is refused with a sign-in message and, critically,
  **creates no Booking document at all** — the fail-closed guard holds
  even on the fast same-turn path.

---

## Post-Phase-6 verification — cross-turn state leak fix (2026-08-12)

Not a phase, but worth logging: browser-testing Phase 6's booking flow
surfaced a real bug. Every `AgentStateAnnotation` field used a
`(left, right) => right ?? left` reducer; with Phase 4's `MemorySaver`
checkpointer, a fresh turn re-invokes on the *same* thread_id as prior
turns, and a fresh turn's explicit `undefined` for an untouched field was
read by the nullish-coalescing reducer as "no update" — silently
preserving whatever the *previous* turn last set. Live symptom: after a
real hotel booking confirmed, the "Booking Confirmed" card kept
re-rendering for every unrelated follow-up message ("thanks!", "how are
you doing today") on that conversation, forever. Fixed by switching every
single-value field's reducer to unconditional last-write-wins
(`(left, right) => right`); `messages` keeps its `concat` reducer. Verified
via a DB-connected script and live in the browser — same repro, confirmed
fixed both ways.

---

## Phase 7 — Human-in-the-loop: slot-filling & explicit confirm/reject (2026-08-12)

**Context:** the booking pipeline (Phases 3-6) had two gaps its own code
comments explicitly deferred to this phase. First, `bookingSearchNode`
hard-errored on missing required fields (flights need origin+departDate;
hotels need destination) instead of asking for them — and the existing
workaround in `TOOL_SELECTION_SYSTEM_PROMPT` ("ask in your reply instead
of calling the tool") was confirmed structurally broken: `plannerNode` and
`responseFormatterNode`'s LLM calls only ever see the current turn's
message, never prior conversation history, so a follow-up reply like
"August 20th" would arrive with zero memory of what it was answering.
Second, `bookingConfirmNode`'s confirm/decline parsing was a single regex
where anything non-affirmative silently became a decline, with no way to
pick a specific option ("book the second one" always resolved to option 0).

**Done:**
- `bookingSlotFillNode` (new, `booking-pipeline.ts`) — inserted before
  `bookingSearchNode` in the graph. Builds the initial `BookingRequest`
  from `state.toolCalls` (moved here from `bookingSearchNode`), then for
  each missing required field (`REQUIRED_FIELDS`: hotel→destination,
  flight→origin/destination/departDate) asks the user via `interrupt()`
  and extracts the answer with a small `createStructuredChatModel` call
  (dates get today's date in the prompt so "next Friday"/"August 20th"
  resolve to a real `YYYY-MM-DD`), bounded to 2 attempts per field via a
  new shared `resolveViaInterrupt` helper before giving up with a clean
  terminal error. Uses the same multi-interrupt-per-node primitive
  `bookingConfirmNode` already relied on — LangGraph replays a paused
  node's earlier `interrupt()` calls from the checkpoint on each resume
  and pauses fresh at the next new one — so no new `AgentState` field was
  needed; the in-progress request lives in a local variable, replayed
  deterministically.
- `bookingConfirmNode` rewritten: `interpretBookingDecision`'s single regex
  replaced with a `createStructuredChatModel`-bound
  `{decision: "confirm"|"decline"|"unclear", optionIndex?}` classification,
  prompted with the reply text plus the actual option names/prices — so
  "book the second one" / "I'll take the Hilton" / "no thanks" / an
  off-topic reply are all correctly distinguished. An "unclear" reply
  re-prompts via a fresh `interrupt()` (bounded, 2 attempts, new
  `booking_clarify` kind) instead of silently declining; exhausting
  retries still declines (safer default than silently booking on
  ambiguous input). The same-turn `confirmed:true` fast path still
  resolves to option 0 — deliberately not extended with selection, since
  that would mean extending `book_hotel`/`book_flight`'s own schema, a
  separate concern from this node's HITL loop.
- New formatters `formatBookingSlotFillPrompt`/`formatBookingClarifyPrompt`;
  `travel-agent.ts`'s `chat()` generalized its interrupt-payload formatter
  from a hardcoded `formatBookingConfirmPrompt` to a dispatch on
  `payload.kind` (mirrors `formatToolData`'s existing dispatch-by-kind
  pattern). Graph wiring: new `booking_slot_fill` node between the
  planner's conditional edge and `booking_search`, with its own
  conditional edge (error → `response_formatter`, else → `booking_search`).
- `bookHotelToolSchema`/`bookFlightToolSchema`: destination/origin/
  departDate all changed from required to `.optional()` — the planner no
  longer needs a field in hand before calling the tool, and
  `TOOL_SELECTION_SYSTEM_PROMPT` updated to say so explicitly (removing the
  stale "ask in your reply instead" guidance that made this gap invisible
  in the first place).

**Real bug found and fixed during verification, not just a test
adjustment:** `extractBookingField`'s schema originally used
`z.string().nullable()`, which compiles to a JSON Schema type-array
(`["string","null"]`) — `gemini-3.1-flash-lite`'s stricter response_schema
validator rejects that outright (`400: Proto field is not repeating,
cannot start list`). Switched to `.optional()`, which just omits the
property instead and is universally supported; behaves identically for
this code's null-checking logic.

**Deliberately not built:** option-selection on the same-turn `confirmed:true`
fast path (see above); any change to `bookingExecuteNode`, `Booking`/
`Transaction` models, or REST booking routes (untouched, out of scope).

**Verification:**
- `npx tsc --noEmit` — zero new errors versus baseline.
- Gemini's free-tier daily quota for `gemini-2.5-flash` (20 requests/day)
  was exhausted mid-session from prior testing — confirmed via the API's
  own 429 response citing `GenerateRequestsPerDayPerProjectPerModel-FreeTier`.
  Verified instead by temporarily pointing `GEMINI_MODEL` at
  `gemini-3.1-flash-lite` (already this codebase's own designated default
  fallback) for the duration of testing, then reverting back to
  `gemini-2.5-flash` afterward.
- DB-connected scripts against the real `TravelAgent.chat()` (not stubbed):
  flight booking missing both origin and departDate → correctly asked for
  origin, then departDate across two separate resumed turns, correctly
  resolved "Mumbai" and "August 20th" → `2026-08-20`, and proceeded to a
  real `search_flights` call (which then hit the separate, pre-existing
  Phase 5 IATA-code gap below — not a Phase 7 defect). Hotel booking
  missing destination → correctly asked for it, resolved "Lisbon"/"Paris".
  Explicit decline ("no thanks") → handled correctly. An off-topic reply
  during confirmation ("what's the weather like there") → correctly
  triggered a `booking_clarify` re-prompt instead of a silent decline.
  "the second one" → correctly selected option index 1 and routed through
  to `bookingExecuteNode`, which correctly fail-closed on the test's
  missing `userId` (confirms the Phase 6 auth guard still holds with the
  new confirm-step flow — the error only reaches that specific message
  after `bookingConfirmed`/`selectedBookingOption` are already correctly
  set).
- Live browser retest deferred — `gemini-2.5-flash`'s daily quota is still
  exhausted post-revert; the DB-connected script verification above
  already exercises the real graph/checkpointer/LLM path end-to-end.

**Pre-existing gap found, not fixed (out of scope):** `search_flights`
(Phase 5) rejects free-text city names — SerpAPI's `google_flights` engine
requires IATA airport codes, and `mcp-servers/flights/api.ts` never
converts a city name to one. Surfaced live once slot-filling correctly
got as far as passing "Mumbai"→"Tokyo" through to a real search call.
Hotels are unaffected. Logged in `tasks.md`'s known-gaps list.

---

## Phase 8 — React frontend/AI chat integration (2026-08-12)

**Context:** Phases 3-7 built a fully working booking pipeline entirely
server-side. Two research passes (frontend chat architecture + backend
response shapes) confirmed the backend already computed everything this
phase needed — a real `pendingBooking` object with structured
`BookingOption[]`, and a real `{bookingReference, transactionId, option}`
on completion — but discarded almost all of it before the HTTP/socket
boundary, leaving the frontend with markdown text only. `conversationId`
was also regenerated every mount (`useState(() => crypto.randomUUID())`,
no `localStorage` read anywhere), so a reload always started a blank
thread even though `GET /api/chat/:conversationId` already existed and
could restore it.

**Done:**
- `travel-agent.ts`'s `chat()` return value: added a `bookingResult`
  field alongside the existing `pendingBooking` computation, populated
  from `result.toolData` when its kind is `booking_result` or
  `booking_declined` — reusing the exact same toolData-kind check that
  already nulled out `pendingBooking`.
- `chatController.ts`: relayed `pendingBooking`/`bookingResult` in both
  the HTTP response and the `agent:response` socket emit (previously only
  written to Mongo); added `pendingBooking` to `getConversation`'s
  response so a reloaded page can see an in-progress confirmation.
- `useSocket.js`: forwards the two new fields through to `lastMessage`.
- `Chat.jsx`: persists `conversationId` via `localStorage` (same
  lazy-initializer + persist-on-change pattern `TripContext.jsx` already
  uses for `tripData`); on mount, restores prior history via
  `GET /api/chat/:conversationId` when a persisted id exists, attaching
  any still-open `pendingBooking` onto the last restored message; added a
  "New chat" button (fresh UUID, no backend call needed); wired
  `onSelectOption`/`onConfirm`/`onDecline` callbacks that funnel into the
  existing `handleSendMessage` with a synthesized message ("book option
  N" / "yes" / "no thanks") — zero new backend surface, reuses Phase 7's
  structured decision-parsing entirely.
- `AuthContext.jsx`: `logout()` also clears the persisted conversationId,
  so a new login on the same browser doesn't inherit the previous user's
  thread.
- New `BookingOptionsCard.jsx`/`BookingReceipt.jsx` (shadcn `Card`/`Button`,
  matching `TripCard.jsx`'s visual conventions), wired into
  `MessageBubble.jsx` behind an `isLatest` gate for the options card
  (interactive buttons only make sense on the current outstanding
  confirmation — a receipt never goes stale, so it renders permanently on
  whichever message produced it).

**Two real bugs found and fixed during browser verification, not just
test adjustments:**
- **Invisible option-card text.** `dark:text-white` on text inside the
  shadcn `<Card>` rendered literally invisible — the app's dark styling
  elsewhere comes from explicit `dark:` Tailwind utilities responding to
  the OS's `prefers-color-scheme`, but `Card`'s own `bg-card` token stays
  a fixed white regardless (confirmed live via computed styles:
  `background-color: oklch(1 0 0)` with no `.dark` class on `<html>` at
  all). Fixed by dropping every `dark:` variant on Card-internal text in
  both new components, matching `TripCard.jsx`'s own convention of never
  using `dark:` for its (always-light) card content.
- **Off-by-one option selection — a real correctness bug, not cosmetic.**
  Clicking "Book this" on option 2 booked option 3 instead. Root cause:
  `classifyBookingDecision`'s prompt (`booking-pipeline.ts`) listed
  options 0-based ("0: ...", "1: ...", "2: ...") while the user-facing
  confirm message and the new card buttons both use 1-based numbering
  ("book option 2"). The LLM matched "option 2" against the prompt's
  literal "2:" line instead of subtracting one. Fixed by making the
  prompt's list and the returned field (`optionIndex` → `optionNumber`)
  both 1-based, matching exactly what the user reads/sends — the only
  0-based conversion now happens once, deterministically, in
  `bookingConfirmNode`, not inside the LLM prompt. Confirmed fixed live:
  "book option 3" on a 5-option Rome hotel search correctly booked
  "Hilton Garden Inn Rome Claridge" (the real option 3).
- Also fixed in passing: `{option.rating && (...)}` rendered a stray
  literal `"0"` for a genuinely 0-rated option (React's classic
  falsy-but-rendered footgun) — changed to `option.rating != null`.

**Deliberately not built:** a dedicated "My Bookings" page using the
existing REST `bookingRoutes.ts` (chat stays the only booking-management
surface for now — natural future addition, not part of this roadmap
phrase); option-selection on the same-turn `confirmed:true` fast path
(would mean extending `book_hotel`/`book_flight`'s own schema, a separate
concern from this phase's frontend focus).

**Verification:**
- `npx tsc --noEmit` (backend) — zero new errors versus baseline.
- `npx vite build` (frontend) — clean build, only a pre-existing
  chunk-size warning unrelated to this work.
- DB-connected script against the real `TravelAgent.chat()`: confirmed
  `pendingBooking` shape on an options-presented turn, `pendingBooking:
  null` + `bookingResult.declined` on a decline turn, and a real
  `bookingReference`/`transactionId`/correctly-selected `option` on an
  execute turn — using a real user id from the DB (not `undefined`, which
  would trip the unrelated Phase 6 fail-closed auth guard and mask these
  fields).
- Full live browser walkthrough (Gemini's `gemini-2.5-flash` daily quota
  was still exhausted from Phase 7's testing — reused the same temporary
  `gemini-3.1-flash-lite` swap, reverted after, dev server restarted
  cleanly both times): hotel search → option cards render with real
  images/prices/ratings → "Book this" on a specific card → correct
  receipt with real reference/transaction id → page reload mid-conversation
  restores full history plus the still-open confirmation card → "New
  chat" starts a genuinely fresh thread.

---

## Phase 9 — Real in-process MCP + agent slimming + dead-code removal

**The problem.** `mcp-servers/` was a folder name, not the Model Context
Protocol. All six domains were imported as plain ES modules by
`tool-registry.ts` and executed as direct function calls. The only file that
actually implemented MCP — `mcp-servers/places/server.ts` — was orphaned:
nothing imported it, `npm run mcp:places` ran `test-manual.ts` instead, and
its hand-rolled Zod→JSON-Schema converter typed every non-string as
`"number"` (it would have published `estimate_route.waypoints` — an array —
and `get_directions.mode` — an enum — as numbers). There was no MCP client
anywhere; `MCPConnection` in `types.ts` was an unused type. The SDK was a
declared-but-unused dependency.

Separately, `travel-agent.ts` had grown to 1804 lines and adding one tool
meant editing it in **four** places: `TOOL_RESULT_MAP`,
`USER_SCOPED_SIGNIN_MESSAGES`, the `formatToolData` switch, and a new private
`format*` method. Dispatch was already generic — the bloat was result-routing
and presentation.

**What was built.**

- `src/mcp/createDomainServer.ts` — one generic factory (replacing the
  105-line hand-rolled server) that registers a domain's tools on an
  `McpServer`. The SDK's own converter now produces the JSON Schema, so the
  type bug is gone by construction.
- `src/mcp/hub.ts` — `McpHub`. Six domain servers, each linked to a `Client`
  via `InMemoryTransport.createLinkedPair()`. Real `tools/list` / `tools/call`
  JSON-RPC, no subprocesses, no added latency.
- `tool-registry.ts` rewritten as an aggregator: 13 domain tools over MCP,
  4 account tools local. `executeTool()` keeps its exact signature and return
  shape, so `booking-pipeline.ts` needed **zero** changes.

**Three details that were load-bearing, not incidental:**

1. **Readiness is memoized inside the hub** (`ensureReady()`), not left to
   callers. `tool-registry.ts` builds its singleton at module-eval time —
   strictly before `startServer()` — and a constructor cannot await. The
   `await mcpHub.init()` in `server.ts` is therefore only a warm start;
   scripts that never call `startServer()` (`test-agents.ts`,
   `scripts/test-chat.ts`) keep working with no changes.
2. **Server connects before client.** `Client.connect()` sends `initialize`
   and awaits the reply; with the client first, the message sits in the
   transport queue and `connect()` never resolves. A 5s boot timeout makes a
   regression here fail loudly instead of hanging before `listen()`.
3. **`mcpHub.callTool` normalises MCP's error paths.** MCP emits
   plain-English (non-JSON) `content[0].text` on input-validation failure,
   tool-not-found and unexpected throws, and throws `McpError` on timeout.
   Without re-wrapping those as `{error}` JSON, `booking-pipeline.ts` — which
   `JSON.parse`s `content[0].text` directly — would have broken.

**Presentation moved out of the agent.** Each domain gained a
`presentation.ts` (`Record<toolName, (payload) => string>`), injected into
`createDomainServer` at the hub's wiring site and appended as a second content
block, leaving `content[0]` byte-identical.

This is explicitly **a TravelTea convention, not an MCP feature** — the
protocol's `content` array is a tool-result envelope and says nothing about
who owns application presentation. The seam is kept structural rather than
merely documented: `present` defaults to `{}`, so a bare
`createDomainServer(name, tools)` yields a spec-standard server with nothing
TravelTea-specific in it, and `npm run mcp:verify` asserts exactly that.

Limits of the convention, both deliberate: `web_search` has no entry (its
reply comes from `summarizeWebSearch`, which needs `userQuery` + `ragContext`
and an LLM call, so it isn't a pure function of the payload), and error
results are never rendered — they surface via `state.error`.

**Agent slimming.** `travel-agent.ts` 1804 → 1556 lines. Deleted
`TOOL_RESULT_MAP`, `USER_SCOPED_SIGNIN_MESSAGES`, the
`searchResults`/`nearbyAttractions`/`placeDetails` state slots, and 12 private
`format*` methods. Results now land in one generic `toolData: {kind: <toolName>,
data: payload}`; rendered markdown arrives as `state.toolRendered`; the
sign-in message is a `signInMessage` field on the tool. Adding a tool is now a
**one-file change** — `travel-agent.ts` is not touched at all.

`toolRendered` was added to the explicit reset block in `chat()`'s
`initialState`. Skipping that would have leaked the previous turn's rendered
block into the next turn on the same `thread_id` — the same class of bug as
the post-Phase-6 reducer fix, and not caught by `satisfies AgentState` since
the field is optional.

**Dead code removed** (each verified by grepping for callers first):
`mcp-servers/places/server.ts` (105 lines), `types.ts`'s `AgentState` /
`ToolResult` / `MCPConnection` (~53 lines — the file is now just
`AgentConfig`), `tool-registry.ts`'s `executeTools` / `getToolDescriptions` /
`getToolsForIntent` (~63 lines), `prompts.ts`'s `INTENT_CLASSIFIER_PROMPT` /
`RESPONSE_FORMATTER_PROMPT` plus the stale "You have access to these MCP
tools" block that listed 3 of 17 tools on a path where nothing is bound
(~42 lines), and two orphaned imports in `travel-agent.ts`. The SDK range was
bumped `^1.0.4` → `^1.29.0` (`registerTool` and
`InMemoryTransport.createLinkedPair` don't exist in 1.0.4; it worked only
because 1.29.0 happened to be installed), and the misnamed `mcp:places`
script became `places:test-api`.

**Two things deliberately NOT deleted**, both flagged rather than assumed:
- `generateItineraryWithContext_OLD` — an earlier read called it dead, but it
  is genuinely called at `travel-agent.ts:1494` as the per-city fallback when
  the enhanced builder fails. Left alone.
- `IntentDetector.detectIntent()` — has no callers, but deleting it cascades
  into `buildSystemPrompt`/`buildUserPrompt`/the model/the constructor,
  gutting the class down to the keyword `fallbackDetection` that the
  degraded path still uses. Left for an explicit decision.

**Verification:**
- `npm run mcp:verify` — 6 servers connect, 13 tools listed, and the three
  schema types the old converter got wrong now publish correctly
  (`estimate_route.waypoints` as array-of-string, `get_directions.mode` as an
  enum, `search_flights.returnDate` as an optional string); no `$ref`/`$defs`
  anywhere; and a presentation-free server returns exactly one parseable-JSON
  content block.
- `npm run mcp:verify-exec` — execution contract intact: happy path, bad args
  still yielding parseable JSON with `isError`, unknown tool still throwing,
  the local account path, and the two booking-pipeline call sites.
- `npm run mcp:verify-present` — all 13 cases pass: every moved formatter
  still renders, `web_search` correctly has no rendered block, and error
  results are correctly never rendered.
- `npx tsc --noEmit` — 55 → 50 errors. **Note: the build was already broken
  before this phase** (50 pre-existing errors across 10 files, mostly
  `noUnusedLocals`/`noUnusedParameters` and implicit-any in
  `travelDataController.ts`, `routes/itinerary.ts`, `scripts/`). No new
  errors were introduced; the 5 removed were dead-code deletions.
- Live server: boot order confirmed correct — tool registry, MongoDB, then
  `🔌 [MCP HUB] Connected 6 servers, 13 tools`, then `listen`.
- Live chat: `search_by_category` and `search_events` render through the new
  path; a tool turn followed by two casual turns on the same conversation
  confirmed **no stale-render leak** (the reset-block risk); full booking flow
  worked end to end — real SerpAPI hotel options over MCP → confirm → real
  `TT-KEAWWSKU` / `TXN-DTRCMVEGEZ` persisted, `bookingResult` returned and
  `pendingBooking` cleared, proving `toolData` survival.

**Observed, not changed:** the planner intermittently returns no tool calls
for queries like "distance from Paris to Lyon" and "travel tips for Japan",
answering conversationally instead. Confirmed from the logs to be planner/LLM
selection variance, not a formatting regression — where tools did run, the
rendered markdown flowed through correctly. Also unchanged:
`formatSearchResults` says "I found 0 amazing places!" on an empty result set
(moved verbatim), and `TRAVEL_AGENT_SYSTEM_PROMPT` still contains example
interactions showing tool calls on a path where no tools are bound.

---

## Phase 10 — Full-application test pass + bug fixes

A systematic end-to-end test of the whole app (browser + API), fixing every
defect found along the way. Prior phases had verified the MCP layer and the
booking pipeline; almost nothing else had been exercised, and **no write
operation had ever been tested**.

### Bugs found and fixed

**1. Natural phrasing returned zero results (HIGH).** `places/tools.ts`'s
schema description literally taught the model to pass phrases
(`"beaches in Thailand"`), but OpenTripMap's geocoder resolves bare place names
only. `"Prague"` → 3 results; `"attractions in Prague"` → **0**. Both built-in
suggestion chips ("Find beaches in Goa", "Show me attractions in Prayagraj")
hit it every time. Fixed with `normalizePlaceQuery()` (strips lead-ins like
"attractions in", "things to do in", repeatedly) applied to
`search_destinations.query` and both `location` args, plus a stricter schema
description. 18 unit cases, including negatives that must survive untouched
("Isle of Skye", "Palace of Versailles").

**2. Invented category codes 400'd the API (HIGH).** The same user query also
routed through `search_by_category`, where the model supplied
`tourist_attraction` — not a real OpenTripMap kind — and the API returned 400,
surfacing as "I couldn't find any places". Fixed with `coerceCategoryCodes()`
in `config/opentripmap-categories.ts`, mapping invented kinds through the
existing keyword table and falling back to
`interesting_places,cultural,historic`. The pre-existing `validateCategories()`
only deduplicated; it never validated against real codes.

**3. Empty results read as nonsense (HIGH).** `"I found 0 amazing places! Here
are the highlights:"` followed by nothing. Now `"I couldn't find any places for
**X**"` with a useful suggestion, plus singular/plural grammar and a proper
empty state for `get_nearby_attractions`.

**4. A network blip silently logged users out.** `AuthContext.jsx` treated a
failed `fetch` identically to a 401 and deleted the token, so every backend
restart ended the session — hit twice during this test. Now only a genuine 401
clears the token; network failures retry with backoff (1s/2s/4s) and keep the
session. Care needed in the `finally`: the first version skipped
`setLoading(false)` on the success path too, which would have hung the app on a
loading screen.

**5. Every itinerary was generated twice.** `React.StrictMode` double-invokes
effects in dev and `ResultsPage`'s effect had no guard despite its "Only run
once on mount" comment — so each visit fired two full generations in parallel:
double the Gemini and Google Places spend for identical output. A `useRef`
guard makes the second invocation a no-op. Verified by log counts: 4 calls
before, 2 after (one per city).

**6. Activity distribution front-loaded, leaving empty days.**
`enhancedItineraryBuilder` filled each day to a fixed quota from a sequential
cursor, so when supply ran short the last day got only the remainder — a 3-day
Pune leg came out **7/7/1** and the Goa leg ended on a **completely empty
day**. Added `distributeEvenly()` and derived per-day counts from actual
supply, preserving the configured morning:afternoon ratio. Now **6/6/5** and
**6/5/5**, and 33 activities instead of 29 because none are wasted.

**7. Both maps were completely broken.** `Chat.jsx` and `ItinearyPage.jsx`
filtered activities on `location.lat`/`location.lon`, but the
Google-Places-backed builder emits `location.latitude`/`longitude`. Every
generated itinerary therefore produced an empty location list: the itinerary
Map tab showed "No Locations Yet" on a 29-activity trip, and the chat map fell
back to its hardcoded Paris centre — which is why it showed Paris during a Rome
booking. `ItinearyPage.jsx:998` used `latitude` correctly in the same file,
which is what gave it away. Fixed with a shared `lib/coords.js`
(`activityCoords` / `toMapLocations`) accepting either shape and rejecting the
(0,0) sentinel. Both maps now render pins correctly.

**8. Timeline delete never matched.** `DeterministicCommandParser`'s delete
regex greedily captured the whole tail, so "remove Osho Ashram from day 2"
searched for an activity named `"osho ashram from day 2"`. Added
`stripScopeQualifier()` for trailing `from/on/in day N` and
`from the itinerary/trip/plan`. 8 cases pass, including names that must survive
("day trip to Lonavala", "Museum of Trip History"). Verified end to end: the
mutation applied and the DB went 33 → 32 activities.

**9. Mongoose errors surfaced as 500s.** `GET /api/saved-trips/<bad id>`
returned **500** (unhandled `CastError`) and `POST /api/saved-trips` with a
schema violation returned **500** instead of 400. Added a `sendError()` mapper
in `savedTripController.js` (CastError → 400, ValidationError → 400 with the
field list, duplicate key → 409) and applied it to 8 blanket-500 catch blocks —
the semantic-search fallback was deliberately left alone.

**10. Unmatched URLs rendered a blank page.** There was no catch-all route, so
a typo or stale bookmark produced an entirely blank screen with only a
react-router warning in the console. Added `<Route path="*">` redirecting
signed-in users to `/plan` and everyone else to the landing page.

**11. `totalDays` drifted from `cities`.** It was both derived and stored, so
they could disagree: cities `[Pune 3, Goa 3]` with a stored `totalDays` of 3
made the sidebar show "Duration: 3 days" and an End Date three days early while
the itinerary correctly showed 6. `TripContext` now derives it on load and on
every write path, which makes the drift unrepresentable and self-heals state
already in localStorage.

### Config

`GEMINI_MODEL` was `gemini-2.5-flash`, whose free tier is **20 requests/day**
and was exhausted — that is what silently emptied `/api/explore/recommendations`.
Switched to `gemini-3.1-flash-lite`, the lightest model in the family and the
code's own default. `TICKETMASTER_API_KEY` is still absent, so `search_events`
and the timeline's events section return empty by design (owner will add it).

### Regression suites added

The repo declared `"test": "vitest"` but contained **zero** test files. Added:

- `npm run qa:api` — 34 checks over every REST route including all the write
  operations (auth, preferences, profile, trips, saved-trips CRUD, the full
  booking + payment + idempotency + cancel flow, travel-data, search). Creates
  only its own records and deletes them; restores preferences it overwrites.
- `npm run qa:parser` — 8 cases for the timeline command parser.
- `npm run mcp:verify` / `mcp:verify-exec` / `mcp:verify-present` — from Phase 9.

### Verified working

Auth guards (8 protected routes 401 correctly) · full booking + payment flow
incl. declined card, idempotent repeat payment, and 409 on cancelling a
confirmed booking · Socket.io real-time (`itinerary_updated` received for an
API-driven timeline edit) · weather (3/3 near-term days; nulls beyond
OpenWeatherMap's 5-day free window are correct, not a bug) · itinerary
generation end to end · Save Trip · timeline editing · all 16 reachable pages ·
`vite build` clean · `tsc --noEmit` at the 50-error pre-existing baseline, no
new errors.

### Known, not fixed

- **RAG is entirely non-functional.** Every chat request fails all four vector
  layers with `Path 'archived' needs to be indexed as filter`. The agent has
  been running with zero retrieved context. Needs an Atlas vector-index
  definition change, not a code change.
- **`TripDetailsPage.jsx` (642 lines) is dead code** — its `/plan/details`
  route is commented out in `App.jsx`. Left in place since the comment implies
  intent to restore; flagged for an explicit decision.
- **Stats semantics differ across pages**: `/profile` counts only completed
  trips (3 cities / 9 days) while `/plan` and `/trips` count all saved trips
  including future ones (6 / 18). Same labels, different numbers, logic
  copy-pasted in three files.
- **Trending duplicates cities by case** — `exploreController.js` groups on
  exact `$cities.name`, so "Paris" and "paris" render as separate cards; it also
  does one sequential `searchPlaces` per city (~18s load).
- `components/ui/textarea.jsx` unreferenced; a stale `auth` key from an older
  auth scheme still sits in localStorage.
- `tsx watch` does not reliably release port 5000 on Windows, so a code edit can
  kill the dev server with `EADDRINUSE`; it silently served stale code once
  during this pass until noticed.

---

## Phase 11 — RAG repair (Atlas vector index + legacy backfill)

Phase 10 found that every chat request failed all four RAG layers with
`Path 'archived' needs to be indexed as filter`, so the agent had been running
with zero retrieved context. Diagnosis found **two independent causes**, both
of which had to be fixed — repairing only the index would have left the largest
knowledge layer permanently empty.

### Cause 1 — the Atlas index omitted two filter paths

`vector-retrieval.service.ts:38-42` pre-filters `$vectorSearch` on four fields:

```js
{ sourceType, archived: {$ne: true},
  $or: [{expiresAt: null}, {expiresAt: {$gt: now}}], userId }
```

Atlas requires every field used in a `filter` to be declared `type: "filter"`
in the index. The live `vector_index` declared six —
`category, country, city, tags, sourceType, userId` — but **not `archived` and
not `expiresAt`**, so Atlas rejected the entire query.

It failed silently because `searchLayer` catches the error, logs it, and
`return []` — an empty array is indistinguishable from "nothing relevant
found". `vector/scripts/seed-knowledge.ts:118-141` had documented the correct
9-field definition all along, including an explicit warning about exactly this
failure mode; the deployed index had simply drifted from it.

### Cause 2 — 39 of 98 documents could never match

`sourceType` distribution was `user_trips: 50 · null: 39 · search_knowledge: 6
· user_profile: 3` — **no `global_knowledge` layer existed at all**, despite 39
seeded Jaipur/Goa/Manali guides sitting in the collection.

Those 39 predate the `sourceType`/`archived`/`expiresAt` fields. The schema does
declare `default: 'global_knowledge'`, `default: false`, `default: null` — but
**Mongoose defaults apply on write only**, never retroactively. So the
documents had no `sourceType` and could not match an equality pre-filter even
with a correct index.

### Fix

Both applied programmatically via `npm run fix:vector` (the cluster is Atlas
MongoDB 8.0.29, so `updateSearchIndex` is available through the driver — no UI
step needed). The script is idempotent and supports `--dry-run`.

1. `updateSearchIndex('vector_index', …)` with the full 9-field definition,
   then poll until the rebuild completes.
2. `updateMany({sourceType: {$exists: false}}, {$set: {sourceType:
   'global_knowledge', archived: false, expiresAt: null, userId: null}})` —
   materialising the schema's own declared defaults. Embeddings untouched, so
   zero API cost and no re-embedding.

**A bug in the repair script itself, worth recording:** the first version
polled for `queryable === true` and for the new definition appearing in
`latestDefinition`. Both flip to "healthy" *immediately*, because Atlas keeps
serving the OLD index definition throughout a rebuild. The script therefore
reported success while the live probe was still being rejected. Only
`status === 'READY'` means the new definition is actually live; the poll now
requires that, and runs even on a re-run where the definition was already
correct but a previous rebuild was still in flight.

### Verification

- `npm run qa:vector` — new health check covering both causes (index filter
  paths, dimension match, per-field document coverage, presence of a
  global_knowledge layer). Went from **6 problems** to `RAG LOOKS HEALTHY`.
- Live `$vectorSearch` probe using the real retrieval pre-filter: accepted,
  3 hits — Baga Beach (Goa), Solang Valley (Manali), Jaipur Seasonal Guide.
  These are exactly the documents that had been invisible.
- Real chat request through the agent:
  `✅ Retrieval complete in 361ms. Profile: 1, Trips: 4, Global: 5, Search: 5`
  followed by `📝 [RAG] Building prompt context...` — all four layers
  populated, zero failures, where previously all four errored.
- Full regression re-run clean: `qa:api` 34/34, `qa:parser` 8/8, all three MCP
  suites passing, `tsc --noEmit` at the 50-error pre-existing baseline.

### Note for the future

`qa:vector` exists specifically so this drift is caught deliberately rather
than discovered by accident. Any new field added to the retrieval pre-filter
must be added to three places in step: the filter object in
`vector-retrieval.service.ts`, `INDEX_DEFINITION` in
`scripts/fix-vector-index.ts`, and `REQUIRED_FILTER_PATHS` in both QA scripts —
then `npm run fix:vector` applies it.

---

## Phase 12 — Dead-code removal + Results-step fix

Item 2 of the four outstanding items from Phase 10.

### Removed

- **`frontend/src/pages/TripDetailsPage.jsx` (641 lines).** A 6-tab trip detail
  view (Overview / Itinerary / Budget / Weather / Hotels / Activities) from an
  abandoned "browse pre-priced trip packages → select one → view details"
  design. Three independent reasons it could never work: its data source
  `tripData.selectedTrip` is only ever initialised to `null` and assigned
  nowhere in the codebase; its own route guard was
  `condition={tripData?.selectedTrip}`, so `ProtectedRoute` would have
  redirected away even if uncommented; and it reads `trip.price`, a flat
  package price no model has (`SavedTrip` carries `budget.total` with a
  five-way breakdown). Four of its six tabs rendered nothing but hardcoded
  2024 Paris/Rome mock data.

  History: added 2026-03-28, disabled 2026-07-19 in *"feat: Enhance itinerary
  features and improve chat functionality"* — the same commit that built the
  current itinerary features that superseded it. Never modified in between.
  Recoverable in full from commit `cfa450f` if the package flow is ever
  revived; doing so would mean building the selection flow and replacing four
  tabs of mock data, i.e. a rewrite rather than a revival.

- The commented-out `/plan/details` route block in `App.jsx`.
- **`frontend/src/components/ui/textarea.jsx`** — unreferenced; the app's two
  textareas are raw lowercase `<textarea>` elements, not this component.
- The stale **`auth`** localStorage key, cleared once on load in
  `AuthContext`. An older build stored `{token, user}` there; nothing has read
  it since the move to `traveltea_token`, so it sat in every existing user's
  browser holding a dead JWT. It actively caused confusion during Phase 10
  testing, where reading it produced a false "token expired" bug report.

**Proof nothing broke:** four strings unique to `TripDetailsPage`
("Hotel Plaza Paris", "Grand Hotel Rome", "No Trip Selected",
"Sacré-Cœur Basilica") were already absent from the production bundle before
the deletion — nothing imported the file, so Vite never included it. Bundle went
1,037,067 → 1,037,141 bytes: **+74**, accounted for entirely by the added `auth`
cleanup and the longer `generatedItinerary` property name. The deleted files
contributed zero bytes because they were never shipped.

`selectedTrip` itself was deliberately **left in `TripContext`** —
`TripPlanningSidebar` reads it, so removing it would have changed behaviour.

### Fixed

**The "Results" step could never show as completed.**
`TripPlanningSidebar.jsx:80` keyed the step's status off
`tripData?.selectedTrip`, which is permanently `null` — so Destinations,
Preferences and Budget all earned green checkmarks while Results stayed grey
forever, even after a full itinerary had been generated. Now keyed off
`tripData?.generatedItinerary`, which is what actually indicates the step is
done. The same dead reference in the Trip Summary visibility condition
(line 174) was switched over too. Verified live: Results now shows a green
checkmark.

### Verification

Rebuilt clean. Backend regression unchanged: `qa:vector` healthy, `qa:api`
34/34, `qa:parser` 8/8, all three MCP suites passing.

Note: `npx eslint` reports ~16-37 problems per frontend file, but they are
overwhelmingly `no-unused-vars` false positives on components that *are* used
in JSX (`Routes`, `Router`, `ToastContainer`, `SignupPage`, …) — the flat
config is missing React's JSX-uses-vars handling. Pre-existing across
untouched files; no new errors were introduced. Worth fixing separately.

---

## Phase 13 — Unified trip statistics (completed-trips semantics)

Item 3 of the four outstanding items from Phase 10.

### The problem

"Cities Visited" and "Days Traveled" were computed independently in three
places and disagreed with each other. `/profile` counted only completed trips
(3 cities / 9 days); `/plan` and `/trips` counted every saved trip including
ones that hadn't happened yet (6 / 18). Same labels, different numbers,
depending on which page you happened to be on.

Investigating turned up **three** divergences, not one:

1. **Which trips count** — completed only vs all saved.
2. **The `totalDays` fallback** — ProfilePage used `t.totalDays || 0`, while
   the other two fell back to summing per-city day counts. The latter is more
   robust for older saved trips that predate `totalDays`.
3. **What "upcoming" means** — ProfilePage compared `startDate >= now`
   (against the current instant), the others `isAfter(startDate, startOfDay(now))`
   (against midnight). These agree for midnight-normalised dates but drift for
   anything else.

### The fix

New `frontend/src/lib/tripStats.js` as the single source of truth, exporting
`getTripStats`, `getCompletedTrips`, `getUpcomingTrips`, `getTripEndDate` and
`tripDays`. All three pages now consume it; no page computes these numbers on
its own any more.

Resolved in favour of the **profile semantics**, per the owner's decision: a
trip you have not taken yet cannot have added cities or days to your travel
history. `citiesVisited` / `daysTraveled` / `countriesVisited` count completed
trips only; `totalTrips` still counts everything saved and `upcomingCount`
counts what is still ahead. The more robust per-city `totalDays` fallback was
kept, and the midnight-normalised definition of "upcoming" won.

`getTripEndDate` deliberately returns an **exclusive** end — the midnight after
the final day — because that is exactly when `end < now` should begin to be
true for a finished trip. Worth not confusing with the planning sidebar's
displayed "End Date", which uses `totalDays - 1` for the inclusive final day.
Both are correct for their own purpose; the helper documents the distinction so
the next reader doesn't "fix" one into the other.

Also removed the date-fns imports that became orphaned in `TripsPage.jsx`
(the whole import) and `TripPlannerPage.jsx` (trimmed to `{ format }`).

### Verification

All three pages now report identical figures — **Upcoming 2 · Cities Visited 3
· Days Traveled 15** — with `/profile` additionally showing Total 5 /
Completed 3, which reconciles. Confirmed no duplicated implementations or
orphaned `getTripEndDate` references remain. `vite build` clean; backend
regression unchanged (`qa:vector` healthy, `qa:api` 34/34, `qa:parser` 8/8,
all three MCP suites, `tsc` at the 50-error baseline).

---

## Phase 14 — Trending: case-insensitive grouping, caching, stable row size

Item 4, the last of the four outstanding items from Phase 10.

### Case-sensitive grouping

`getTrending` grouped on the raw `$cities.name`, so `"Paris"` and `"paris"`
formed two separate groups of **count 1 each**. Two consequences, and the
second is the worse one:

- When both made the top-8 cut they rendered as duplicate cards.
- More often they *didn't* make the cut, because splitting 2 trips into two 1s
  **understated the city's popularity** and pushed it below cities with fewer
  actual trips.

Now grouped on `{ $toLower: { $trim: ... } }`, with `$addToSet` collecting the
spellings and a `pickDisplayName` helper choosing which to show — preferring an
already-capitalised variant ("Paris" over "paris"), longest-wins as a tiebreak
so "New York City" survives, and title-casing the normalised key when every
variant is lowercase. Verified: Paris now appears **once with tripCount 2**,
correctly ranked 4th instead of buried among the count-1 cities.

### The ~7s load was not what it looked like

The obvious suspect was the sequential `await` inside a `for` loop, so that was
replaced with `Promise.all` (plus a per-city `try/catch`, so one unresolvable
city can no longer take down the endpoint). **It barely helped: 7.4s → 6.7s.**

Profiling each stage showed why. The per-city timings came back 3594, 3867,
4128, 4382, 4622, 4875, 5137, 5410ms — a perfect ~250ms staircase.
`mcp-servers/places/api.ts` funnels *every* OpenTripMap request through a
global queue with `MIN_REQUEST_INTERVAL_MS = 250` to avoid 429s. That throttle
is the floor, and it is deliberate — defeating it would just trade latency for
rate-limit errors.

So the fix is to stop recomputing: the response is now cached via `sharedCache`
for 1 hour under a global key (trending is identical for every user, and is
derived from saved trips, which barely move). **Cold 10.4s → warm ~250ms**, a
~40× improvement on the repeat loads users actually experience. The
`Promise.all` change is kept — it is still correct, and it means the throttle
is the only serialising factor rather than the caller as well.

### Row size was unstable

Consecutive loads returned 6, 7 and 8 items. Cities whose name doesn't resolve
in OpenTripMap get dropped — a user's `"banglore"` typo doesn't resolve, and
neither does `"Bengaluru"` — and the code took exactly 8 candidates, so every
miss shrank the row. It now over-fetches `TRENDING_SIZE * 2` candidates and
keeps the first 8 that resolve. Consistently 8 items across runs.

Trade-off, accepted deliberately: the cold path went 7.6s → 10.4s because it
resolves up to 16 candidates instead of 8. That cost is paid once an hour on a
cache miss, in exchange for a row that is always full.

### Verification

Live: 8 cards, single Paris (`tripCount 2`), no case duplicates, correct
count-desc ranking, and the row renders immediately instead of spinning.
Backend regression unchanged (`qa:vector` healthy, `qa:api` 34/34, `qa:parser`
8/8, all three MCP suites, `tsc` at the 50-error baseline); `vite build` clean.

### All four Phase 10 follow-ups are now closed

1. RAG / Atlas vector index — Phase 11
2. `TripDetailsPage` dead code + Results checkmark — Phase 12
3. Trip statistics unified on completed-trips semantics — Phase 13
4. Trending grouping, caching and row stability — this phase

---

## Phase 15 — Full agent-flow test + date-context fix

An end-to-end exercise of the entire agent surface through the real chat API,
added as `npm run qa:agent` (25 checks): places, transport, web search, events,
flights, hotels, the booking pipeline, itinerary generation, timeline editing,
account tools, RAG and casual chat. Assertions are loose about wording (the LLM
phrases things differently each run) and strict about structure — which tool
ran, whether real data came back, whether Mongo actually changed.

First run: **21 passed, 1 failed**, plus three passes that were hiding real
defects.

### 1. `plan_trip` produced no itinerary — "Failed to geocode destination"

`plan a 3 day trip to Rome` returned "I couldn't complete that request". The
planner selected `plan_trip` correctly; `itineraryBuilder.getDestinationCoords("Rome")`
returned null.

Rome geocodes fine — the OpenTripMap `/geoname` call returns valid coordinates.
The failure was one call later. `searchPlaces` requests N results from
`/radius`, then `transformGeoJSONFeatures` **discards unnamed features** (a
place with no name is useless to display). Because the API applies its `limit`
*before* that filter, asking for N could yield fewer — or zero.
`getDestinationCoords` calls `searchPlaces(query, 1)`, and Rome's single
nearest feature at the city-centre coordinate happens to be unnamed, so the
result was empty. Paris worked purely because its nearest node is named. A coin
flip on OSM data, silently breaking the whole itinerary build.

Fixed by over-fetching: request `clamp(limit * 4, 20, 100)` from the API,
filter, then slice to the caller's limit. Applied to both `searchPlaces` and
`searchByCategory`. Rome and Roma now resolve.

### 2. OpenTripMap silently fuzzy-matches to the wrong continent

Investigating the above surfaced that `/geoname` is a *populated-places*
gazetteer that quietly fuzzy-matches anything it can't find, and the code only
checked for a `lat`. `geoname?name=Eiffel Tower` returns
`{name: "Eiffel", country: "ZA", partial_match: true}` — a locality in South
Africa — and we would then return places near it as if they answered the
question. `searchPlaces` now rejects `partial_match` responses and logs them,
so the user gets an honest "couldn't find" instead of data from the wrong
hemisphere.

**Reported, not fixed** (needs a product decision, not a bug fix): exact-name
matches can still pick the wrong place, because the endpoint doesn't prefer the
most prominent candidate. Observed: `Leh` → **LEH, France** (pop 185,972)
rather than Leh in Ladakh; `San Francisco` → El Salvador (pop 16,152);
`Colosseum` → Australia (pop 229). This matters for real user data — there is a
saved "Leh → Ladakh" trip whose itinerary would be built around France.
Fixing it properly means disambiguation (prefer population, or pass a country
hint), not a one-line change.

### 3. The agent never knew what day it was

`what events are happening in Berlin next month?` produced
`search_events({startDate: "2025-06-01", endDate: "2025-06-30"})` — both dates
**in the past**, during 2026. The reply read "between 2026-08-17 and
2025-06-30": the tool clamps `start` forward to today but took `end` verbatim,
so the range was inverted.

Two independent causes, both fixed:

- **No date context in the prompt.** Nothing ever told the planner today's
  date, so every relative expression was dated from training data. This
  affected `search_events`, `search_hotels`, `book_hotel`/`book_flight`, and
  `search_flights` — where `departDate` is a *required* field, so a wrong year
  goes straight to SerpAPI. Added `currentDateContext()` in `prompts.ts`,
  appended to the planner's system message **per request** — deliberately not a
  module-level constant, which would freeze the date at process start and drift
  on a long-running server.
- **No validation of the range.** `events/tools.ts` now falls back to the
  default window whenever `endDate < startDate`, so a bad model-supplied range
  can't produce an inverted one.

Verified after the fix: "next month" → `2026-09-01 → 2026-09-30`, and "next
weekend" → `checkIn 2026-08-21` (a Friday) / `checkOut 2026-08-23`.

### Verified working end to end

`qa:agent` now reports **25 passed, 0 failed**, covering:

- Places search, restaurants, place details; transport distance and
  multi-stop routing (real Geoapify figures: Paris→Lyon 464.9 km, three-stop
  route 780.9 km / 6h47m).
- Booking pipeline: 20 real SerpAPI options with names and prices; "book the
  second one" selects the *second* option, not the first; the booking and its
  transaction both persist to Mongo (`status=confirmed` / `succeeded`);
  `pendingBooking` clears on resolve; declining creates no booking.
- Itinerary generation: 3 days, 18 activities, no empty days.
- Timeline editing: activity actually removed from the saved trip in Mongo.
- Account tools, RAG-backed answers, and casual chat not leaking the previous
  turn's tool output.

Also verified in the browser: `BookingOptionsCard` renders real thumbnails,
prices and ratings; clicking "Book this" on the **third** card booked the third
option (Lisbon Lodge 2, USD 64 — `TT-VQMWT8FS`), confirming the card path
selects correctly rather than defaulting to the first. `BookingReceipt` renders
the reference and transaction id, and the stored payment method is masked to
`{brand: "VISA", last4: "4242"}` with no card number retained.

### Minor, observed but not changed

- A confirmed booking renders **twice** in the chat — once as markdown text and
  again as the `BookingReceipt` card. Redundant, not broken.
- "find hotels in Lisbon" routes into the booking pipeline rather than a plain
  search. Defensible (it does show options), but "find" is not "book".
- While a booking confirmation is pending, an unrelated message is interpreted
  as the answer to it. Correct HITL behaviour, but worth knowing.
- The timeline-edit reply sometimes says it lacks the itinerary while the
  mutation is in fact applied successfully — the formatter runs independently
  of mutation application, so the wording can contradict the outcome.

---

## Phase 16 — The five outstanding agent-flow defects

All five items left flagged at the end of Phase 15, now fixed and verified.

### 1. Geocoding resolved the wrong place entirely

OpenTripMap's `/geoname` is a populated-places gazetteer that returns exactly
**one** result with no alternatives and no way to disambiguate. On plain,
exact-name queries it picked:

| query | resolved to |
|---|---|
| `Leh` | LEH, **France** |
| `San Francisco` | **El Salvador** (pop 16,152) |
| `Colosseum` | **Australia** (pop 229) |
| `Eiffel Tower` | "Eiffel", **South Africa** (a partial match) |

Actively wrong against real user data — a saved "Leh → Ladakh" trip would have
had its itinerary built around northern France. Since the endpoint returns a
single result, no ranking or population preference could fix it from within
OpenTripMap.

New `services/geocoding.ts` resolves names via **Nominatim** instead, which
gets all of the above right and additionally handles landmarks (Tour Eiffel,
Colosseo) that a populated-places gazetteer cannot represent at all.
OpenTripMap is retained as a fallback so an outage degrades to the old
behaviour rather than breaking search. Results are cached 30 days (coordinates
don't move) and requests pass through a single queue honouring Nominatim's
1 req/s policy with a proper User-Agent.

This also removed a **duplicate geocoder**: `transport/api.ts` had its own
un-throttled, un-cached Nominatim call sending a stale "TripWhat Travel
Planner" User-Agent, which could breach the rate limit whenever it ran
alongside a places lookup. It now delegates to the shared resolver.

Verified: `Leh` → India (`Matho Monastery`, 33.99°N), `Rome` → Italy
(Marcus Aurelius statue), plus San Francisco, Colosseum, Eiffel Tower, Goa,
Bengaluru and Tokyo all correct.

### 2. Confirmed bookings rendered twice

The assistant's markdown said the hotel, price, reference and transaction id,
and the `BookingReceipt` card directly beneath said exactly the same thing.
`MessageBubble` now hides the prose bubble when a (non-declined) booking result
is present and lets the card speak. Deliberately scoped to that case: with no
card — an older message, or a decline — the text is the only record.

### 3. "Find hotels" opened a booking confirmation

The planner prompt literally said to use `book_hotel` when the user wants to
"find or reserve" a place to stay, so a browse was pushed into the HITL
confirmation flow the user never asked for. The prompt now separates browsing
("find/show/what hotels are in X" → `search_hotels`) from intent to book
("book a hotel in X", "reserve a room" → `book_hotel`), with the same split for
flights.

That exposed a gap: `search_hotels` and `search_flights` had **no presentation
renderer**, because the booking pipeline was previously their only consumer.
Added `hotels/presentation.ts` and `flights/presentation.ts`, and threaded
`destination` through the hotels payload so the heading can name the city.

### 4. A pending booking held the conversation hostage

While a confirmation was open, *every* reply was classified as an answer to it.
An off-topic question came back as "I didn't quite catch that — say yes to
book…", and kept doing so until `maxAttempts` ran out. The decision classifier
now distinguishes **`unrelated`** (the user moved on to a different subject)
from `unclear` (still engaging with the booking, but ambiguously). On
`unrelated` the booking is released with an honest message — "I've set that
booking aside since you've moved on — nothing was booked" — so the next message
is handled normally instead of being swallowed.

### 5. The timeline reply contradicted what actually happened

A successful delete came back as *"Since you didn't specify which trip or city…"*
while the activity was, in fact, removed from Mongo.

`timelineEditorNode` set `response` but never set `intent`, and
`responseFormatterNode` only passes `state.response` through when
`intent === "edit_timeline"`. The carefully-built confirmation was therefore
discarded every time and the LLM invented a reply from scratch, with no idea an
edit had occurred. Both return paths now set `intent`, and the placeholder
("Applying your change…") was replaced by `describeMutations()`, which states
the actual edit: *"Done — I've removed **Pawna Lake** from your itinerary."*
Safe to assert the outcome here because `chatController` overwrites the
response if mutation application fails, so this wording is only ever seen on
the success path.

### Verification

A dedicated script exercised all five against the live server: Leh resolving to
Ladakh, "find hotels" rendering a hotel list with no confirmation opened, an
off-topic message releasing a pending booking, and a timeline delete both
mutating Mongo (28 → 27 activities) and replying "Done — I've removed…".
Fix 2 confirmed in the browser: a confirmed booking now shows the receipt card
alone, and "Book this" on the second card booked the second option
(The Central House Porto Ribeira, USD 86 — `TT-25MSMDZK`).

Full regression: `qa:agent` 25/25, `qa:api` 34/34, `qa:vector` healthy,
`qa:parser` 8/8, all three MCP suites passing, `tsc` at the 50-error baseline,
`vite build` clean.

---

## Phase 17 — Flights & Hotels: search pages, real checkout, transaction history

Direct (non-chat) booking. Until now flight and hotel search existed **only as
agent tools** — no REST endpoint — and the chat path auto-paid via
`autoPayDummy`, so no user had ever seen a checkout.

### Four blockers fixed first

**1. `paymentInFlight` leaked permanently.** `processPayment` had no
`try/finally`: if `Transaction.create` or `booking.save()` threw, the flag
stayed `true` and **every future payment on that booking returned 409 forever**
— no TTL, no sweeper. Harmless while only `autoPayDummy` called it;
unacceptable once a real user retries a card. The lock is now released in a
`finally` on every path, plus a stale-claim reclaim (2 min) as a backstop for a
process killed between claim and release.

**2. Flight search silently returned nothing for city names.** SerpAPI's
`google_flights` needs an IATA code; free text yields `[]`. New
`mcp-servers/flights/iata.ts` resolves city → code against a curated
118-airport dataset (`data/airports.json`, India-weighted). Deliberately wired
**inside `FlightsAPI.searchFlights`**, not the new controller, so the chat
agent stops silently failing too. Unresolvable input passes through untouched
so a valid code is never second-guessed.

**3. Search couldn't report failure.** Both API classes swallow every error
into `[]`, so a missing SerpAPI key was indistinguishable from "no flights on
that route". Added `isConfigured()` to both; the REST responses carry it and
the pages surface it as a distinct message.

**4. `hotelsAPI.searchHotels` requires both dates.** The tomorrow/+2-nights
defaulting lived in `hotels/tools.ts`; exported `defaultDates()` and reused it
rather than keeping a second copy that could drift.

### Payment methods — card, UPI, netbanking

`Transaction.paymentMethod` was `{brand, last4}` with both **required** — purely
card-shaped. Now a tagged snapshot (`type` + method-specific fields), with
`type` defaulting to `'card'` so every pre-existing row still reads correctly.
`submitPayment` takes a discriminated `PaymentInput`; `autoPayDummy` passes
`{method:'card', …}`, which is what keeps the chat path working unchanged.

Also added `DECLINE_TEST_CARD` (`4000000000000002`). `validateCardFormat` has
no Luhn and no issuer rules, so the *only* way to get a declined payment was
malformed input that `payBooking` rejects at 400 first — the "declined, try
another card" branch of a real checkout was literally unreachable and
untestable.

### New surface

- `GET /api/travel-search/{flights,hotels,airports}` — reuses the same
  `flightsAPI`/`hotelsAPI` singletons the MCP tools use, so SerpAPI caching
  (1h/24h) and request dedup are shared rather than duplicated.
- `GET /api/transactions` — mounted as its own router, **not**
  `/api/bookings/transactions`, which the existing `GET /:id` would have
  swallowed. `Transaction.user` was already indexed `{user:1, createdAt:-1}`
  for exactly this.
- Fixed alongside: `GET /api/bookings/:id` threw a CastError → **500** on a
  malformed id; now a 400, same mapping already used in `savedTripController`.

### Frontend

`DashboardNav` was declared **inside `TripPlannerPage.jsx`** and rendered
nowhere else, so every other page invented its own header. Extracted to
`components/DashboardNav.jsx` and given **Flights** and **Hotels** tabs.

- `pages/FlightsPage.jsx` — airport type-ahead (`components/AirportInput.jsx`,
  debounced + AbortController per the existing suggestion pattern), dates,
  passengers, results as flight rows.
- `pages/HotelsPage.jsx` — destination, check-in/out, guests; **nights derived
  from the dates** and shown, which is the "number of days" step.
- `components/booking/BookingCheckout.jsx` — three steps (Review → Payment →
  Receipt) with a stepper, rendered as an inline overlay because
  `components/ui/` has no dialog primitive and the codebase's convention is a
  conditional panel. Reuses `BookingReceipt.jsx` for step 3.
- **Transaction History** in `ProfilePage.jsx`, between Trip Statistics and
  Personal Information: item, status pill, method (`VISA ****4242` /
  `UPI name@bank` / `Netbanking — HDFC Bank`), date, reference, failure reason.
  Stacked rows, not a table — the app has no `<table>` anywhere.

Two contract details that would have caused silent bugs, handled explicitly:
a decline returns **HTTP 200** with `status: 'payment_failed'` (branch on the
body, never the status code), and `option.price.amount` must be a **string** or
the transaction amount lands as `null`.

The payment step carries an explicit "simulated payment, no real charge, no
card number stored" notice, and the service still persists only the masked
snapshot.

### Verification

New `npm run qa:booking` — **26 checks, all passing**: airport lookup and
ranking; flight search **by city name** (the resolver test — "Delhi"/"Mumbai"
now returns real flights where it previously returned zero); hotel search with
derived nights; a booking paid with **each** of the three methods, each
persisting the correctly-typed snapshot; declined card → HTTP 200 +
`payment_failed` with the booking left `pending_payment`; **retry after decline
succeeding**, which is the regression test for the lock leak; repeat payment
still returning "already paid"; unknown method → 400; malformed UPI id
declining rather than crashing; bad booking id → 400 not 500; transaction
history newest-first with populated booking; and an assertion that **no card
number ever appears** in a transaction.

Browser: hotels Lisbon → 20 real results → full checkout paid by UPI →
receipt `TT-CMXYZ4C2` / `TXN-JVQAKJ4U84` → appears top of Transaction History
as "UPI traveltea@hdfc · USD 56 · succeeded". Flights Delhi→Mumbai via the
autocomplete → 60 real flights (IndiGo DEL→BOM, 2h 15m, USD 63).

Full regression unchanged: `qa:agent` 25/25 (proves `autoPayDummy` survived the
payment-shape change), `qa:api` 34/34, `qa:vector` healthy, `qa:parser` 8/8,
all three MCP suites, `tsc` at the 50-error baseline, `vite build` clean.

---

## Phase 18 — Agent-driven trip planning

The whole trip through chat: the user says "plan and book my trip", the agent
collects the details in conversation, books a flight and a hotel, takes payment
inline, generates an itinerary around what was actually booked, saves it as a
real trip, and then edits it on command.

New `agents/trip-planning-pipeline.ts` plus a `plan_full_trip` virtual tool.
`plan_trip` is untouched and still means "just the itinerary, no bookings" —
`qa:agent` 25/25 is what proves the planner still distinguishes them.

### Why it's six graph nodes and not one

LangGraph resumes an interrupted run by re-invoking the **paused node from the
top**; already-resolved `interrupt()` calls return their stored value instead
of pausing again, so every line above them re-executes. A single node doing
"collect → search → book → pay → generate" would therefore re-run
`createBooking` on every later resume and **double-book the user**.

Nodes that have already returned are checkpointed and never re-run. So the
pipeline is split such that each node holds at most one interrupt point and —
the rule that actually matters — **every side effect sits after the last
interrupt in its node**. Code after the final interrupt runs exactly once,
because a paused node never reached it. `qa:trip` asserts the booking count
directly (`61 -> 63` across several resumes) rather than trusting the argument.

`trip_collect` is a **self-loop**, asking one field per execution and returning
the merged plan. Looping inside the node would work, but each resume would
replay every earlier slot's extraction call — O(n²) tokens over a six-field
flow. Returning between questions checkpoints the progress, so each answer
costs exactly one LLM call.

### Guided but flexible

The extractor is multi-slot, not single-field: it sees the whole plan on every
reply. "Mumbai to Goa, 3 days from 2026-12-12, budget $1500, honeymoon, 2
people" fills seven slots in one turn; a later "make it 7 days" revises an
answer already given. The node only ever *asks* for the first missing field and
never refuses information offered out of order. Free-text intent is mapped onto
the existing six `TravelType`s ("honeymoon" → leisure), so the itinerary
builder's category/pacing tables are reused rather than duplicated.

### Payment never travels as a chat message

Chat messages are persisted verbatim to Mongo and replayed to the model
(`chatController.ts:54-61`), so payment details must not pass through them. The
payment step hands the frontend the held bookings' ids and pauses;
`Chat/TripStepCard.jsx` posts card/UPI/netbanking details **straight to
`POST /api/bookings/:id/pay`**, then sends a detail-free "payment done" to
resume. The node then **re-reads the bookings from the database** — the user's
word is not evidence. `qa:trip` asserts exactly that: "I paid, go ahead"
without paying leaves the flow on the payment step.

`components/booking/PaymentMethodForm.jsx` was extracted from
`BookingCheckout.jsx` so the two payment surfaces cannot drift on the payload
shape or the "simulated payment, nothing stored" notice.

### Four defects found by testing this, all fixed

1. **`useSocket.js` re-projects the socket payload field by field**, so
   `pendingTrip`/`tripPlanResult` were silently dropped and no interactive card
   ever rendered. Found in the browser, not by the API suite — which is why the
   browser pass was worth doing.
2. **`buildBudgetAwareDayPlan`'s used-place sets were declared per-day** despite
   a comment claiming they were global, so the same attraction could be
   scheduled on day 1 and again on day 2. This builder had no other caller;
   the bug was latent until this phase activated it.
3. **The day-filling fallback relaxed uniqueness instead of budget.** With an
   over-budget trip the activity budget landed at $0, every priced attraction
   was rejected, and the fallback then repeated the few free entries — the same
   wildlife sanctuary in both the morning and afternoon of one day. It now
   relaxes budget and never uniqueness: a thinner day beats telling someone to
   visit one place twice. Plus a `MIN_ACTIVITY_BUDGET_PER_DAY` floor so an
   over-budget trip still gets a real plan, and the reply says plainly that it's
   over ("$1907, which is $407 over your $1500 budget").
4. **`bookedSpend` multiplied by travellers and nights**, but
   `bookingService.ts:198` charges exactly `option.price.amount`. The "spent"
   figure would have contradicted the user's own transaction history.

### Editable afterwards

`tripItineraryNode` persists a real `SavedTrip` and returns its id;
`Chat.jsx` adopts it as `activeTripId` (replacing the whole trip context, not
merging the id next to a stale planner session), so the existing
`edit_timeline` path edits the agent's itinerary with no new machinery.
Verified end to end on an agent-created trip: "remove Bondla WLS from day 1"
→ 9 activities → 8.

### Verification

New `npm run qa:trip` — **51 checks, all passing**: guided one-at-a-time
collection; multi-slot and out-of-order answers; intent mapping; the full
hotel-only and flight+hotel paths; exactly-once booking creation across
resumes; the fake-payment rejection; real dates stamped on the days; the
SavedTrip and its context; editing by command; abandoning mid-flow releasing
the conversation instead of holding the next messages hostage; `plan_trip` not
being hijacked; and no activity scheduled twice.

Browser: Mumbai→Goa, 3 days, $1500, honeymoon, 2 people → 5 real flights →
Ethiopian USD 1744 → 5 real hotels → Cintacor USD 163 → inline netbanking for
USD 1907 → 9 distinct activities across 3 dated days → saved and edited.

Full regression unchanged: `qa:agent` 25/25, `qa:booking` 26/26, `qa:api`
34/34, `qa:parser` 8/8, `qa:vector` healthy, all three MCP suites, `tsc` at the
18 non-noise baseline, `vite build` clean.

---

## Phase 19 — Search, RAG, and saving an itinerary from chat

### The finding: semantic search had never actually run

`semanticSearchTrips` queried an Atlas index named `trip_semantic_search`.
That index **did not exist**. `$vectorSearch` throws against a missing index,
and the controller caught that into a regex fallback — so every "semantic"
search silently degraded to substring matching on title/description/tags, and
looked like it sort of worked. "beach trip" matched nothing because no title
contains that substring.

`npm run fix:trip-index` creates it (with `user` as a filter path — Atlas
rejects the whole query when a pre-filtered path isn't indexed, the same
failure `fix-vector-index.ts` documents) and backfills missing embeddings. It
found **12 trips with no embedding at all**, all created by the Phase 18 agent
pipeline.

### Hybrid, with a measured threshold

New `services/tripSearch.ts`, used by both the Saved Trips page and the global
search bar so they cannot drift. Lexical and semantic run in parallel; lexical
hits rank first, because an exact substring the user typed is a stronger signal
than any similarity score.

Neither half is sufficient alone: pure lexical is what shipped, and pure
semantic misses the commonest case of all — typing a trip's exact name, where
short-title embeddings are noisy.

Scores sit in a **narrow 0.75–0.88 band**, so a single absolute cutoff can't
separate signal from noise. Measured across the corpus:

| query | top score | verdict |
|---|---|---|
| Goa / Lisbon / Paris | 0.875 / 0.868 / 0.851 | real |
| mountain trekking / business travel / beach | 0.838 / 0.831 / 0.821 | real |
| zzzzzz / qwerty asdf / sushi in tokyo | 0.781 / 0.774 / 0.758 | noise |

0.80 is the gap between those clusters, so that is the absolute floor — plus a
**relative** margin of 0.05 off the top hit, which is what keeps a precise query
precise: "Paris" scores 0.851 then 0.774, so it returns exactly one trip, while
"Goa" (0.875/0.867/0.866/0.865) returns all four.

### RAG reaches the planner

Retrieval already ran on every turn and already included the user's profile and
past trips, but `ragContext` only fed the *reply formatter*. **Tool selection
never saw any of it**, so "book me a hotel like last time" had to be answered
from the message text alone. The planner's system prompt now carries it,
explicitly framed as background rather than as the request.

### Saving an itinerary from chat

`plan_trip` generated an itinerary and then dropped it — nothing persisted, so
nothing could be edited. Each itinerary now carries **Save trip** and **Edit
with AI**. Edit saves first, silently: `edit_timeline` mutates a real SavedTrip
by id, so an unsaved chat itinerary has nothing to edit.

New `services/tripPersistence.ts` is the single place a generated itinerary
becomes a SavedTrip. Three call sites needed this and only one did it fully —
the REST path embedded *and* vector-ingested the trip, while the agent pipeline
did neither, which is why agent-planned trips were invisible to both search
bars and to RAG. It also owns the `travelers`/`numberOfPeople` and
`duration`/`totalDays` mapping, which only fails at write time.

### Bugs fixed from the previous round

**The 30s agent timeout was under the real cost.** Measured: embedding ~0.9s +
RAG ~0.3s + planner LLM + cold itinerary build ~5.5s. A cold city measured
**30.1s** — just over. The failure mode was actively wasteful: the itinerary was
fully built server-side and then thrown away, and the user got "Failed to
process your message" for work that had succeeded. Budget raised to 75s (client
to 85s, which must stay above it), and a timeout now returns 504 with an honest
message instead of being indistinguishable from a crash.

**Itineraries scheduled the same place twice.** Three independent causes, all in
`itineraryBuilder`:
1. `buildDayPlan` re-shuffled the pool on *every* day and indexed it with
   `(baseIndex + i) % length`. The modulo repeated places once demand exceeded
   the pool (3 days x 4 slots vs Rome's 10 attractions), and re-shuffling meant
   `baseIndex` pointed into a different random order each day — so the "unique
   distribution across days" the comment promised never held. Now the pool is
   shuffled once and consumed by cursor.
2. OpenTripMap returns overlapping categories, so `attractions + culture +
   nature` duplicated places before scheduling. Deduped at pool construction,
   and the activity and restaurant pools are deduped **against each other** —
   one place can be both, and deduping them separately still scheduled it twice.
3. The same landmark can carry several xids with coordinates tens of metres
   apart (Hanoi's Hoa Phong Tower: N3226400740 / Q10825843, 28m; Lisbon's Praça
   do Comércio: R9423812 / R9218842, 120m). Coordinate bucketing was tried and
   is the wrong tool — any rounding wide enough to merge those also merges real
   neighbours. Keyed on normalised name instead.

Verified across Rome, Goa, Hanoi, Lisbon, Kyoto and Paris: zero duplicates.

**Clearing the Saved Trips search box showed "0 saved trips".** `clearTimeout`
only stops a request that hasn't been sent; one already in flight still
resolved and overwrote the full list with its own results. Every exit path from
the effect now marks itself cancelled. Added a clear button, a spinner, and a
match count so an empty result reads as an answer rather than a broken page.

**Also**: a Home button on the map/chat page (it is full-screen with no app
chrome, so there was no way back to planning short of the browser's back
button).

### Verification

New `npm run qa:search` — **20 checks, all passing**: both Atlas indexes exist,
are READY and index their filter paths (asserted directly, not inferred from
"some results came back" — that inference is exactly what hid the bug); every
trip is embedded, agent-planned ones included; lexical precision and semantic
recall each demonstrated; all three gibberish queries return nothing; both HTTP
surfaces; and all three RAG layers populated.

Browser: "beach" on Saved Trips returns Goa/Ladakh/Mumbai with no title
containing the word; typing then instantly clearing restores all 30 trips;
Save → "Saved" with the trip context adopted; Edit → "remove Lupercal from
day 1" → 12 activities to 11, persisted.

Full regression unchanged: `qa:agent` 25/25, `qa:trip` 51/51, `qa:booking`
26/26, `qa:api` 34/34, `qa:parser` 8/8, all three MCP suites, `tsc` at the 18
non-noise baseline, `vite build` clean.

---

## Phase 20 — Itinerary generation fixed, full slot collection, transactions page

### Why the agent couldn't generate an itinerary

Three separate bugs, each of which alone was enough to break it. All three hit
*after* the user had already paid.

**1. Coordinates came from a POI search, not a geocoder.**
`getDestinationCoords` took the location of the first *point of interest*
matching the name. That silently fails for any destination with no named POI on
its own centroid — "Maldives" and "Iceland" both geocode fine (3.720,73.224 and
64.984,-18.106) but return **zero** POIs, so the build aborted with "Failed to
geocode destination". It now calls the real geocoder (`services/geocoding.ts`),
keeping the POI search as a fallback for landmarks the gazetteer lacks.

**2. A fixed 15km search radius.** That assumes every destination is a city
whose attractions cluster around its centroid. Maldives' centroid is open water
between atolls, so even with correct coordinates the itinerary came back with
**zero activities**. Added progressive widening (15km → 50 → 150 → 400), lazy:
the first radius that yields enough wins, so the common city case still costs
one round of requests. Maldives now yields 8-9 activities, Iceland 9; Rome is
unchanged at 3.4s.

**3. `RangeError: Invalid time value`.** `startDate` was trusted to be a valid
`YYYY-MM-DD` everywhere it was used, but it comes from an LLM. The planner was
observed emitting a **doubled** value, `"2026-09-05,2026-09-05"`, which threw
in `new Date(...).toISOString()` and killed the hotel search and then the
itinerary node — after the itinerary had already been built successfully. New
`parseTripDate` validates at both boundaries (planner tool args *and* slot
extraction) and rejects impossible days that JS would roll over (2026-02-31);
an unusable value is dropped so the flow re-asks, which is recoverable.

Also: the completion guard counted **days**, not activities. The builder returns
the requested number of empty days when the place lookup finds nothing, so a
blank schedule was presented as a finished plan. It now counts activities and,
if there are none, says so honestly and states whether anything was booked.

### The flow now asks for everything

Required slots went from 5 to 8, in the order a person would volunteer them:
**destination → dates → days → travellers → budget → trip type → priorities →
origin**. Previously it never asked how many people were travelling.

- **Priorities** ("what matters most — food, museums, beaches, nightlife…") are
  mapped to OpenTripMap categories and lead the itinerary's category list, with
  the travel type's defaults behind them. Two people on a "leisure" trip who
  care about food versus hiking no longer get the same day plan.
- **Origin** is satisfiable two ways — a departure city, or saying they'll
  arrange their own travel (`noFlightNeeded`). Without that distinction "I'm
  driving there" left the question unanswered and the flow kept asking.

### Off-topic replies no longer corrupt the plan

Mid-collection, "what's the weather in Tokyo?" was mined for slots and
**silently rewrote the destination from Porto to Tokyo** — the user would have
been booked into the wrong city. The extractor now returns `unrelated`, and the
flow releases rather than re-prompting, matching what the option lists already
did.

### Two more duplicate-scheduling causes

`buildBudgetAwareDayPlan` keyed "have we used this place?" on
`name-latitude-longitude`, which is case- and coordinate-sensitive, so "Bikini
Beach" and "Bikini beach" both landed in one Maldives itinerary. All four call
sites now share `ItineraryBuilder.placeKey` (normalised name), matching
`dedupePlaces` — the two scheduling paths finally agree on what a duplicate is.
Verified across Maldives, Iceland, Rome, Goa and Lisbon at 5 days: zero
duplicates.

### Transactions moved to their own page

The Profile page rendered the entire payment list inline. It only ever grows,
so it pushed App Settings and Personal Information further out of reach with
every booking. Profile now shows a three-number summary (count, succeeded,
total paid) plus the three most recent, and links to a new `/transactions`
page with pagination and All/Succeeded/Failed filters. The row itself moved to
`components/TransactionRow.jsx` so the two surfaces cannot drift on how a
payment method or a failure is rendered — `formatPaymentMethod` went with it,
since rendering the tagged card/upi/netbanking snapshot is a property of the
data, not of the page.

### Verification

`qa:trip` **51/51** with the expanded slot set, including an end-to-end
Maldives run: 8 questions asked, "no flights needed" honoured, hotel booked and
paid, itinerary of 5 dated days with 10 distinct activities, saved.

Full regression: `qa:agent` 25/25, `qa:search` 20/20, `qa:booking` 26/26,
`qa:api` 34/34, `qa:parser` 8/8, all three MCP suites, `tsc` at the 18
non-noise baseline, `vite build` clean.

Browser: Profile summary compact with Personal Information reachable again;
`/transactions` paginates 20 per page (Page 2 of 7) and filters to 3 failed.
