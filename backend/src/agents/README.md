# Agent architecture (baseline)

Snapshot of how the AI agent is wired, as a starting point for the phased
AI-travel-agent roadmap. Update this when the shape of the graph, tools, or
LLM client conventions change.

## LangGraph workflow (`travel-agent.ts`)

`TravelAgent` builds a `StateGraph` (`@langchain/langgraph`) with these nodes:

```
__start__ → planner → tool_executor                              → response_formatter
                     → timeline_editor                            →
                     → booking_search → booking_present_options
                                       → booking_confirm → booking_execute →
                                                          (else) ↗
```

- **planner** — uses native Gemini tool-calling (`bindTools`) to decide
  which tool(s), if any, the query needs; see "Dispatch" below.
- **tool_executor** — calls tools via `toolRegistry` (see below).
- **timeline_editor** — handles itinerary/timeline edit commands; tries
  `DeterministicCommandParser` (regex-based) before falling back to Gemini.
- **booking_search / booking_present_options / booking_confirm /
  booking_execute** — the Phase 3 booking pipeline; see its own section
  below.
- **response_formatter** — produces the final conversational reply.

## Tool layer (`tool-registry.ts` + `../mcp/`)

`ToolRegistry` is an **aggregator over two execution paths**:

- **13 domain tools run inside real in-process MCP servers** and are invoked
  over genuine `tools/call` JSON-RPC via `../mcp/hub.ts`. One server per
  domain (`places`, `transport`, `websearch`, `events`, `flights`, `hotels`),
  each built by the shared `../mcp/createDomainServer.ts` factory and wired to
  a `Client` through `InMemoryTransport.createLinkedPair()` — a real protocol
  boundary with no subprocesses and no added latency.
- **4 account tools stay local, off the protocol** (`./tools/account.ts` —
  saved trips & travel preferences, calling `SavedTrip`/`User` Mongoose models
  directly). They take a server-trusted `userId`; putting that in an MCP input
  schema would leak authentication across the boundary. All 4 are
  `userScoped: true` — see "Dispatch" below.

Tool objects are still imported statically because they remain the single
local source of truth for the Zod schemas that `travel-agent.ts` binds to
Gemini. **Only execution crosses the protocol** — binding from `tools/list`
JSON Schema would produce byte-identical output (both the MCP SDK and
`@langchain/core` convert via the same `zod-to-json-schema` package) while
forcing the `TravelAgent` constructor to become async, which `routes/
itinerary.ts` would feel on every request since it builds a new agent per call.

Call tools via `toolRegistry.executeTool(name, args)` — signature and return
shape are unchanged from before MCP. Validation is **enforcing**: `executeTool`
runs `inputSchema.safeParse(args)` and returns `{content, isError: true}` on
mismatch instead of dispatching.

`mcpHub.callTool` **normalises MCP's error paths** back to that contract:
MCP emits plain-English (non-JSON) `content[0].text` on input-validation
failure, tool-not-found, and unexpected throws, and throws `McpError` on
timeout. The hub re-wraps all of those as `{error}` JSON. This is what keeps
`booking-pipeline.ts` — which `JSON.parse`s `content[0].text` directly —
working without a single change.

Readiness is **memoized inside the hub** (`ensureReady()`), not left to
callers: `tool-registry.ts` builds its singleton at module-eval time, strictly
before `startServer()` runs, and a constructor cannot await. `server.ts` calls
`await mcpHub.init()` between `connectDB()` and `httpServer.listen()`, but that
is only a warm start — scripts like `test-agents.ts` that never run
`startServer()` work regardless.

Verify the layer with `npm run mcp:verify` (schema conversion + the seam),
`npm run mcp:verify-exec` (the execution contract), and
`npm run mcp:verify-present` (every moved formatter still renders).

### Presentation is a TravelTea convention, not an MCP feature

Each domain has a `presentation.ts` — a `Record<toolName, (payload) => string>`
of markdown renderers — which `createDomainServer` appends to the result as a
second content block, leaving `content[0]` byte-identical.

Be precise about what this is. MCP's `content` array is a *tool result*
envelope aimed at the model/client; the protocol says nothing about who owns
the host application's presentation. We use it as a convenient carrier because
it already crosses the boundary, and it lets the per-tool formatters leave
`travel-agent.ts` for good.

The seam is kept **structural, not just documented**: presentation is injected
at construction time and defaults to `{}`, so
`createDomainServer('traveltea-places', placesTools)` with no third argument
yields a clean, spec-standard server with nothing TravelTea-specific in it —
which is what you'd want if these were ever exposed to a third-party MCP
client. `npm run mcp:verify` asserts exactly that.

The convention has a limit: it only works for presentation that is a **pure
function of the tool payload**. `web_search` is the standing exception — its
reply comes from `summarizeWebSearch`, which needs `userQuery` + `ragContext`
and makes an LLM call, so it has no presentation entry and still renders
agent-side. Error results are never rendered either; they surface through
`state.error`.

17 tools registered as of Phase 5: the original 10 (places/transport/
websearch) plus `search_events`, `list_saved_trips`, `get_upcoming_trip`,
`get_travel_preferences`, `update_travel_preferences`, `search_flights`,
`search_hotels`. All reachable via native tool-calling.

### External data sources (Phase 5)

- **`search_flights`/`search_hotels`** (`mcp-servers/{flights,hotels}/api.ts`)
  — real search data via SerpAPI's dedicated `google_flights`/`google_hotels`
  engines (legitimate scraping-as-a-service — SerpAPI scrapes Google's result
  pages for us — not a raw HTML scraper against airline/hotel sites, and no
  Amadeus, per the roadmap's no-Amadeus decision). Both wrap `getJson()` the
  same way `geminiWebSearch.ts`/`websearch/api.ts` already did (previously
  only with the generic organic-search engine). Results are cached via
  `sharedCache.fetchOrCache` (1h flights / 24h hotels, matching
  `amadeusService.ts`'s exact TTL precedent) — SerpAPI's free tier is 250
  searches/month total, shared with `web_search`/`search_travel_tips`.
  `search_flights.departDate` is a **required** schema field (SerpAPI's
  `google_flights` engine requires `outbound_date`) — Gemini either extracts
  a real date or asks the user directly instead of the tool silently
  failing. `search_hotels`'s dates are optional and default server-side
  (tomorrow, 2 nights) since a dateless "show me hotels in X" is a much more
  natural request than a dateless flight search. Both degrade to an empty
  result on any failure (missing key, unresolvable location, network error,
  SerpAPI-reported error) — never a crash, never fabricated data.
- **`calculate_distance`/`get_directions`/`estimate_route`**
  (`mcp-servers/transport/api.ts`) — real routing via Geoapify's Routing API
  (`GEOAPIFY_API_KEY`), replacing what was previously 100% synthetic
  Haversine-straight-line-plus-flat-speed math dressed up to look like real
  routing. Falls back to that original Haversine logic (kept as private
  methods, not deleted) if the real routing call fails for any reason — a
  real, observed case: Geoapify's `walk` mode rejects any pair over 100km
  apart with a 400, which the fallback absorbs gracefully into a (long but
  honest) walking-speed estimate instead of erroring out to the user.
  `estimateMultiStopRoute` uses Geoapify's native multi-waypoint support
  (one request, `legs[]` in the response) instead of the old N-pairwise-call
  loop, when every waypoint geocodes successfully; falls back to the
  pairwise loop (which itself tries Geoapify per-leg, then Haversine) if any
  waypoint fails to geocode — preserves the original "skip just the bad leg"
  behavior. Routing results are cached 24h (road geometry is effectively
  static).
- **`search_restaurants`** (`mcp-servers/places/tools.ts`) — unchanged,
  already real OpenTripMap data since before Phase 5; this already satisfies
  the roadmap's "OpenTripMap for restaurants" line as written. Data is thin
  (no cuisine/price/hours — OpenTripMap doesn't have that for most POIs), a
  pre-existing, accepted limitation, not something this phase changed.

## Dispatch: native tool-calling (`travel-agent.ts`)

The planner binds every registered tool, plus two virtual actions that
aren't `toolRegistry` entries (`plan_trip` — builds an itinerary via
`itineraryBuilder`; `edit_timeline` — a marker only, routes straight to
`timelineEditorNode`), to the LLM via `ChatGoogleGenerativeAI.bindTools()`
(built once in the constructor as `this.toolCallingModel`). `plannerNode`
invokes it with `TOOL_SELECTION_SYSTEM_PROMPT` and reads Gemini's real
structured `response.tool_calls` — genuine function-calling, not prompt+regex
JSON. The conditional edge after `planner` is now just: a call named
`edit_timeline` → `timeline_editor`; any tool calls → `tool_executor`; none →
`response_formatter` (casual chat).

`toolExecutorNode` is a generic loop over `state.toolCalls`, no more
per-intent switch. For `userScoped` tools, the bound schema omits `userId`
entirely (so Gemini can't fill it in), the executor never calls the tool
without an authenticated `state.userId`, and always overwrites
`args.userId` from `state.userId` regardless of anything the LLM
produced — defense in depth, not just schema omission. If Gemini returns
more than one tool call in a turn, all are executed (nothing silently
dropped), but only the first result's mapping populates the state slot
`response_formatter` reads (matches the old "one thing per turn" behavior).

**To wire a new tool-backed capability**: add the tool to its domain's
`tools.ts` and a renderer to that domain's `presentation.ts`. That's it —
`travel-agent.ts` needs no edit at all.

This used to require touching `travel-agent.ts` in four places
(`TOOL_RESULT_MAP`, `USER_SCOPED_SIGNIN_MESSAGES`, the `formatToolData`
switch, and a new private `format*` method). All four are gone: results land
in one generic `toolData: {kind: <toolName>, data: payload}` slot, rendered
markdown arrives as `state.toolRendered`, and the sign-in message is a
`signInMessage` field on the tool itself. No `IntentSchema` enum or hardcoded
intent list to maintain either.
`book_hotel`/`book_flight` (see below) are a second example, after
`edit_timeline`, of a virtual action that skips this generic path entirely
in favor of its own dedicated conditional-edge branch and node sequence.

## Booking pipeline (`booking-pipeline.ts`)

Two virtual tools, bound alongside `plan_trip`/`edit_timeline` in
`buildToolSpecs()`: `book_hotel({destination, checkIn?, checkOut?, guests?,
confirmed?})` and `book_flight({origin, destination, departDate?,
returnDate?, guests?, confirmed?})`. A call to either routes the planner's
conditional edge straight to `booking_search`, bypassing `tool_executor`
entirely (same mechanism `edit_timeline` already uses).

The 4 nodes are plain exported functions (not `TravelAgent` methods) in
`booking-pipeline.ts`, so they don't need `.bind(this)` and can be
unit-tested by direct import:
- **`bookingSearchNode`** — reads the triggering call off `state.toolCalls`
  (same pattern `plan_trip` uses — no separate planner step). Both `hotel`
  and `flight` now call real tools (`search_hotels`/`search_flights` — see
  "External data sources" above) via `toolRegistry.executeTool`, mapping
  `NormalizedHotel[]`/`NormalizedFlight[]` into `BookingOption[]` (which
  gained an optional `price` field in Phase 5). The flight branch guards on
  missing `origin`/`departDate` before calling out, with a clean error
  instead of a bad request. The hotel branch threads the real `checkIn`/
  `checkOut` the tool actually used (it applies defaults server-side) back
  into `bookingRequest`, so downstream prompts show real dates.
- **`bookingPresentOptionsNode`** — sets `toolData: {kind:"booking_options", ...}`.
- **`bookingConfirmNode`** (the "await-confirmation" node) — three
  outcomes: not resolvable (no options found, for either type — as of
  Phase 5 this is no longer hardcoded to always be true for flights) →
  terminal `toolData: {kind:"booking_confirm_prompt", ...}` prompt, no
  pause; already `confirmed: true` in the *same* message that triggered the
  search (e.g. "book the first hotel in Lisbon right now, I confirm") →
  resolves immediately, no pause needed; otherwise (the normal two-step
  case) → calls `interrupt({kind, request, options})` to genuinely pause
  the graph and wait for the user's next message. See "Cross-turn
  confirmation" below for how that pause/resume actually works.
- **`bookingExecuteNode`** (Phase 6) — creates a real `Booking` via
  `bookingService.createBooking`, then immediately pays it via
  `bookingService.autoPayDummy` — an internally-synthesized, always-valid
  dummy card (never real user input, since chat can't collect card-shaped
  details the way a form can), routed through the exact same
  `submitPayment` path the REST `/api/bookings/:id/pay` route uses. Result
  is a real `bookingReference`/`transactionId`, no mock string. Guards on
  missing `state.userId` first (a `Booking` must belong to a real user,
  same fail-closed pattern as `agents/tools/account.ts`'s `userScoped`
  tools) — no booking attempted, no DB write, if the chat isn't
  authenticated. See "Booking service" below for the backend this calls
  into.

Formatters (`formatBookingOptions`/`formatBookingConfirmPrompt`/
`formatBookingResult`/`formatBookingDeclined`) live in `booking-pipeline.ts`
too, wired into `travel-agent.ts`'s `formatToolData` switch as one-line
delegates — same `toolData.kind` dispatch convention as every other
capability. Exception: the interrupt case itself has no `formatToolData`
entry — see below, `chat()` formats it directly from the interrupt payload
since `response_formatter` is never reached on a paused run.

## Booking service (`services/bookingService.ts`, models, routes — Phase 6)

The real backend behind both the chat path (`bookingExecuteNode`, above)
and a standalone REST API (`POST/GET /api/bookings`, `POST /:id/pay`,
`POST /:id/cancel`, mounted in `server.ts` alongside every other router,
same `savedTripController.js`/`savedTripRoutes.js` conventions — blanket
`auth` middleware, ownership via `{user: req.userId}` in every query).
Two models: `Booking` (a self-contained snapshot of the selected
`BookingOption`/`BookingRequest` — search results aren't persisted
anywhere else — plus `status: pending_payment|confirmed|cancelled|failed`,
`source: chat|web`) and `Transaction` (one or more payment *attempts* per
booking — `Transaction.booking` holds the FK, not the reverse, since a
booking can accumulate a declined attempt followed by a successful retry).
Human-readable IDs (`TT-XXXXXXXX` booking references, `TXN-XXXXXXXXXX`
transaction ids) come from `utils/idGenerator.ts` — no collision pre-check,
relies on the model's `unique` index + a retry-on-11000 loop in the
service layer.

`bookingService.validateCardFormat` is superficial format validation only
(digit-count, expiry-not-past, CVV shape) — never a real gateway call, and
never stores a full card number or CVV (only `{brand, last4}`, guessed/
sliced from the input) even though the whole system is fake. A
well-formed-but-declined card still creates a `failed` `Transaction` and
leaves `Booking.status` at `pending_payment` (retry-friendly, matches real
checkout UX) rather than a 400 — "full flow, not one-click fake" per the
roadmap's own constraint. `submitPayment` is idempotent (a repeat call on
an already-`confirmed` booking returns the existing `Transaction` instead
of creating a duplicate) and race-safe against a genuine concurrent
double-submit via an atomic `findOneAndUpdate` claim on a `paymentInFlight`
lock before any validation work runs. `autoPayDummy` (the chat path) is
just `submitPayment` called with an internally-synthesized always-valid
card — zero duplicated logic.

No real payment gateway integration exists or is planned to exist —
everything resolves synchronously and is entirely simulated, per the
roadmap's explicit no-real-gateway/no-real-charge constraint. The actual
frontend payment form that drives the REST routes' multi-step flow is
Phase 8's job; this phase is the backend it will call.

## Cross-turn confirmation (`interrupt`/`Command`/`MemorySaver`, Phase 4)

The first real use of LangGraph's pause/resume mechanism in this codebase.
`TravelAgent` holds a `private checkpointer: MemorySaver` (in-process;
known, accepted limitation: a server restart loses all pending
confirmations), passed to `workflow.compile({checkpointer})`. Every
`chat()` call now requires `{configurable: {thread_id}}` — LangGraph throws
if a checkpointer is configured and `configurable` is omitted — so `chat()`
always builds one, using `conversationId` when available (the natural
per-conversation thread) or a throwaway UUID otherwise (test scripts
without a `conversationId` simply can't resume across calls, which is
fine).

Flow: `chat()` calls `graph.getState(config)` and checks
`tasks.some(t => t.interrupts?.length > 0)` to see if this thread is
currently paused. If not, it runs a normal fresh `initialState` invoke, same
as before Phase 4. If so, it skips the RAG pipeline entirely (both resume
outcomes are deterministic `toolData` formatters that never read
`ragContext` — running RAG on every "yes"/"no" reply would waste an
embedding-API call) and instead calls
`graph.invoke(new Command({resume: userQuery}), config)`, which resumes
execution *inside* `bookingConfirmNode` at the exact point `interrupt()`
was called, with `userQuery` (the user's literal next message) as the
returned "decision" value — parsed by `interpretBookingDecision` (a small
keyword regex; anything that isn't a clear affirmative is treated as an
implicit decline, not left pending — confirmed as the intended UX, no
smarter disambiguation here, that's Phase 7's slot-filling scope).

If a run pauses (fresh or re-paused), `chat()` detects it via
`isInterrupted(result)` / `result[INTERRUPT][0].value` and builds the
response directly from that payload via `formatBookingConfirmPrompt` — it
never reads `result.response`, since `response_formatter` was never
reached that run.

`chat()`'s return value gained a `pendingBooking` field: `undefined` means
"not a booking turn, don't touch"; `null` means "just resolved, clear it";
an object means "just started, set it". `chatController.ts` syncs this
onto `Conversation.pendingBooking` (a `Mixed` field, sibling to
`itinerary`) using the existing assistant-message save — no new DB write.
This is a **durability/observability mirror, not the resume mechanism
itself** (the checkpointer is solely responsible for that) — it exists so
a pending booking is inspectable/persisted in Mongo, and so a stale mirror
left behind by a lost-to-restart interrupt doesn't silently linger forever
undetected. It does not feed back into the resume decision.

## Intent detection (`intent-detector.ts`) — degraded-path only

`IntentDetector.fallbackDetection` (now `public`) is the sole surviving use
of this module in the primary chat path: `plannerNode` calls it directly if
`toolCallingModel.invoke()` itself throws (quota/network), converting its
keyword-matched intent into an equivalent `toolCalls` array via
`legacyFallbackToToolCalls`. This is also where the old regex extraction
helpers (`extractDestination`/`extractDuration`/`extractCategory`, and the
4 distance-parsing patterns in `parseOriginDestination`) now live — demoted
from primary dispatch to fallback-only arg building. `detectIntent()` (the
prompt+regex-JSON path) and `IntentSchema` are no longer called from
`travel-agent.ts` but are left in place as harmless, no-longer-primary code.

## Agent state (`travel-agent.ts`, `AgentStateAnnotation`)

The graph's state type is `typeof AgentStateAnnotation.State`, defined inline
in `travel-agent.ts`. (`types.ts` used to carry a duplicate, dead `AgentState`
interface — deleted; that file is now just `AgentConfig`.)
- `userId` — threaded from `chat()`'s existing `userId` param (previously
  only used for RAG) into `initialState`, so tools can be user-scoped. Any
  `userScoped` tool in `toolExecutorNode` reads `state.userId` directly,
  never a user id the LLM produced — see "Dispatch" above.
- `toolCalls: Array<{name, args, id?}>` — the planner's selected action(s)
  (Phase 2), consumed by `toolExecutorNode`. Replaced the Phase-1
  `categories`/`entities` fields — everything that used to read
  `state.entities` now gets those values directly as structured
  `tool_calls[].args` from Gemini instead of via a side-channel.
- `intent?: string` — no longer drives dispatch. Kept only as a lightweight
  label written by `toolExecutorNode` so `responseFormatterNode`'s remaining
  `intent === 'edit_timeline'` check keeps working unmodified.
- `toolRendered?: string` — markdown the tool rendered for itself (see
  "Presentation is a TravelTea convention" above), read off `content[1]` of
  the MCP result. When set, `responseFormatterNode` returns it verbatim and
  does no per-tool dispatch at all. This is the slot that replaced the 12
  private `format*` methods.
- `toolData: { kind, data }` — the single generic result slot, where `kind`
  is now just **the tool's own name**. It replaced the per-tool
  `TOOL_RESULT_MAP` plus the `searchResults`/`nearbyAttractions`/
  `placeDetails` slots, all deleted. In practice only `web_search` reaches
  here from a tool (everything else renders itself); the booking pipeline
  writes its own `booking_*` kinds, which can't collide because no tool has
  those names — `chat()` still reads `toolData.kind === 'booking_result'` /
  `'booking_declined'` to build `pendingBooking`/`bookingResult`.

**When adding a state field, add it to the explicit reset block in `chat()`'s
`initialState` too.** Reducers are last-write-wins over a `MemorySaver`
checkpoint on a stable `thread_id`, so a field left out silently carries the
previous turn's value into the next one — the exact class of bug the
post-Phase-6 `??`-reducer fix addressed. `satisfies AgentState` will not catch
it, since these fields are optional.
- `bookingRequest`/`bookingOptions`/`selectedBookingOption`/
  `bookingConfirmed` — the booking pipeline's own state, written and read
  by the `booking_*` nodes only (see "Booking pipeline" above).
  `bookingConfirmed` also drives `booking_confirm`'s own conditional edge.
  Survives a cross-turn pause via the checkpointer (Phase 4) — restored
  automatically on resume, no extra wiring needed.

## LLM client (`../config/llm.ts`)

All Gemini chat-model construction goes through this module instead of each
file instantiating `ChatGoogleGenerativeAI` directly:

- `createChatModel(overrides?)` — resolves `GEMINI_API_KEY`/`GEMINI_MODEL`
  in one place; pass per-call `temperature`/`maxOutputTokens`/`streaming`.
- `createStructuredChatModel(zodSchema, overrides?)` — the convention for
  structured output, wrapping `createChatModel(...).withStructuredOutput(schema)`.

Manual regex/JSON parsing of raw LLM text (intent detector, timeline editor,
search-ranking helpers in `controllers/searchController.js` /
`controllers/exploreController.js`) is intentionally left as-is for now —
it's tied to the existing quota/parser graceful-degradation handling and is
addressed by later roadmap phases, not this baseline pass.

## Persistence & memory

- `Conversation` (Mongo) — chat history + metadata, loaded/saved per request
  in `controllers/chatController.ts`. `pendingBooking` (Phase 4) mirrors
  the graph checkpointer's pending-booking state for durability/display —
  see "Cross-turn confirmation" above.
- `vector/` — RAG layer: embeds queries (`services/embedding.ts`) and
  retrieves context injected into the system prompt via
  `VectorRetrievalService` / `PromptBuilder`. Skipped entirely on a
  cross-turn booking resume (Phase 4) since that path never reads it.
- `MemorySaver` (`travel-agent.ts`, Phase 4) — in-process LangGraph
  checkpointer keyed by `conversationId` as `thread_id`, enabling
  `bookingConfirmNode`'s `interrupt()` to genuinely pause and resume across
  chat turns. Lost on server restart — a documented, accepted limitation,
  not a bug.
