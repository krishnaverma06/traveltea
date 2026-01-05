# 🌍 TravelTea Backend — Multi-Agent Travel Planner

A production-grade **MERN** backend using a **"Ringmaster Round Table"** multi-agent architecture where specialised agents collaborate to produce complete travel plans.

---

## 🏗️ Architecture Overview

```
HTTP Request
     │
     ▼
┌─────────────────────────────────────────────┐
│           Express App (app.js)              │
│  Middleware: helmet, cors, morgan, json      │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│            Routes + Validation              │
│  /api/trip/plan  │  /api/trip/compare       │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│         Controllers (thin layer)            │
│  trip.controller.js │ auth.controller.js    │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│        🎪 GrandOrchestrator (Ringmaster)    │
│  Runs all agents in parallel via            │
│  Promise.allSettled                         │
└──┬───────┬──────────┬─────────┬─────────────┘
   │       │          │         │
   ▼       ▼          ▼         ▼
🌤️ Sky  🗺️ Trail  🎭 Scout  💰 Quarter-
  Gazer   blazer           master
(Weather) (Maps)  (Events) (Budget)
   │       │          │         │
   └───────┴──────────┴────┬────┘
                            │
                            ▼
                    📅 ItineraryEngine
                    (Day-wise plan builder)
                            │
                            ▼
                    ┌───────────────┐
                    │   MongoDB     │
                    │  (Trip saved) │
                    └───────────────┘
```

---

## 📁 Project Structure

```
traveltea-backend/
├── server.js                   # Entry point — boots server after DB connect
├── package.json
├── .env.example                # Template for environment variables
├── .gitignore
└── src/
    ├── app.js                  # Express setup, middleware, route wiring
    ├── api/
    │   ├── controllers/
    │   │   ├── trip.controller.js     # planTrip, compareTrips, getMyTrips…
    │   │   └── auth.controller.js     # register, login, getMe
    │   ├── routes/
    │   │   ├── trip.routes.js         # /api/trip/*
    │   │   └── user.routes.js         # /api/auth/*
    │   └── middleware/
    │       ├── auth.middleware.js      # JWT protect + restrictTo
    │       └── validate.middleware.js  # express-validator rule sets
    ├── agents/                 # Independent expert agents
    │   ├── WeatherAgent.js     # 🌤️  Sky Gazer
    │   ├── MapsAgent.js        # 🗺️  Trailblazer
    │   ├── EventsAgent.js      # 🎭  Local Scout
    │   └── BudgetAgent.js      # 💰  Quartermaster
    ├── orchestrators/          # Coordination layer
    │   ├── GrandOrchestrator.js  # Runs all agents, merges outputs
    │   ├── ItineraryEngine.js    # Builds day-wise plan
    │   └── ComparisonEngine.js   # Compares two destinations
    ├── models/
    │   ├── Trip.js             # Mongoose trip schema
    │   └── User.js             # Mongoose user schema (bcrypt hashing)
    ├── services/               # Third-party API wrappers
    │   ├── openWeather.js      # OpenWeatherMap API + in-memory cache
    │   ├── googleMaps.js       # Google Maps Distance Matrix API
    │   └── googleCalendar.js   # Events discovery (mock + extensible)
    ├── config/
    │   └── db.js               # Mongoose connection
    └── utils/
        ├── logger.js           # Winston logger (console + file)
        ├── errorHandler.js     # Global error handler + createError
        └── itineraryHelper.js  # Date utilities, slot helpers
```

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd traveltea-backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values:
#   MONGO_URI=mongodb://localhost:27017/traveltea
#   JWT_SECRET=<strong-random-string>
#   OPENWEATHER_API_KEY=<your-key>   (optional — mock fallback included)
#   GOOGLE_MAPS_API_KEY=<your-key>   (optional — mock fallback included)
```

### 3. Run the Server

```bash
# Development (auto-restart with nodemon)
npm run dev

# Production
npm start
```

Server starts at **http://localhost:5000**

Health check: `GET http://localhost:5000/health`

---

## 📡 API Reference

### `POST /api/trip/plan`

Plan a complete trip using all agents.

**Request:**
```json
{
  "destination": "Goa",
  "startDate": "2026-05-01",
  "endDate": "2026-05-05",
  "budget": 20000,
  "origin": "Delhi"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Trip to Goa planned successfully!",
  "tripId": "6627e3f0a1b2c3d4e5f60001",
  "data": {
    "destination": "Goa",
    "startDate": "2026-05-01",
    "endDate": "2026-05-05",
    "budget": 20000,
    "weather": {
      "temperature": 28,
      "feelsLike": 32,
      "humidity": 75,
      "condition": "Partly Cloudy",
      "description": "partially cloudy skies with light breeze",
      "windSpeed": 4.5,
      "source": "openweather"
    },
    "route": {
      "origin": "Delhi",
      "destination": "Goa",
      "distanceKm": 1900,
      "durationHours": 3.5,
      "mode": "flight",
      "source": "mock"
    },
    "events": [
      {
        "name": "Sunburn Festival",
        "category": "music",
        "ticketPrice": 2500,
        "venue": "Vagator Beach",
        "date": "2026-05-01",
        "description": "Experience the best of Goa with: Sunburn Festival"
      }
    ],
    "budgetBreakdown": {
      "travel": 7600,
      "accommodation": 8000,
      "food": 4000,
      "events": 3800,
      "miscellaneous": 3510,
      "total": 26910,
      "currency": "INR",
      "withinBudget": false,
      "surplus": -6910,
      "nights": 4,
      "days": 5
    },
    "itinerary": [
      {
        "day": 1,
        "date": "2026-05-01",
        "dateFormatted": "Friday, 1 May 2026",
        "theme": "Arrival & First Impressions",
        "activities": [
          {
            "time": "07:00 AM",
            "label": "Morning",
            "activity": "Check in & freshen up — begin your Goa adventure!",
            "tip": null
          },
          {
            "time": "10:00 AM",
            "label": "Late Morning",
            "activity": "Visit Basilica of Bom Jesus",
            "tip": "🎟️  Don't miss: Sunburn Festival at Vagator Beach (₹2500)"
          }
        ],
        "meals": {
          "breakfast": "Poi bread with butter at a local bakery",
          "lunch": "Fish curry rice at Fisherman's Wharf",
          "dinner": "Grilled lobster at Thalassa"
        },
        "estimatedDailySpend": 980
      }
    ],
    "tripSummary": {
      "totalDays": 5,
      "highlights": [
        "5-day trip to Goa",
        "Expect Partly Cloudy weather (~28°C)",
        "Budget slightly tight — estimated ₹26,910"
      ],
      "travelTip": "Book beach-facing accommodations early for the May season. Rent a scooter to explore freely."
    },
    "meta": {
      "planGeneratedAt": "2026-04-16T10:30:00.000Z",
      "processingTimeMs": 312
    }
  }
}
```

---

### `POST /api/trip/compare`

Compare two destinations side-by-side.

**Request:**
```json
{
  "destinationA": "Goa",
  "destinationB": "Manali",
  "startDate": "2026-05-01",
  "endDate": "2026-05-05",
  "budget": 20000
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "destinationA": "Goa",
    "destinationB": "Manali",
    "comparison": {
      "weather": {
        "Goa": { "temperature": 28, "condition": "Partly Cloudy" },
        "Manali": { "temperature": 12, "condition": "Clear" },
        "betterFor": "Manali"
      },
      "cost": {
        "Goa": { "total": 26910, "withinBudget": false },
        "Manali": { "total": 18200, "withinBudget": true },
        "cheaperOption": "Manali"
      },
      "travel": {
        "Goa": { "distanceKm": 1900, "durationHours": 3.5, "mode": "flight" },
        "Manali": { "distanceKm": 536, "durationHours": 13, "mode": "driving" },
        "closer": "Manali"
      },
      "events": {
        "Goa": 5,
        "Manali": 5,
        "moreActivities": "Goa"
      }
    },
    "winner": {
      "destination": "Manali",
      "score": 6,
      "reasons": ["Fits within your budget", "Closer to your origin", "Ideal weather conditions"],
      "recommendation": "We recommend Manali for this trip."
    }
  }
}
```

---

### `POST /api/auth/register`

```json
{
  "name": "Arjun Sharma",
  "email": "arjun@example.com",
  "password": "secret123"
}
```

### `POST /api/auth/login`

```json
{
  "email": "arjun@example.com",
  "password": "secret123"
}
```

Returns `{ token: "eyJ..." }` — include in subsequent requests as:
```
Authorization: Bearer eyJ...
```

### `GET /api/auth/me` *(Protected)*

Returns the logged-in user's profile.

### `GET /api/trip/user/my-trips` *(Protected)*

Returns all trips planned by the logged-in user.

### `GET /api/trip/:id`

Returns a single saved trip by MongoDB ID.

### `DELETE /api/trip/:id` *(Protected)*

Deletes a trip. Only the trip creator can delete it.

---

## 🔑 Key Design Decisions

| Pattern | Where Used | Why |
|---------|------------|-----|
| **Promise.allSettled** | GrandOrchestrator | One agent failing won't crash the whole plan |
| **Mock fallbacks** | Every agent | Zero external APIs needed to run locally |
| **In-memory cache** | OpenWeather service | Avoids redundant API calls for same city |
| **select: false** | User.password | Password never leaks in query results |
| **Thin controllers** | All controllers | Business logic stays in agents/orchestrators |
| **createError()** | Error handling | Consistent error objects with HTTP status codes |

---

## 🌐 Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 5000) |
| `MONGO_URI` | **Yes** | MongoDB connection string |
| `JWT_SECRET` | **Yes** | Secret for signing JWT tokens |
| `JWT_EXPIRES_IN` | No | Token expiry (default: `7d`) |
| `OPENWEATHER_API_KEY` | No | Real weather data (mock if absent) |
| `GOOGLE_MAPS_API_KEY` | No | Real route data (mock if absent) |
| `DEFAULT_ORIGIN` | No | Default departure city (default: `Delhi`) |
| `LOG_LEVEL` | No | Winston log level (default: `info`) |

---

## 🛠️ Extending the System

**Add a new agent:**
1. Create `src/agents/YourAgent.js` with an exported `run({ ...params })` function
2. Import and call it in `GrandOrchestrator.js` inside `Promise.allSettled`
3. Merge its output into the final plan object

**Add real event APIs:**
- Replace the mock logic in `src/services/googleCalendar.js` with Eventbrite, Google Events, or Ticketmaster API calls

**Add caching to more services:**
- Copy the in-memory cache pattern from `src/services/openWeather.js`
- For production, replace with Redis using `ioredis`
