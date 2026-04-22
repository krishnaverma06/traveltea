import { Request, Response } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { Conversation } from '../models/Conversation.js';
import { travelAgent } from '../agents/travel-agent.js';

/**
 * Chat Controller - Handles chat requests with Socket.io streaming
 */

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
      timeoutId = setTimeout(() => reject(new Error('Agent timeout after 30 seconds')), 30000);
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
        updatedTrip: updatedTrip // Send it back just in case the client wants it
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
      timestamp: new Date(),
    });

  } catch (error) {
    console.error('Chat error:', error);

    // Emit error only to sockets that joined this conversation's room
    if (io) {
      io.to(convId).emit('agent:error', {
        error: 'Failed to process your message',
        conversationId: convId
      });
    }

    return res.status(500).json({
      error: 'Failed to process your message. Please try again.',
      conversationId: convId,
    });
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