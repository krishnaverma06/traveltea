import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './config/database.js';
import { mcpHub } from './mcp/hub.js';
import chatRoutes from './routes/chat.js';
import { setSocketIO } from './controllers/chatController.js';
import authRoutes from "./routes/authRoutes.js";
import tripRoutes from "./routes/tripRoutes.js";
import itineraryRoutes from './routes/itinerary.js';
import savedTripRoutes from './routes/savedTripRoutes.js'
import searchRoutes from './routes/searchRoutes.js'
import exploreRoutes from './routes/exploreRoutes.js'
import travelDataRoutes from './routes/travelDataRoutes.js'
import bookingRoutes from './routes/bookingRoutes.js'
import travelSearchRoutes from './routes/travelSearchRoutes.js'
import transactionRoutes from './routes/transactionRoutes.js'

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Debug: Verify env vars are loaded
console.log('🔑 Environment check:');
console.log('  - GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? '✅ Loaded' : '❌ Missing');
console.log('  - OPENTRIPMAP_API_KEY:', process.env.OPENTRIPMAP_API_KEY ? '✅ Loaded' : '❌ Missing');
console.log('  - SERP_API_KEY:', (process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY || process.env.SERPAPI_KEY) ? "✅ Loaded" : "Missing");
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.get('/api', (req, res) => {
  res.json({ message: 'TravelTea API is running' });
});



// Chat routes
app.use('/api/chat', chatRoutes);
app.use('/api/itinerary', itineraryRoutes);

// Auth routes
app.use('/api/auth', authRoutes);
app.use("/api/trips", tripRoutes);
app.use("/api/saved-trips", savedTripRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/explore", exploreRoutes);
app.use("/api/travel-data", travelDataRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/travel-search", travelSearchRoutes);
app.use("/api/transactions", transactionRoutes);

// Set Socket.io instance for chat controller
setSocketIO(io);


// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('join:conversation', (conversationId: string) => {
      socket.join(conversationId);
      console.log(`📝 Socket ${socket.id} joined conversation: ${conversationId}`);
  });

  // Leave conversation room
  socket.on('leave:conversation', (conversationId: string) => {
    socket.leave(conversationId);
    console.log(`👋 Socket ${socket.id} left conversation: ${conversationId}`);
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });

  
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

const PORT = process.env.PORT || 5000;

// Start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Warm start for the in-process MCP servers. Readiness is memoized inside
    // the hub, so this is an optimization rather than a correctness
    // requirement — but doing it here means the first chat request doesn't
    // pay the connect cost.
    await mcpHub.init();

    httpServer.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📡 Socket.io listening for connections`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export { io };