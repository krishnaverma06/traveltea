import { Request, Response } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { Conversation } from '../models/Conversation.js';
import { travelAgent } from '../agents/travel-agent.js';

/**
 * Chat Controller - Handles chat requests with Socket.io streaming
 */

/**
 * How long a single agent turn may take before the request is abandoned.
 *
 * Was 30s, which is under what a legitimate turn actually costs. Measured on a
 * cold destination: query embedding ~0.9s + RAG retrieval ~0.3s + the planner's
 * tool-calling LLM round trip + itinerary construction ~5.5s (geocode, place
 * fetch, image enrichment). Gemini's own latency is the variable part, and a
 * cold city like Kyoto measured 30.1s end to end — just over the line.
 *
 * That made the failure mode actively wasteful: the itinerary was fully built
 * server-side and then thrown away, and the user got "Failed to process your
 * message" for work that had actually succeeded. The budget is now set above
 * the real cost rather than under it.
 *
 * frontend/src/pages/Chat.jsx's CLIENT_RESPONSE_TIMEOUT_MS must stay above
 * this, or the client gives up on responses the server is still going to send.
 */
const AGENT_TIMEOUT_MS = 75_000;

let io: SocketIOServer | null = null;

/**
 * Set Socket.io instance
 */
export function setSocketIO(socketIO: SocketIOServer) {
  io = socketIO;
}

/**
 * POST /api/chat
 * Send a message and get AI response
 */
export async function sendMessage(req: Request, res: Response) {
  const { message, conversationId, activeTripId, timelineVersion, mutationId } = req.body;
  // Computed outside the try block so it's available in the catch block too —
  // previously the client got no conversationId back on error and the error
  // socket event was keyed off req.body.conversationId (undefined for a
  // brand-new conversation), so agent:error was never actually delivered.
  const convId = conversationId || uuidv4();

  try {
    // Validate input
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Find or create conversation, scoped to the requesting user
    let conversation = await Conversation.findOne({
      conversationId: convId,
      user: req.userId,
    });

    if (!conversation) {
      conversation = new Conversation({
        conversationId: convId,
        user: req.userId,
        messages: [],
        metadata: {},
      });
    }

    // Add user message
    conversation.messages.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });

    // Save user message
    await conversation.save();

    // Emit progress only to sockets that joined this conversation's room
    if (io) {
      io.to(convId).emit('agent:thinking', {
        status: 'Analyzing your request...',
        conversationId: convId
      });
    }

    // Get AI response with timeout. The agent call keeps its own .catch so
    // that if the timeout wins the race and the agent call later rejects,
    // it doesn't become an unhandled promise rejection (which crashes the
    // whole process by default — there's no global handler for it).
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<any>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Agent timeout after ${AGENT_TIMEOUT_MS / 1000} seconds`)),
        AGENT_TIMEOUT_MS,
      );
    });

    const agentPromise = travelAgent.chat(message, convId, req.userId, activeTripId, timelineVersion, mutationId);
    agentPromise.catch((err) => {
      console.error('Agent call failed (possibly after the 30s timeout already won the race):', err);
    });

    const agentResult = await Promise.race([agentPromise, timeoutPromise]);
    clearTimeout(timeoutId!);

    // Handle Timeline Mutations BEFORE extracting the response string, so a
    // mutation failure actually reaches the user instead of being silently
    // discarded — the response text and conversation save below both need
    // to reflect any mutation error.
    let updatedTrip = null;
    if (agentResult.mutations && agentResult.mutations.length > 0) {
      try {
        const { TimelineMutationEngine } = await import('../services/timelineMutationEngine.js');

        // Use activeTripId explicitly. Never fallback to latest.
        if (!activeTripId) {
          throw new Error('No activeTripId provided for timeline mutation.');
        }

        const mutationResult = await TimelineMutationEngine.applyMutations(
          activeTripId,
          agentResult.mutations,
          timelineVersion,
          mutationId
        );

        updatedTrip = mutationResult.trip;

        if (io) {
          console.log('📡 [SOCKET] Emitting itinerary_updated for trip:', activeTripId);
          io.emit('itinerary_updated', {
            savedTripId: activeTripId,
            tripData: updatedTrip,
            mutations: agentResult.mutations,
            mutationId
          });
        }
      } catch (err: any) {
        console.error("Failed to apply timeline mutations:", err);
        // Overwrite agentResult.response with the validation error so it
        // actually reaches aiResponse below, instead of the user being told
        // nothing went wrong while their edit silently never happened.
        if (err.name === 'MutationValidationError') {
           agentResult.response = `I couldn't apply your changes: ${err.message}`;
        } else {
           agentResult.response = `I couldn't apply your changes: ${err.message || 'please try again.'}`;
        }
      }
    }

     // Extract the response string from the agent result
    let aiResponse = agentResult.response || 'I apologize, but I had trouble processing your request.';
    if (Array.isArray(aiResponse)) {
      console.warn("⚠️ [CHAT CONTROLLER] Warning: agentResult.response was an array. Stringifying...");
      aiResponse = aiResponse.map(r => typeof r === 'string' ? r : JSON.stringify(r)).join(' ');
    } else if (typeof aiResponse !== 'string') {
      console.warn("⚠️ [CHAT CONTROLLER] Warning: agentResult.response was not a string. Casting...");
      aiResponse = String(aiResponse);
    }

    // Sync pending-booking state (Phase 4). undefined = not a booking
    // turn, leave as-is; null = clear; object = set/refresh. Written
    // before the existing assistant-message save below — no extra
    // conversation.save() call needed.
    if (agentResult.pendingBooking !== undefined) {
      conversation.pendingBooking = agentResult.pendingBooking;
    }

    // Same three-state contract for the agent-driven trip-planning flow
    // (Phase 18): undefined = not a planning turn, null = resolved, object =
    // still in progress. Persisted so a page reload restores the card the
    // flow is currently waiting on.
    if (agentResult.pendingTrip !== undefined) {
      conversation.pendingTrip = agentResult.pendingTrip;
    }

    // Add AI response to conversation
    conversation.messages.push({
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date(),
    });

    // Save AI message
    await conversation.save();

    // Emit completion only to sockets that joined this conversation's room
    console.log('📡 [SOCKET] Emitting agent:response for conversation:', convId);
    if (io) {
      io.to(convId).emit('agent:response', {
        message: aiResponse,
        conversationId: convId,
        itinerary: agentResult.itinerary,
        updatedTrip: updatedTrip, // Send it back just in case the client wants it
        // Structured booking data (Phase 8) — was already computed for the
        // Mongo sync above, just wasn't relayed to the client before now.
        pendingBooking: agentResult.pendingBooking,
        bookingResult: agentResult.bookingResult,
        pendingTrip: agentResult.pendingTrip,
        tripPlanResult: agentResult.tripPlanResult,
      });
      console.log('✅ [SOCKET] Event emitted successfully');
    } else {
      console.error('❌ [SOCKET] Socket.io instance not available!');
    }

    // Return response — itinerary/updatedTrip included here too (not just
    // over the socket) so a REST-only client, or one that hasn't joined the
    // conversation's socket room yet, still receives them.
    return res.status(200).json({
      conversationId: convId,
      message: aiResponse,
      itinerary: agentResult.itinerary,
      updatedTrip,
      pendingBooking: agentResult.pendingBooking,
      bookingResult: agentResult.bookingResult,
      pendingTrip: agentResult.pendingTrip,
      tripPlanResult: agentResult.tripPlanResult,
      timestamp: new Date(),
    });

  } catch (error) {
    console.error('Chat error:', error);

    // A timeout is not the same failure as a crash, and saying so matters:
    // the work usually completed server-side and the user's next attempt will
    // hit warm caches, so "try again" is genuinely the right advice here in a
    // way it isn't for a real error.
    const timedOut = error instanceof Error && error.message.includes('Agent timeout');
    const message = timedOut
      ? "That took longer than I'm allowed to wait for. Most of the work is cached now — asking again should be much quicker."
      : 'Failed to process your message. Please try again.';

    if (io) {
      io.to(convId).emit('agent:error', { error: message, conversationId: convId });
    }

    return res.status(timedOut ? 504 : 500).json({ error: message, conversationId: convId });
  }
}

/**
 * GET /api/chat/:conversationId
 * Get conversation history
 */
export async function getConversation(req: Request, res: Response) {
  try {
    const { conversationId } = req.params;

    const conversation = await Conversation.findOne({
      conversationId,
      user: req.userId,
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.status(200).json({
      conversationId: conversation.conversationId,
      messages: conversation.messages,
      metadata: conversation.metadata,
      // Lets a reloaded page restore an in-progress confirmation card
      // instead of it silently vanishing — was already persisted here,
      // just never returned before.
      pendingBooking: conversation.pendingBooking || null,
      pendingTrip: conversation.pendingTrip || null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    });

  } catch (error) {
    console.error('Get conversation error:', error);
    return res.status(500).json({ error: 'Failed to retrieve conversation' });
  }
}

/**
 * DELETE /api/chat/:conversationId
 * Delete a conversation
 */
export async function deleteConversation(req: Request, res: Response) {
  try {
    const { conversationId } = req.params;

    const result = await Conversation.deleteOne({
      conversationId,
      user: req.userId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.status(200).json({ message: 'Conversation deleted successfully' });

  } catch (error) {
    console.error('Delete conversation error:', error);
    return res.status(500).json({ error: 'Failed to delete conversation' });
  }
}

/**
 * GET /api/chat
 * List the authenticated user's conversations
 */
export async function listConversations(req: Request, res: Response) {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = parseInt(req.query.skip as string) || 0;

    const conversations = await Conversation
      .find({ user: req.userId })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .skip(skip)
      .select('conversationId messages metadata createdAt updatedAt');

    const total = await Conversation.countDocuments({ user: req.userId });

    return res.status(200).json({
      conversations,
      total,
      limit,
      skip,
    });

  } catch (error) {
    console.error('List conversations error:', error);
    return res.status(500).json({ error: 'Failed to list conversations' });
  }
}