import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { User, Bot, Calendar } from "lucide-react";

const REVEAL_TICKS = 40;
const REVEAL_INTERVAL_MS = 20;

const markdownComponents = {
  h1: ({ children }) => (
    <h1 className="text-base font-bold mt-1 mb-1.5">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-sm font-bold mt-3 mb-1">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-sm leading-relaxed mb-1 last:mb-0">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  ul: ({ children }) => (
    <ul className="text-sm list-disc pl-4 mb-1 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="text-sm list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  hr: () => <hr className="my-2 border-current opacity-20" />,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2"
    >
      {children}
    </a>
  ),
};

export function MessageBubble({
  role,
  content,
  timestamp,
  itinerary,
  onViewItinerary,
}) {
  const isUser = role === "user";
  const [displayedContent, setDisplayedContent] = useState(
    isUser ? content : "",
  );

  // Simulate a streaming reveal for assistant messages: the full text is
  // already available (it's built server-side, not token-streamed), so we
  // just reveal it progressively for a live "typing" feel.
  useEffect(() => {
    if (isUser || !content) return;

    let i = 0;
    const chunkSize = Math.max(1, Math.ceil(content.length / REVEAL_TICKS));

    setDisplayedContent("");

    const interval = setInterval(() => {
      i += chunkSize;
      if (i >= content.length) {
        setDisplayedContent(content);
        clearInterval(interval);
      } else {
        setDisplayedContent(content.slice(0, i));
      }
    }, REVEAL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [content, isUser]);

  const isRevealDone = displayedContent.length >= content.length;
  const hasItinerary = !isUser && !!itinerary && isRevealDone;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"} mb-4`}
    >
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser
            ? "bg-blue-500 text-white"
            : "bg-gradient-to-br from-purple-500 to-pink-500 text-white"
        }`}
      >
        {isUser ? <User size={18} /> : <Bot size={18} />}
      </div>

      {/* Message Content */}
      <div
        className={`flex flex-col ${
          isUser ? "items-end" : "items-start"
        } max-w-[70%]`}
      >
        <div
          className={`rounded-2xl px-4 py-2.5 ${
            isUser
              ? "bg-blue-500 text-white"
              : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
          }`}
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap break-words">
              {content}
            </p>
          ) : (
            <div className="break-words">
              <ReactMarkdown
                remarkPlugins={[remarkBreaks]}
                components={markdownComponents}
              >
                {displayedContent}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Timestamp */}
        <span className="text-xs text-gray-500 mt-1 px-1">
          {new Date(timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>

        {/* View Itinerary Button */}
        {hasItinerary && onViewItinerary && (
          <button
            onClick={onViewItinerary}
            className="mt-2 flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-md hover:shadow-lg text-sm font-medium"
          >
            <Calendar size={16} />
            View Itinerary
          </button>
        )}
      </div>
    </motion.div>
  );
}
