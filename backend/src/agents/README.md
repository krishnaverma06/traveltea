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

- **planner** — calls `intentDetector` to classify the query and decide
  which path to take.
- **tool_executor** — calls tools via `toolRegistry` (see below).
- **timeline_editor** — handles itinerary/timeline edit commands; tries
  `DeterministicCommandParser` (regex-based) before falling back to Gemini.
- **response_formatter** — produces the final conversational reply.

## Tool layer (`tool-registry.ts`)

`ToolRegistry` registers tools (`name`, `description`, `inputSchema`,
`execute`) backed by the MCP servers under `../mcp-servers/{places,transport,websearch}`.
Call tools via `toolRegistry.executeTool(name, args)`.

## Intent detection (`intent-detector.ts`)

`IntentDetector` is prompt + Zod schema (`IntentSchema`) + regex JSON
extraction from the raw LLM response — not native function-calling. Falls
back to a keyword-based `fallbackDetection` if LLM parsing throws.

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
