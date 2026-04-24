import { useEffect, useState, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || 'http://localhost:5000';

export function useSocket(conversationId) {
  const [isConnected, setIsConnected] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null);
  const [lastMessage, setLastMessage] = useState(null);
  const [lastError, setLastError] = useState(null);
  const socketRef = useRef(null);

  // Initialize socket connection once on mount
  useEffect(() => {
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    const socket = socketRef.current;

    // Connection events
    socket.on('connect', () => {
      console.log('✅ Socket connected:', socket.id);
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('❌ Socket disconnected');
      setIsConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setIsConnected(false);
    });

    // Agent events
    socket.on('agent:thinking', (data) => {
      console.log(
        '[SOCKET] Received agent:thinking for conversation:',
        data.conversationId
      );
      setAgentStatus(data.status);
    });

    socket.on('agent:response', (data) => {
      console.log(
        '[SOCKET] Received agent:response for conversation:',
        data.conversationId
      );
      setAgentStatus(null);
      setLastMessage(
        JSON.stringify({
          message: data.message,
          conversationId: data.conversationId,
          itinerary: data.itinerary,
          updatedTrip: data.updatedTrip,
          pendingBooking: data.pendingBooking,
          bookingResult: data.bookingResult,
          // Agent-driven trip planning: which step the flow is paused on,
          // and the SavedTrip it created once it finishes.
          pendingTrip: data.pendingTrip,
          tripPlanResult: data.tripPlanResult,
        })
      );
    });

    socket.on('itinerary_updated', (data) => {
      console.log('[SOCKET] Received itinerary_updated for trip:', data.savedTripId);
      // We can broadcast this via a custom event so other components (like ItinearyPage) can pick it up
      const event = new CustomEvent('trip_mutated', { detail: data });
      window.dispatchEvent(event);
    });

    socket.on('agent:error', (data) => {
      console.log(
        '[SOCKET] Received agent:error for conversation:',
        data.conversationId
      );
      setAgentStatus(null);
      setLastError(
        JSON.stringify({
          error: data.error,
          conversationId: data.conversationId,
        })
      );
    });

    // Cleanup on unmount
    return () => {
      socket.disconnect();
    };
  }, []);

  // Join/Leave conversation room
  useEffect(() => {
    if (!socketRef.current || !conversationId) return;

    const socket = socketRef.current;

    console.log('📝 [SOCKET] Joining conversation room:', conversationId);
    socket.emit('join:conversation', conversationId);

    return () => {
      console.log('👋 [SOCKET] Leaving conversation room:', conversationId);
      socket.emit('leave:conversation', conversationId);
    };
  }, [conversationId]);

  const clearLastMessage = useCallback(() => {
    setLastMessage(null);
  }, []);

  const clearLastError = useCallback(() => {
    setLastError(null);
  }, []);

  return {
    socket: socketRef.current,
    isConnected,
    agentStatus,
    lastMessage,
    lastError,
    clearLastMessage,
    clearLastError,
  };
}