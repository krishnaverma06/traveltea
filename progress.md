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
