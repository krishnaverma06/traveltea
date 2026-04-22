# Agent architecture (baseline)

Snapshot of how the AI agent is wired, as a starting point for the phased
AI-travel-agent roadmap. Update this when the shape of the graph, tools, or
LLM client conventions change.

## LangGraph workflow (`travel-agent.ts`)

`TravelAgent` builds a `StateGraph` (`@langchain/langgraph`) with these nodes:

```
__start__ → planner → tool_executor  → response_formatter
                     → timeline_editor →
```

- **planner** — uses native Gemini tool-calling (`bindTools`) to decide
  which tool(s), if any, the query needs; see "Dispatch" below.
- **tool_executor** — calls tools via `toolRegistry` (see below).
- **timeline_editor** — handles itinerary/timeline edit commands; tries
  `DeterministicCommandParser` (regex-based) before falling back to Gemini.
- **response_formatter** — produces the final conversational reply.

## Tool layer (`tool-registry.ts`)

`ToolRegistry` registers tools (`name`, `description`, `inputSchema` — a real
Zod schema, `execute`, optional `userScoped: true`) from two kinds of
sources:
- External-API-wrapper tools, one folder per domain under
  `../mcp-servers/{places,transport,websearch,events}/tools.ts`.
- Internal DB-backed tools that aren't MCP-shaped, under `./tools/` (e.g.
  `./tools/account.ts` — saved trips & travel preferences, calling
  `SavedTrip`/`User` Mongoose models directly, no separate service layer).
  The 4 account tools are `userScoped: true` — see "Dispatch" below for what
  that guarantees.

Call tools via `toolRegistry.executeTool(name, args)`. Validation is
**enforcing** (as of Phase 2): `executeTool` runs `inputSchema.safeParse(args)`
and returns an MCP-shaped `{content, isError: true}` on mismatch instead of
calling `execute()`. This is safe now because args only ever come from
Gemini's structured `tool_calls` (schema-bound at bind time) or the
degraded-path fallback mapper (built against the same schemas) — no more
free-text regex guesses reaching `execute()` directly.

15 tools registered as of Phase 1: the original 10 (places/transport/websearch)
plus `search_events`, `list_saved_trips`, `get_upcoming_trip`,
`get_travel_preferences`, `update_travel_preferences`. As of Phase 2, all 15
are reachable via native tool-calling (previously `get_directions`,
`estimate_route`, and `search_travel_tips` were registered but never wired
to any intent in the old switch).

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

**To wire a new tool-backed capability**: (1) register the tool with
`toolRegistry` (or add a virtual-action case in `toolExecutorNode` +
`buildToolSpecs` if it isn't a real tool), (2) add a `TOOL_RESULT_MAP` entry
in `travel-agent.ts` (+ a `formatToolData` case if it's a new `toolData.kind`).
No `IntentSchema` enum or hardcoded intent list to maintain anymore.

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

Note: the `AgentState` interface in `types.ts` is dead code, unused by the
graph — the graph's real state type is `typeof AgentStateAnnotation.State`,
defined inline in `travel-agent.ts`.
- `userId` — threaded from `chat()`'s existing `userId` param (previously
  only used for RAG) into `initialState`, so tools can be user-scoped. Any
  `userScoped` tool in `toolExecutorNode` reads `state.userId` directly,
  never a user id the LLM produced — see "Dispatch" above.
- `toolCalls: Array<{name, args, id?}>` — the planner's selected action(s)
  (Phase 2), consumed by `toolExecutorNode`. Replaced the Phase-1
  `categories`/`entities` fields — everything that used to read
  `state.entities` now gets those values directly as structured
  `tool_calls[].args` from Gemini instead of via a side-channel.
- `intent?: string` — no longer drives dispatch (that's `toolCalls` +
  `TOOL_RESULT_MAP` now). Kept only as a lightweight label written by
  `toolExecutorNode` so `responseFormatterNode`'s few `intent === '...'`
  checks (`edit_timeline`, `calculate_distance`, `web_search`) keep working
  unmodified.
- `toolData: { kind, data }` — a generic result slot for tool-backed
  capabilities that don't fit `searchResults`/`nearbyAttractions`/
  `placeDetails` (`search_events`, the 4 account tools, and — new in Phase 2
  — `get_directions`/`estimate_route`/`search_travel_tips`).
  `responseFormatterNode` dispatches on `toolData.kind` to a matching
  `format*` helper (deterministic markdown, no LLM call). Don't reuse
  `searchResults`/`placeDetails` for new tool kinds — both are shape-locked
  to their existing formatters.

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
  in `controllers/chatController.ts`.
- `vector/` — RAG layer: embeds queries (`services/embedding.ts`) and
  retrieves context injected into the system prompt via
  `VectorRetrievalService` / `PromptBuilder`.
