import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toMapLocations, activityCoords } from "../lib/coords";
import { useSocket } from "../hooks/useSocket";
import { useTrip } from "../contexts/TripContext";
import { MessageBubble } from "../components/Chat/MessageBubble";
import { TypingIndicator } from "../components/Chat/TypingIndicator";
import { MessageInput } from "../components/Chat/MessageInput";
import { Map } from "../components/Map";
import { ItineraryOverlay } from "../components/ItineraryOverlay";
import axios from "axios";
import { toast } from "react-toastify";
import { apiSaveItineraryFromChat, getToken } from "../lib/api";
import { Plane, MapPin, MessageSquarePlus, Home } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
// Must stay ABOVE the backend's own AGENT_TIMEOUT_MS (chatController.ts, 75s)
// plus a little headroom, so the client never abandons a response the server
// is still going to send. A cold-destination itinerary legitimately takes
// tens of seconds; giving up at 35s meant discarding work that had succeeded.
const CLIENT_RESPONSE_TIMEOUT_MS = 85000;

const CONVERSATION_ID_STORAGE_KEY = "traveltea_conversationId";

export default function Chat({ isDrawer = false }) {
  // Persist the conversation id across reloads (Phase 8) — same
  // lazy-initializer + persist-on-change pattern TripContext.jsx already
  // uses for tripData. Falls back to a fresh id so the socket still joins
  // a room before the first message is ever sent for a brand-new visitor.
  const [conversationId, setConversationId] = useState(() => {
    try {
      const saved = localStorage.getItem(CONVERSATION_ID_STORAGE_KEY);
      if (saved) return saved;
    } catch (e) {
      console.error("Failed to read conversationId from localStorage", e);
    }
    return crypto.randomUUID();
  });
  // Captured once via the same lazy-initializer trick — stable for the
  // component's lifetime, tells the history-restore effect below whether
  // there's actually anything server-side worth fetching, without a
  // second localStorage read on every render.
  const [hadPersistedConversation] = useState(() => {
    try {
      return !!localStorage.getItem(CONVERSATION_ID_STORAGE_KEY);
    } catch {
      return false;
    }
  });
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const responseTimeoutRef = useRef(null);
  const navigate = useNavigate();
  const { tripData, updateTripData } = useTrip();
  // A trip the agent planned and saved during this conversation. Adopted as
  // activeTripId so the existing edit_timeline path can edit that itinerary
  // by command — the agent's own SavedTrip, not one opened from the planner.
  const [agentTripId, setAgentTripId] = useState(null);
  // Save/Edit state for an itinerary the agent just generated in chat.
  const [savingItinerary, setSavingItinerary] = useState(false);
  const [savedItineraryId, setSavedItineraryId] = useState(null);

  // Itinerary and Map state
  const [currentItinerary, setCurrentItinerary] = useState(null);
  const [isItineraryOpen, setIsItineraryOpen] = useState(false);
  const [mapLocations, setMapLocations] = useState([]);
  const [focusedLocation, setFocusedLocation] = useState(null);

  const {
    isConnected,
    agentStatus,
    lastMessage,
    lastError,
    clearLastMessage,
    clearLastError,
  } = useSocket(conversationId);

  // Persist the conversation id on change (e.g. after "New chat" mints a
  // fresh one) — pairs with the lazy-initializer read above.
  useEffect(() => {
    try {
      localStorage.setItem(CONVERSATION_ID_STORAGE_KEY, conversationId);
    } catch (e) {
      console.error("Failed to persist conversationId to localStorage", e);
    }
  }, [conversationId]);

  // Restore prior history for a persisted conversation on first mount only
  // — a page reload should continue the same thread instead of starting
  // blank. Deliberately does not depend on conversationId (must not re-run
  // when "New chat" changes it — that path starts empty on purpose).
  useEffect(() => {
    if (!hadPersistedConversation) return;

    const token = localStorage.getItem("traveltea_token");
    if (!token) return;

    setIsHistoryLoading(true);
    axios
      .get(`${API_URL}/api/chat/${conversationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((response) => {
        const history = response.data?.messages;
        const pendingBooking = response.data?.pendingBooking;
        const pendingTrip = response.data?.pendingTrip;
        if (!Array.isArray(history) || history.length === 0) return;

        const mapped = history.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }));

        // A pause means no later assistant turn happened yet this
        // conversation — the last message must be the one that asked.
        const lastIndex = mapped.length - 1;
        if (
          pendingBooking?.awaitingConfirmation &&
          lastIndex >= 0 &&
          mapped[lastIndex].role === "assistant"
        ) {
          mapped[lastIndex] = { ...mapped[lastIndex], pendingBooking };
        }
        if (pendingTrip?.awaiting && lastIndex >= 0 && mapped[lastIndex].role === "assistant") {
          mapped[lastIndex] = { ...mapped[lastIndex], pendingTrip };
        }

        setMessages(mapped);
      })
      .catch((error) => {
        // A 404 just means this id was never actually used server-side
        // (e.g. the very first visit already persisted an id before the
        // first message was sent) — nothing to restore, not worth
        // surfacing as an error.
        if (error?.response?.status !== 404) {
          console.error("Failed to restore conversation history:", error);
        }
      })
      .finally(() => setIsHistoryLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNewChat = () => {
    setConversationId(crypto.randomUUID());
    setMessages([]);
    setCurrentItinerary(null);
    setIsItineraryOpen(false);
    setMapLocations([]);
    setFocusedLocation(null);
    setAgentTripId(null);
    setSavedItineraryId(null);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, agentStatus]);

  // Handle new messages from Socket.io
  useEffect(() => {
    if (lastMessage) {
      try {
        const data = JSON.parse(lastMessage);

        const shouldProcess =
          !conversationId || data.conversationId === conversationId;

        if (shouldProcess) {
          console.log("[CHAT] Adding assistant message to UI");

          if (!conversationId && data.conversationId) {
            setConversationId(data.conversationId);
          }

          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: data.message,
              timestamp: new Date(),
              itinerary: data.itinerary || null,
              pendingBooking: data.pendingBooking || null,
              bookingResult: data.bookingResult || null,
              pendingTrip: data.pendingTrip || null,
            },
          ]);

          // The agent finished planning a trip and saved it — adopt it so
          // "move the museum to day 3" has something to edit. The whole trip
          // context is replaced, not just the id: merging in the id alone
          // left the cities/dates from an earlier planner session sitting
          // next to a trip they no longer describe.
          const savedTripId = data.tripPlanResult?.savedTripId;
          if (savedTripId) {
            const plan = data.tripPlanResult?.plan || {};
            setAgentTripId(savedTripId);
            updateTripData({
              savedTripId,
              cities: plan.destination
                ? [{ name: plan.destination, days: plan.days || 1 }]
                : undefined,
              startDate: plan.startDate,
              totalDays: plan.days,
              people: plan.travelers || 1,
              travelType: plan.travelType,
              budget: plan.budget ? { total: plan.budget } : undefined,
              timeline: undefined,
            });
          }

          clearTimeout(responseTimeoutRef.current);
          setIsLoading(false);
        }
      } catch (e) {
        console.error("[CHAT] Failed to parse message:", e);
      }

      clearLastMessage();
    }
    // updateTripData is deliberately not a dependency — TripContext recreates
    // it every render, which would re-run this effect on every render for no
    // benefit (the body no-ops once lastMessage is cleared).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessage, conversationId, clearLastMessage]);

  // Handle errors from Socket.io
  useEffect(() => {
    if (lastError) {
      try {
        const data = JSON.parse(lastError);

        const shouldProcess =
          !conversationId || data.conversationId === conversationId;

        if (shouldProcess) {
          console.error("[CHAT] Adding error message to UI");

          if (!conversationId && data.conversationId) {
            setConversationId(data.conversationId);
          }

          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `Sorry, I encountered an error: ${data.error}`,
              timestamp: new Date(),
            },
          ]);

          clearTimeout(responseTimeoutRef.current);
          setIsLoading(false);
        }
      } catch (e) {
        console.error("[CHAT] Failed to parse error:", e);
      }

      clearLastError();
    }
  }, [lastError, conversationId, clearLastError]);

  // Load the real itinerary (with real coordinates) when an assistant
  // message carries one, and show every activity on the map at once.
  useEffect(() => {
    const last = messages[messages.length - 1];

    if (last && last.role === "assistant" && last.itinerary) {
      console.log("[CHAT] Itinerary received:", last.itinerary);

      setCurrentItinerary(last.itinerary);

      const locations = toMapLocations(last.itinerary.days);

      if (locations.length > 0) {
        setMapLocations(locations);
      }
    }
  }, [messages]);

  /**
   * Persist an itinerary the agent generated in chat.
   *
   * Returns the saved trip id (or null), because "Edit with AI" needs the same
   * save to have happened first — edit_timeline mutates a real SavedTrip by id,
   * so an unsaved chat itinerary has nothing to edit. Idempotent within a
   * conversation: a second call returns the id already held.
   */
  const saveItinerary = async (itinerary) => {
    if (savedItineraryId) return savedItineraryId;
    if (!itinerary?.days?.length) return null;

    try {
      setSavingItinerary(true);
      const meta = itinerary.tripMetadata || {};
      const res = await apiSaveItineraryFromChat(
        {
          itinerary,
          startDate: meta.startDate,
          travelType: meta.travelType,
          travelers: meta.travelers ?? meta.numberOfPeople,
          budgetTotal:
            typeof meta.budget === "object" ? meta.budget?.total : Number(meta.budget) || undefined,
        },
        getToken(),
      );
      const id = res?.savedTrip?._id;
      if (!id) throw new Error("The server didn't return a saved trip.");

      setSavedItineraryId(id);
      setAgentTripId(id);
      updateTripData({
        savedTripId: id,
        cities: res.savedTrip.cities,
        startDate: res.savedTrip.startDate,
        totalDays: res.savedTrip.totalDays,
        people: res.savedTrip.people,
        travelType: res.savedTrip.travelType,
        budget: res.savedTrip.budget,
        timeline: undefined,
      });
      return id;
    } catch (err) {
      console.error("Saving itinerary failed:", err);
      toast.error(err.message || "Couldn't save this trip.");
      return null;
    } finally {
      setSavingItinerary(false);
    }
  };

  const handleSaveItinerary = async (itinerary) => {
    const id = await saveItinerary(itinerary);
    if (id) toast.success("Saved — find it under Saved Trips.");
  };

  /**
   * "Edit with AI": save first (silently, if needed) so there's a real trip to
   * mutate, then hand the conversation back to the user. Their next messages
   * go through the normal chat path, where the planner routes them to
   * edit_timeline against this trip's id.
   */
  const handleEditItinerary = async (itinerary) => {
    const id = await saveItinerary(itinerary);
    if (!id) return;

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: [
          "Sure — tell me what to change and I'll edit this itinerary.",
          "",
          'For example: **"move the museum to day 3"**, **"remove the beach on day 2"**, ' +
            '**"add a rooftop bar on day 1"**, or **"swap day 1 and day 2"**.',
        ].join("\n"),
        timestamp: new Date(),
      },
    ]);
  };

  const handleSendMessage = async (message) => {
    //Add user message immediately
    const userMessage = {
      role: "user",
      content: message,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    // Client-side safety net: if neither agent:response nor agent:error
    // ever arrives (dropped socket event, client never joined the room in
    // time, connection hiccup), don't spin the loading indicator forever.
    clearTimeout(responseTimeoutRef.current);
    responseTimeoutRef.current = setTimeout(() => {
      setIsLoading(false);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "That's taking longer than expected — the response may have been lost. Please try again.",
          timestamp: new Date(),
        },
      ]);
    }, CLIENT_RESPONSE_TIMEOUT_MS);

    try {
      const token = localStorage.getItem("traveltea_token");

      if (!token) {
        throw new Error("Not authenticated. Please log in.");
      }

      const response = await axios.post(
        `${API_URL}/api/chat`,
        {
          message,
          conversationId,
          // Only meaningful when there's an active saved trip loaded — lets
          // the agent apply timeline edits ("move X to day 2") via chat.
          // A trip the agent planned this conversation wins over one opened
          // from the planner — it's the one the user is looking at.
          ...(agentTripId || tripData?.savedTripId
            ? {
                activeTripId: agentTripId || tripData.savedTripId,
                timelineVersion: tripData?.timeline?.version,
                mutationId: crypto.randomUUID(),
              }
            : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      // Set conversation ID if this is the first message
      if (!conversationId && response.data.conversationId) {
        setConversationId(response.data.conversationId);
      }
      // Note: AI response will come via Socket.io
      // The axios response is just for confirmation
    } catch (error) {
      console.error("Send message error:", error);

      let errorMessage =
        "Sorry, I had trouble processing your message. Please try again.";

      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          errorMessage = "Please log in to continue chatting.";
        } else if (error.response?.data?.error) {
          errorMessage = error.response.data.error;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      clearTimeout(responseTimeoutRef.current);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: errorMessage,
          timestamp: new Date(),
        },
      ]);

      setIsLoading(false);
    }
  };

  return (
    <div className={`flex flex-col ${isDrawer ? 'h-full' : 'h-screen'} bg-gray-100 dark:bg-gray-900`}>
      {/* Header */}
      {!isDrawer && (
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
                <Plane className="text-white" size={20} />
              </div>

              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                  TravelTea
                </h1>

                <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isConnected ? "bg-green-500" : "bg-red-500"
                    }`}
                  />

                  {isConnected ? "Connected" : "Disconnected"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* The map view is a full-screen page with no app chrome around
                  it, so without this there was no way back to planning short
                  of the browser's back button. */}
              <button
                onClick={() => navigate("/plan")}
                title="Back to trip planning"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <Home size={16} />
                <span className="hidden sm:inline">Plan</span>
              </button>

              {conversationId && (
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                  <MapPin size={16} />

                  <span className="hidden sm:inline">
                    Session: {conversationId.slice(0, 8)}
                    ...
                  </span>
                </div>
              )}

              <button
                onClick={handleNewChat}
                title="Start a new conversation"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <MessageSquarePlus size={16} />
                <span className="hidden sm:inline">New chat</span>
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Split View */}
      <div className="flex-1 flex overflow-hidden">
        {isItineraryOpen && currentItinerary ? (
          /* Itinerary — shares the screen with the map instead of covering it.
             isDrawer has to be threaded through here for the same reason the
             chat column below needs it: there's no map beside it in the
             drawer, so the panel takes the full width. */
          <ItineraryOverlay
            itinerary={currentItinerary}
            isDrawer={isDrawer}
            onClose={() => setIsItineraryOpen(false)}
            onActivityClick={(activity) => {
              const coords = activityCoords(activity);
              if (coords) setFocusedLocation(coords);
            }}
          />
        ) : (
          /* Chat */
          <div className={`${isDrawer ? 'w-full' : 'w-[35%]'} flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700`}>
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {messages.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
                    <Plane className="text-white" size={32} />
                  </div>

                  {isHistoryLoading ? (
                    <p className="text-gray-500 dark:text-gray-400">
                      Restoring your last conversation...
                    </p>
                  ) : (
                    <>
                      <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
                        Where would you like to go?
                      </h2>

                      <p className="text-gray-600 dark:text-gray-400 mb-8 max-w-md mx-auto">
                        I'm your AI travel assistant. Ask me about
                        destinations, plan trips, or get recommendations!
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {messages.map((msg, index) => (
                    <MessageBubble
                      key={index}
                      role={msg.role}
                      content={msg.content}
                      timestamp={msg.timestamp}
                      itinerary={msg.itinerary}
                      onViewItinerary={() => {
                        if (msg.itinerary) {
                          setCurrentItinerary(msg.itinerary);
                          setIsItineraryOpen(true);
                        }
                      }}
                      pendingBooking={msg.pendingBooking}
                      bookingResult={msg.bookingResult}
                      pendingTrip={msg.pendingTrip}
                      isLatest={index === messages.length - 1}
                      onSelectOption={(optionIndex) =>
                        handleSendMessage(`book option ${optionIndex + 1}`)
                      }
                      onConfirm={() => handleSendMessage("yes")}
                      onDecline={() => handleSendMessage("no thanks")}
                      onReply={handleSendMessage}
                      onSaveItinerary={
                        msg.itinerary ? () => handleSaveItinerary(msg.itinerary) : undefined
                      }
                      onEditItinerary={
                        msg.itinerary ? () => handleEditItinerary(msg.itinerary) : undefined
                      }
                      savingItinerary={savingItinerary}
                      itinerarySaved={!!savedItineraryId}
                    />
                  ))}
                </>
              )}

              {(isLoading || agentStatus) && (
                <TypingIndicator status={agentStatus} />
              )}

              <div ref={messagesEndRef} />
            </div>

            <MessageInput
              onSend={handleSendMessage}
              disabled={isLoading || !isConnected}
              placeholder={
                isConnected
                  ? "Ask me about your next trip..."
                  : "Connecting to server..."
              }
            />
          </div>
        )}

        {/* Map */}
        {!isDrawer && (
          <div className="w-[65%] relative isolate bg-gray-50 dark:bg-gray-900">
            <Map locations={mapLocations} focus={focusedLocation} />
          </div>
        )}
      </div>
    </div>
  );
}
