import { useState, useEffect, useRef } from "react";
import { useSocket } from "../../hooks/useSocket";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";
import { MessageInput } from "./MessageInput";
import { ItineraryOverlay } from "../ItineraryOverlay";
import axios from "axios";
import { Plane, X, MessageCircle } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export function DashboardChat({ isOpen, onClose }) {
  // Generate conversation ID once
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Itinerary state
  const [currentItinerary, setCurrentItinerary] = useState(null);
  const [isItineraryOpen, setIsItineraryOpen] = useState(false);

  const {
    isConnected,
    agentStatus,
    lastMessage,
    lastError,
    clearLastMessage,
    clearLastError,
  } = useSocket(conversationId);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({
        behavior: "smooth",
      });
    }
  }, [messages, agentStatus, isOpen]);

  // Handle new messages from Socket.io
  useEffect(() => {
    if (lastMessage) {
      try {
        const data = JSON.parse(lastMessage);
        const shouldProcess = !conversationId || data.conversationId === conversationId;

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
            },
          ]);
          setIsLoading(false);
        }
      } catch (e) {
        console.error("[CHAT] Failed to parse message:", e);
      }
      clearLastMessage();
    }
  }, [lastMessage, conversationId, clearLastMessage]);

  // Handle errors from Socket.io
  useEffect(() => {
    if (lastError) {
      try {
        const data = JSON.parse(lastError);
        const shouldProcess = !conversationId || data.conversationId === conversationId;

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
          setIsLoading(false);
        }
      } catch (e) {
        console.error("[CHAT] Failed to parse error:", e);
      }
      clearLastError();
    }
  }, [lastError, conversationId, clearLastError]);

  const handleSendMessage = async (message) => {
    const userMessage = {
      role: "user",
      content: message,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const token = localStorage.getItem("traveltea_token");
      if (!token) throw new Error("Not authenticated. Please log in.");

      const response = await axios.post(
        `${API_URL}/api/chat`,
        { message, conversationId },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!conversationId && response.data.conversationId) {
        setConversationId(response.data.conversationId);
      }
    } catch (error) {
      console.error("Send message error:", error);
      let errorMessage = "Sorry, I had trouble processing your message. Please try again.";

      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          errorMessage = "Please log in to continue chatting.";
        } else if (error.response?.data?.error) {
          errorMessage = error.response.data.error;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

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
    <>
      {/* Overlay background for mobile, optional but good for focus */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/20 z-[90] sm:hidden" 
          onClick={onClose} 
        />
      )}

      {/* Slide-over Panel */}
      <div 
        className={`fixed inset-y-0 left-0 z-[100] w-full sm:w-[400px] bg-white dark:bg-gray-900 shadow-2xl border-r border-gray-200 dark:border-gray-800 flex flex-col transform transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
              <MessageCircle className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">AI Assistant</h2>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
                {isConnected ? "Connected" : "Disconnected"}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto px-4 py-6 bg-white dark:bg-gray-900">
          {messages.length === 0 ? (
            <div className="text-center py-10 opacity-70">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900/30 dark:to-pink-900/30 flex items-center justify-center">
                <Plane className="w-8 h-8 text-purple-500" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">How can I help?</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-[250px] mx-auto">
                Ask me to summarize a past trip, find your budget, or plan something new!
              </p>
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
                />
              ))}
            </>
          )}

          {(isLoading || agentStatus) && (
            <TypingIndicator status={agentStatus} />
          )}
          <div ref={messagesEndRef} className="pb-4" />
        </div>

        {/* Input Area */}
        <MessageInput
          onSend={handleSendMessage}
          disabled={isLoading || !isConnected}
          placeholder={isConnected ? "Message AI..." : "Connecting..."}
        />
      </div>

      {/* Itinerary Overlay Portal (if opened from chat) */}
      {isItineraryOpen && currentItinerary && (
        <div className="fixed inset-0 z-[200]">
          <ItineraryOverlay
            itinerary={currentItinerary}
            onClose={() => setIsItineraryOpen(false)}
            onActivityClick={(activity) => {
              console.log("Navigating to activity map location", activity.location);
            }}
          />
        </div>
      )}
    </>
  );
}
