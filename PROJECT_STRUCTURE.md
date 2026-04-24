# TravelTea — Project Structure & Dependencies

_Snapshot generated 2026-08-12 on branch `phase-3-booking-pipeline`._

TravelTea is an AI-powered travel planner: a React frontend + an Express/TypeScript
backend that runs a LangGraph tool-calling agent (Gemini) backed by MCP-style tool
servers for places, transport, flights, hotels, events and web search, plus a
MongoDB-based vector/RAG knowledge layer and a booking pipeline.

```
traveltea/
├── README.md
├── PROJECT_FLOW_EXPLAINED.html
├── progress.md                      # append-only log of completed roadmap phases
├── tasks.md
├── .gitignore
│
├── backend/                         # Express + TypeScript API server
│   ├── .env                         # local secrets (not committed)
│   ├── .gitignore
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── eslint.config.js
│   ├── test-agent.ts                # ad-hoc agent test script
│   ├── dist/                        # tsc build output (mirrors src/, gitignored)
│   │
│   └── src/
│       ├── server.ts                 # app entrypoint (Express + Socket.IO bootstrap)
│       │
│       ├── agents/                   # LangGraph travel agent
│       │   ├── README.md
│       │   ├── travel-agent.ts       # LangGraph graph definition / agent loop
│       │   ├── booking-pipeline.ts   # multi-step booking flow orchestration
│       │   ├── intent-detector.ts    # legacy intent classification
│       │   ├── prompts.ts            # system/tool prompts
│       │   ├── tool-registry.ts      # registers MCP tools for the agent
│       │   ├── test-agents.ts
│       │   ├── types.ts
│       │   └── tools/
│       │       └── account.ts
│       │
│       ├── config/
│       │   ├── configenv.js
│       │   ├── database.ts           # MongoDB/mongoose connection
│       │   ├── llm.ts                # Gemini/LangChain model config
│       │   └── opentripmap-categories.ts
│       │
│       ├── controllers/
│       │   ├── authcontroller.js
│       │   ├── bookingController.ts
│       │   ├── chatController.ts
│       │   ├── exploreController.js
│       │   ├── savedTripController.js
│       │   ├── searchController.js
│       │   ├── travelDataController.ts
│       │   └── tripController.js
│       │
│       ├── mcp-servers/              # MCP-style tool servers consumed by the agent
│       │   ├── events/
│       │   │   └── tools.ts
│       │   ├── flights/
│       │   │   ├── api.ts
│       │   │   └── tools.ts
│       │   ├── hotels/
│       │   │   ├── api.ts
│       │   │   └── tools.ts
│       │   ├── places/
│       │   │   ├── api.ts
│       │   │   ├── server.ts
│       │   │   ├── test-manual.ts
│       │   │   ├── tools.ts
│       │   │   └── types.ts
│       │   ├── transport/
│       │   │   ├── api.ts
│       │   │   └── tools.ts
│       │   └── websearch/
│       │       ├── api.ts
│       │       └── tools.ts
│       │
│       ├── middleware/
│       │   └── auth.js
│       │
│       ├── models/                   # Mongoose schemas
│       │   ├── Booking.ts
│       │   ├── Conversation.ts
│       │   ├── SavedTrip.js
│       │   ├── Transaction.ts
│       │   ├── travelData.ts
│       │   ├── Trip.js
│       │   └── User.js
│       │
│       ├── routes/
│       │   ├── authRoutes.js
│       │   ├── bookingRoutes.ts
│       │   ├── chat.ts
│       │   ├── exploreRoutes.js
│       │   ├── itinerary.ts
│       │   ├── savedTripRoutes.js
│       │   ├── searchRoutes.js
│       │   ├── travelDataRoutes.ts
│       │   └── tripRoutes.js
│       │
│       ├── scripts/                  # one-off/maintenance scripts (run via tsx)
│       │   ├── backfill-embeddings.ts
│       │   ├── check-users.ts
│       │   ├── list-models.ts
│       │   ├── test-chat.ts
│       │   └── test-save.ts
│       │
│       ├── services/
│       │   ├── amadeusService.ts
│       │   ├── bookingService.ts
│       │   ├── embedding.ts
│       │   ├── enhancedItineraryBuilder.ts
│       │   ├── geminiWebSearch.ts
│       │   ├── googlePlacesAPI.ts
│       │   ├── itineraryBuilder.ts
│       │   ├── ticketmasterService.ts
│       │   ├── timelineMutationEngine.ts
│       │   └── weatherService.ts
│       │
│       ├── types/
│       │   ├── express.d.ts
│       │   ├── itinerary.ts
│       │   └── tripContext.ts
│       │
│       ├── utils/
│       │   ├── cache.ts
│       │   ├── deterministicParser.ts
│       │   ├── idGenerator.ts
│       │   └── logger.ts
│       │
│       └── vector/                   # RAG / knowledge-base layer
│           ├── index.ts
│           ├── ingestion/
│           │   ├── ingestion.pipeline.ts
│           │   └── parsers/
│           │       ├── csv.parser.ts
│           │       ├── json.parser.ts
│           │       └── markdown.parser.ts
│           ├── models/
│           │   └── VectorDocument.ts
│           ├── repositories/
│           │   └── vector.repository.ts
│           ├── scripts/
│           │   └── seed-knowledge.ts
│           ├── seed-data/
│           │   ├── goa.json
│           │   ├── jaipur.json
│           │   └── manali.json
│           ├── services/
│           │   ├── hybrid-retrieval.service.ts
│           │   ├── reranker.service.ts
│           │   ├── search-knowledge.service.ts
│           │   ├── text-search.service.ts
│           │   ├── trip-knowledge.service.ts
│           │   ├── user-profile.service.ts
│           │   ├── vector-embedding.service.ts
│           │   └── vector-retrieval.service.ts
│           ├── types/
│           │   ├── hybrid-search.constants.ts
│           │   ├── hybrid-search.types.ts
│           │   ├── reranker.constants.ts
│           │   ├── reranker.types.ts
│           │   ├── vector.constants.ts
│           │   └── vector.types.ts
│           ├── utils/
│           │   ├── content.utils.ts
│           │   ├── metadata.utils.ts
│           │   └── prompt-builder.ts
│           └── validators/
│               └── vector.validators.ts
│
└── frontend/                        # React (Vite) single-page app
    ├── .env                         # local env vars (not committed)
    ├── .gitignore
    ├── index.html
    ├── package.json
    ├── package-lock.json
    ├── components.json              # shadcn/ui config
    ├── jsconfig.json
    ├── vite.config.js
    ├── eslint.config.js
    ├── README.md
    ├── dist/                        # vite build output (gitignored)
    ├── public/                      # static images served as-is
    │   └── *.jpg
    │
    └── src/
        ├── main.jsx                 # React root / router mount
        ├── App.jsx
        ├── App.css
        ├── index.css
        ├── assets/
        │   └── react.svg
        │
        ├── components/
        │   ├── ChatDrawer.jsx
        │   ├── FloatingAssistant.jsx
        │   ├── ItineraryOverlay.jsx
        │   ├── Map.jsx
        │   ├── Navbar.jsx
        │   ├── TripCard.jsx
        │   ├── TripPlanningSidebar.jsx
        │   ├── Chat/
        │   │   ├── BookingOptionsCard.jsx
        │   │   ├── BookingReceipt.jsx
        │   │   ├── MessageBubble.jsx
        │   │   ├── MessageInput.jsx
        │   │   └── TypingIndicator.jsx
        │   ├── Timeline/
        │   │   ├── SkeletonLoaders.jsx
        │   │   ├── TimelineDay.jsx
        │   │   ├── TimelineSections.jsx
        │   │   └── TimelineTab.jsx
        │   └── ui/                  # shadcn/radix primitives
        │       ├── button.jsx
        │       ├── card.jsx
        │       ├── input.jsx
        │       ├── slider.jsx
        │       ├── switch.jsx
        │       └── textarea.jsx
        │
        ├── contexts/
        │   ├── AuthContext.jsx
        │   └── TripContext.jsx
        │
        ├── hooks/
        │   └── useSocket.js
        │
        ├── lib/
        │   ├── api.js                # axios instance / API client
        │   └── utils.js
        │
        ├── pages/
        │   ├── BudgetPage.jsx
        │   ├── Chat.jsx
        │   ├── ExplorePage.jsx
        │   ├── Home.jsx
        │   ├── ItinearyPage.jsx
        │   ├── LandingPage.jsx
        │   ├── LoginPage.jsx
        │   ├── OnboardingPage.jsx
        │   ├── PreferencesPage.jsx
        │   ├── ProfilePage.jsx
        │   ├── ResultsPage.jsx
        │   ├── SavedTripsPage.jsx
        │   ├── SignupPage.jsx
        │   ├── TripDetailsPage.jsx
        │   ├── TripPlannerPage.jsx
        │   ├── TripsPage.jsx
        │   └── UpcomingTripsPage.jsx
        │
        ├── services/
        │   └── TravelDataService.js
        │
        └── types/
            └── itinerary.js
```

## Backend — `backend/package.json`

Runtime: Node.js, ESM (`"type": "module"`), TypeScript, run via `tsx`.

### Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@langchain/core` | ^1.2.2 | LangChain core primitives (messages, runnables) |
| `@langchain/google-genai` | ^2.2.0 | Gemini model integration for LangChain |
| `@langchain/langgraph` | ^1.4.7 | Graph-based agent orchestration (the travel agent) |
| `@modelcontextprotocol/sdk` | ^1.0.4 | MCP (Model Context Protocol) server/client SDK |
| `axios` | ^1.7.0 | HTTP client for external APIs |
| `bcrypt` | ^6.0.0 | Password hashing (native) |
| `bcryptjs` | ^3.0.3 | Password hashing (pure JS fallback) |
| `cors` | ^2.8.5 | CORS middleware |
| `csv-parse` | ^5.6.0 | CSV parsing (vector ingestion) |
| `dotenv` | ^16.4.0 | Environment variable loading |
| `express` | ^4.19.0 | HTTP server framework |
| `ioredis` | ^5.4.0 | Redis client (caching) |
| `jsonwebtoken` | ^9.0.3 | JWT auth |
| `mongodb` | ^7.4.0 | MongoDB driver |
| `mongoose` | ^8.7.0 | MongoDB ODM |
| `serpapi` | ^2.2.1 | SerpApi search results client |
| `socket.io` | ^4.8.0 | Real-time chat transport |
| `uuid` | ^14.0.1 | ID generation |
| `zod` | ^3.23.0 | Schema validation (tool argument schemas) |

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@types/cors` | ^2.8.17 | Type defs |
| `@types/express` | ^4.17.21 | Type defs |
| `@types/node` | ^22.20.0 | Type defs |
| `@types/uuid` | ^10.0.0 | Type defs |
| `@typescript-eslint/eslint-plugin` | ^8.0.0 | Lint rules for TS |
| `@typescript-eslint/parser` | ^8.0.0 | TS parser for ESLint |
| `eslint` | ^9.0.0 | Linting |
| `tsx` | ^4.19.0 | TS execution (dev server, scripts) |
| `typescript` | ^5.6.0 | TS compiler |
| `vitest` | ^2.0.0 | Test runner |

## Frontend — `frontend/package.json`

Runtime: React 19 SPA built with Vite.

### Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@fontsource-variable/noto-sans` | ^5.2.10 | Self-hosted variable font |
| `@fontsource-variable/playfair-display` | ^5.2.8 | Self-hosted variable font |
| `@radix-ui/react-slot` | ^1.2.3 | Radix primitive used by shadcn/ui components |
| `@tailwindcss/vite` | ^4.3.2 | Tailwind CSS v4 Vite plugin |
| `axios` | ^1.18.1 | HTTP client |
| `class-variance-authority` | ^0.7.1 | Variant-based className composition (shadcn/ui) |
| `clsx` | ^2.1.1 | Conditional className utility |
| `date-fns` | ^4.1.0 | Date utilities |
| `framer-motion` | ^12.42.2 | Animations |
| `leaflet` | ^1.9.4 | Map rendering engine |
| `lucide-react` | ^0.544.0 | Icon set |
| `radix-ui` | ^1.6.1 | Unstyled UI primitives |
| `react` | ^19.1.1 | UI library |
| `react-dom` | ^19.1.1 | React DOM renderer |
| `react-leaflet` | ^5.0.0 | React bindings for Leaflet maps |
| `react-markdown` | ^10.1.0 | Renders markdown chat responses |
| `react-router-dom` | ^7.9.3 | Client-side routing |
| `react-toastify` | ^11.1.0 | Toast notifications |
| `remark-breaks` | ^4.0.0 | Markdown line-break plugin |
| `shadcn` | ^4.13.0 | shadcn/ui CLI/registry |
| `socket.io-client` | ^4.8.3 | Real-time chat transport (client) |
| `tailwind-merge` | ^3.3.1 | Merge conflicting Tailwind classes |
| `tailwind-variants` | ^3.1.1 | Variant styling for Tailwind |

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@eslint/js` | ^9.36.0 | ESLint base config |
| `@types/react` | ^19.1.13 | Type defs |
| `@types/react-dom` | ^19.1.9 | Type defs |
| `@vitejs/plugin-react` | ^5.0.3 | Vite React plugin (Fast Refresh) |
| `autoprefixer` | ^10.4.21 | CSS vendor prefixing |
| `eslint` | ^9.36.0 | Linting |
| `eslint-plugin-react-hooks` | ^5.2.0 | React hooks lint rules |
| `eslint-plugin-react-refresh` | ^0.4.20 | Fast Refresh lint rules |
| `globals` | ^16.4.0 | Global identifiers for ESLint |
| `postcss` | ^8.5.6 | CSS processing |
| `tailwindcss` | ^4.3.2 | Utility-first CSS framework |
| `tw-animate-css` | ^1.4.0 | Tailwind animation utilities |
| `vite` | ^7.1.7 | Build tool / dev server |

## Notes

- `backend/dist/` and `frontend/dist/` are compiled/build output (mirrors `src/`) and are gitignored — not hand-maintained.
- The backend mixes `.js` (legacy, pre-agent-roadmap) and `.ts` (current) files in `controllers/`, `routes/`, and `models/` — this is in-progress migration, not duplication.
- External APIs integrated via `services/` and `mcp-servers/`: Google Gemini (LLM + web search), Google Places, OpenTripMap, SerpApi, Ticketmaster, Amadeus (flights, legacy), Redis (cache), MongoDB (primary datastore + vector search).
    