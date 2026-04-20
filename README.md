# 🌍 TravelTea

An advanced, AI-powered, multi-agent travel planner designed to help you generate, explore, edit, and perfect your itineraries. TravelTea transcends standard static itinerary generators by providing a dynamic **Conversational UI**, **Real-Time Data fetching**, and **Agentic AI architecture**.

---

## ✨ Key Features & Highlights

- 🤖 **Multi-Agent AI Architecture**: Powered by LangGraph and Google's Gemini. Distinct "nodes" handle planning, tool execution, timeline editing, and conversational formatting.
- 🔌 **Model Context Protocol (MCP)**: Utilizes MCP for executing tools like fetching places, hotels, attractions, or real-time weather dynamically.
- 💬 **Real-time Conversational UI**: Features a robust Socket.io integration. Talk naturally with the AI to refine your trips (e.g., *"Swap the Louvre with the Eiffel Tower"*).
- ✏️ **Dynamic Timeline Editor**: A deterministically parsed or LLM-driven timeline editor allowing for rich mutations (add, move, delete, swap, change time).
- 🗺️ **Interactive Maps**: Deep mapping integration via Leaflet and React Leaflet to beautifully visualize your route and destinations.
- 🔍 **RAG & Vector Search**: Implements Vector Retrieval and Embedding Services to seed and fetch knowledge seamlessly.
- 🎨 **Modern, Premium Design**: Built with React 19, Tailwind CSS v4, Shadcn UI, and Framer Motion for a stunning, responsive, and highly interactive user experience.

---

## 🏗️ Architecture & System Design

The backend operates on a state-machine architecture using **LangGraph**:

1. **Planner Node**: Acts as the orchestrator. It uses an LLM-based intent detector to analyze user queries, detect entities, and decide which actions/tools to trigger (e.g., `search_attractions`, `plan_trip`, `edit_timeline`).
2. **Tool Executor Node**: Connects to the **Tool Registry** and **MCP servers**. It handles API calls to external services like OpenTripMap, SerpAPI, and Google Maps.
3. **Timeline Editor Node**: Listens for itinerary mutations. It can deterministically parse simple commands or fallback to Gemini to process complex edits and output pure JSON mutations.
4. **Response Formatter Node**: Consolidates tool outputs, RAG contexts, and errors, wrapping them in a conversational and formatted response for the user interface.

---

## 🛠️ Tech Stack Deep Dive

### Frontend (Client)
| Technology | Description |
|---|---|
| **React 19 & Vite** | Core UI framework and blazing-fast build tool. |
| **Tailwind CSS v4** | Utility-first CSS framework for rapid styling. |
| **Shadcn UI & Radix** | Unstyled, accessible component primitives. |
| **Framer Motion** | Powerful declarative animations. |
| **Socket.io-client** | Real-time bidirectional event-based communication. |
| **Leaflet & React Leaflet**| Interactive maps and routing visuals. |

### Backend (Server)
| Technology | Description |
|---|---|
| **Node.js & Express** | Server runtime and web framework. |
| **TypeScript** | Strongly typed JavaScript for safer code. |
| **LangChain & LangGraph** | Framework for developing applications powered by LLMs. |
| **Google GenAI (Gemini)** | Core LLM driving intent detection and conversational responses. |
| **MCP SDK** | Standardized integration for context and tool passing. |
| **MongoDB & Mongoose** | NoSQL Database for user and trip persistence. |
| **Redis (ioredis)** | In-memory data store for caching and pub/sub. |
| **Socket.io** | WebSockets for live chat features. |

---

## 📁 Project Structure

```text
traveltea/
├── backend/                  
│   ├── src/
│   │   ├── agents/           # LangGraph setup: state definitions, intent detectors, nodes
│   │   ├── config/           # Database and environment configurations
│   │   ├── controllers/      # Express route controllers & Socket.io handlers
│   │   ├── mcp-servers/      # Model Context Protocol definitions (e.g., Places API)
│   │   ├── middleware/       # JWT Auth, error handling
│   │   ├── models/           # Mongoose schemas (User, Trip, etc.)
│   │   ├── routes/           # REST endpoints
│   │   ├── services/         # Itinerary builders, Vector Retrieval, Embeddings
│   │   ├── vector/           # RAG implementations and seed scripts
│   │   └── server.ts         # Server entry point
│   └── package.json
│
└── frontend/                 
    ├── src/
    │   ├── assets/           # Static assets, fonts, global styles
    │   ├── components/       # Reusable React components (Shadcn UI)
    │   ├── contexts/         # React context providers (Auth, Theme, etc.)
    │   ├── hooks/            # Custom React hooks
    │   ├── lib/              # Utility functions (Tailwind merge, formatting)
    │   ├── pages/            # View components (Home, Dashboard, Chat)
    │   └── services/         # API & Socket clients
    ├── package.json
    └── vite.config.js
```

---

## 📡 Core API Routes

### Authentication
- `POST /api/auth/register` - Register a new user.
- `POST /api/auth/login` - Authenticate and receive JWT.

### Itinerary Generation
- `POST /api/itinerary/generate` - Generate AI itinerary from structured trip data.
- `POST /api/itinerary/refine` - Refine an existing itinerary based on user feedback.

### Travel Data & Trips
- `GET /api/travel-data/timeline` - Get aggregated timeline data (Weather, Events, Hotels).
- `GET /api/travel-data/restaurants` - Get lazily loaded restaurants per day.
- `GET /api/trips` & `GET /api/saved-trips` - Manage saved itineraries.

### Chat & WebSockets
- `GET /api/chat/history/:conversationId` - Retrieve past chat context.
- **Socket Events**: `join:conversation`, `leave:conversation` manage real-time updates for collaborative itinerary editing.

---

## 🚀 Local Development Setup

### 1. Prerequisites
- **Node.js** (v18 or higher)
- **MongoDB** (Local instance or MongoDB Atlas cluster)
- **Redis** (Local instance for caching/sessions)
- **API Keys**: 
  - [Google Gemini](https://aistudio.google.com/)
  - [OpenTripMap](https://opentripmap.io/) (Optional, but recommended)
  - [SerpAPI](https://serpapi.com/) (Optional, for real-time web context)

### 2. Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file in `backend/`:

```env
# Server
PORT=5000
FRONTEND_URL=http://localhost:5173

# Database & Caching
MONGODB_URI=mongodb://localhost:27017/traveltea
REDIS_URL=redis://localhost:6379

# Security
JWT_SECRET=your_super_secret_jwt_key

# AI & APIs
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.1-flash-lite
OPENTRIPMAP_API_KEY=your_opentripmap_api_key
SERPAPI_API_KEY=your_serpapi_key
```

Run the backend server in development mode:
```bash
npm run dev
# Note: You can also test the agents via CLI using `npm run travel:agent`
```

### 3. Frontend Setup

```bash
cd ../frontend
npm install
```

Create a `.env` file in `frontend/`:

```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

Start the frontend development server:
```bash
npm run dev
```

Visit `http://localhost:5173` to experience TravelTea!

---

## 🧪 Testing & Utilities

The backend contains several utility scripts for development:
- `npm run test` - Run Vitest test suites.
- `npm run lint` - Run ESLint over the TypeScript codebase.
- `npm run mcp:places` - Manually test the Places MCP server.
- `npm run travel:agent` - Run an interactive CLI test of the LangGraph agent.
- `npm run vector:seed` - Seed the vector database with initial travel knowledge.

---

## 📄 License

This project is licensed under the MIT License.
