import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { z } from "zod";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";

export interface ChatModelOverrides {
  modelName?: string;
  temperature?: number;
  maxOutputTokens?: number;
  streaming?: boolean;
}

/**
 * Single place resolving GEMINI_API_KEY / GEMINI_MODEL and the fallback
 * model name. Per-call temperature/maxOutputTokens/streaming stay
 * caller-supplied since different call sites need different values.
 */
export function createChatModel(overrides: ChatModelOverrides = {}): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({
    model: overrides.modelName || process.env.GEMINI_MODEL || DEFAULT_MODEL,
    temperature: overrides.temperature ?? 0.7,
    maxOutputTokens: overrides.maxOutputTokens ?? 4096,
    streaming: overrides.streaming ?? false,
    apiKey: process.env.GEMINI_API_KEY,
  });
}

/**
 * Convention for structured-output call sites: a chat model bound to a
 * Zod schema via withStructuredOutput.
 */
export function createStructuredChatModel<T extends z.ZodTypeAny>(
  schema: T,
  overrides: ChatModelOverrides = {}
) {
  return createChatModel(overrides).withStructuredOutput(schema);
}
