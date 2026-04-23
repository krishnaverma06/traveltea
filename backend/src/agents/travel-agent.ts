import { StateGraph, Annotation, MemorySaver, Command, isInterrupted, INTERRUPT } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { itineraryBuilder } from "../services/itineraryBuilder.js";
import { intentDetector } from "./intent-detector.js";
import { toolRegistry, type Tool } from "./tool-registry.js";
import { TRAVEL_AGENT_SYSTEM_PROMPT, TOOL_SELECTION_SYSTEM_PROMPT, currentDateContext } from "./prompts.js";
import { createChatModel } from "../config/llm.js";
import type { AgentConfig } from "./types.js";
import type { Itinerary } from "../types/itinerary.js";
import type { DetectedIntent } from "./intent-detector.js";
import {
  formatCategoriesForAPI,
  getCategoriesFromQuery,
} from "../config/opentripmap-categories.js";

// Booking pipeline (Phase 3) — structural skeleton: search -> present
// options -> await confirmation -> execute booking, as its own branch off
// the planner, the same way edit_timeline already bypasses tool_executor.
import {
  bookingSlotFillNode,
  bookingSearchNode,
  bookingPresentOptionsNode,
  bookingConfirmNode,
  bookingExecuteNode,
  BOOKING_VIRTUAL_SPECS,
  formatBookingOptions,
  formatBookingConfirmPrompt,
  formatBookingSlotFillPrompt,
  formatBookingClarifyPrompt,
  formatBookingResult,
  formatBookingDeclined,
} from "./booking-pipeline.js";
import type { BookingRequest, BookingOption } from "./booking-pipeline.js";

// Trip planning pipeline (Phase 18) — the fully agent-driven path: collect
// trip details in conversation, book a flight and hotel, take payment, then
// generate an itinerary saved as a real trip so edit_timeline can edit it.
import {
  tripCollectNode,
  tripFlightSearchNode,
  tripFlightSelectNode,
  tripHotelSearchNode,
  tripHotelSelectNode,
  tripPaymentNode,
  tripItineraryNode,
  tripPlanIsComplete,
  formatTripSlotPrompt,
  formatTripFlightOptions,
  formatTripHotelOptions,
  formatTripPaymentPrompt,
  formatTripPlanComplete,
  formatTripCancelled,
  formatTripAbandoned,
} from "./trip-planning-pipeline.js";
import type { TripPlan } from "./trip-planning-pipeline.js";

/**
 * Every pause the trip-planning flow can produce, keyed by the interrupt
 * payload's `kind` — the same dispatch-on-kind discipline formatToolData
 * uses, rather than another ternary chain growing one arm per pause.
 */
const TRIP_INTERRUPT_FORMATTERS: Record<string, (data: any) => string> = {
  trip_slot: formatTripSlotPrompt,
  trip_flight_options: formatTripFlightOptions,
  trip_hotel_options: formatTripHotelOptions,
  trip_payment: formatTripPaymentPrompt,
};

// RAG Imports
import { generateEmbedding } from "../services/embedding.js";
import { VectorRetrievalService } from "../vector/services/vector-retrieval.service.js";
import { PromptBuilder } from "../vector/utils/prompt-builder.js";

// Deterministic Parser
import { DeterministicCommandParser } from "../utils/deterministicParser.js";

/**
 * Define agent state using Annotation API
 *
 * Every single-value field below uses a last-write-wins reducer
 * (`(left, right) => right`), not `right ?? left`. With a real checkpointer
 * (Phase 4), every "fresh" turn re-invokes on the SAME thread_id as prior
 * turns on the same conversation, and LangGraph merges the new initialState
 * into the persisted checkpoint via each channel's reducer. `right ?? left`
 * treated a fresh turn's explicit `undefined` (meaning "nothing yet this
 * turn") as "no update," so it silently kept whatever the PREVIOUS turn
 * last set — e.g. a stale toolData from a completed booking would then
 * render for every subsequent, unrelated message on that conversation
 * forever. No node in this graph ever relies on the old "preserve on
 * undefined" behavior within a single run — nodes simply omit fields they
 * don't touch, and LangGraph doesn't invoke a channel's reducer for keys
 * that are absent from a node's returned partial at all — so unconditional
 * overwrite is safe within a run and fixes the cross-turn leak. The
 * interrupt/resume path (`Command({resume})`) never passes a state object,
 * so no reducer runs there either way.
 */
const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  userQuery: Annotation<string>({
    reducer: (left, right) => right,
    default: () => "",
  }),
  intent: Annotation<string | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  toolCalls: Annotation<Array<{ name: string; args: any; id?: string }> | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  bookingRequest: Annotation<BookingRequest | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  bookingOptions: Annotation<BookingOption[] | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  selectedBookingOption: Annotation<BookingOption | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  bookingConfirmed: Annotation<boolean>({
    reducer: (left, right) => right,
    default: () => false,
  }),
  // Agent-driven trip planning (Phase 18). tripPlan accumulates across the
  // whole multi-turn flow; it survives between turns because a resumed run
  // passes Command({resume}) with no state object, so no reducer runs. It is
  // reset explicitly in chat()'s initialState like every other slot, so a
  // finished plan doesn't leak into the next unrelated message.
  tripPlan: Annotation<TripPlan | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  tripFlightOptions: Annotation<BookingOption[] | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  tripHotelOptions: Annotation<BookingOption[] | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  userId: Annotation<string | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  toolData: Annotation<{ kind: string; data: any } | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  // Markdown rendered by the tool's own presentation function (see
  // mcp/createDomainServer.ts). When present, response_formatter returns it
  // verbatim instead of dispatching to a per-tool format* method here.
  // MUST be reset in chat()'s initialState — see the comment there.
  toolRendered: Annotation<string | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  itinerary: Annotation<Itinerary | null | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  activeTripId: Annotation<string | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  timelineVersion: Annotation<number | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  mutationId: Annotation<string | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  mutations: Annotation<any[]>({
    reducer: (left, right) => right,
    default: () => [],
  }),
  response: Annotation<string | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  error: Annotation<string | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  conversationId: Annotation<string | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  ragContext: Annotation<string | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
  timestamp: Annotation<Date | undefined>({
    reducer: (left, right) => right,
    default: () => undefined,
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;

/**
 * Travel Planning Agent using LangGraph
 *
 * Workflow:
 * 1. User Input → Planner (decides which tools to call)
 * 2. Tool Executor → Calls MCP server tools
 * 3. Response Formatter → Creates conversational response
 */
export class TravelAgent {
  private model: ChatGoogleGenerativeAI;
  private toolCallingModel: ReturnType<ChatGoogleGenerativeAI["bindTools"]>;
  private graph: any; // LangGraph compiled graph
  // In-process checkpointer (Phase 4) — enables real cross-turn pause/
  // resume for bookingConfirmNode's interrupt() call. Known limitation,
  // accepted: a server restart loses all pending confirmations.
  private checkpointer: MemorySaver;

  constructor(config: AgentConfig = {}) {
    // Initialize Gemini model
    this.model = createChatModel({
      modelName: config.modelName,
      temperature: config.temperature || 0.7,
      maxOutputTokens: config.maxTokens || 4096,
      streaming: config.streaming || false,
    });

    // Bind the real tool registry (+ two virtual actions that aren't
    // registry tools) once at construction time, so Gemini's own structured
    // tool_calls output drives dispatch instead of a hardcoded switch.
    this.toolCallingModel = this.model.bindTools(this.buildToolSpecs());

    this.checkpointer = new MemorySaver();

    // Build the LangGraph workflow
    this.graph = this.buildGraph();
  }

  /**
   * Build the tool specs bound to the LLM for native function-calling:
   * every registered tool (with userId stripped from the schema for
   * userScoped tools — the LLM must never see or fill in a userId) plus
   * virtual actions that aren't toolRegistry entries: plan_trip (builds an
   * itinerary via itineraryBuilder), edit_timeline (a marker only — the
   * conditional edge routes it straight to timeline_editor before any tool
   * executes), and book_hotel/book_flight (route to the booking pipeline).
   */
  private buildToolSpecs() {
    const registrySpecs = toolRegistry.getAllTools().map((tool: Tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.userScoped
        ? (tool.inputSchema as unknown as z.ZodObject<any>).omit({ userId: true })
        : tool.inputSchema,
    }));

    const virtualSpecs = [
      {
        name: "plan_trip",
        description:
          "Create a brand-new multi-day itinerary for a destination. Use only when the user wants a full trip plan built from scratch, not for modifying an existing one.",
        schema: z.object({
          destination: z.string().min(1).describe("Destination city/place for the itinerary"),
          duration: z.number().int().min(1).max(30).optional().describe("Trip length in days; omit if unspecified"),
        }),
      },
      {
        name: "edit_timeline",
        description:
          "Modify an existing itinerary/timeline the user already has open (move/delete/add/swap/rename/undo/redo). Not for building a new plan, not for account preferences.",
        schema: z.object({}),
      },
      {
        name: "plan_full_trip",
        description:
          "Start the full guided trip-planning flow, where the agent does everything: it collects destination, dates, budget and trip style in conversation, searches and books a flight and a hotel, takes payment, then generates the itinerary. Use when the user wants a whole trip planned AND arranged through chat — 'plan my trip', 'plan and book a trip to X', 'organise everything for me'. Use plan_trip instead when they only want an itinerary with no bookings.",
        schema: z.object({
          destination: z.string().optional().describe("Where they're travelling to, if said — leave out otherwise, the flow will ask."),
          origin: z.string().optional().describe("Where they're travelling from, if said."),
          startDate: z.string().optional().describe("Trip start date as YYYY-MM-DD, if said."),
          days: z.number().int().min(1).max(30).optional().describe("Trip length in days, if said."),
          budget: z.number().optional().describe("Total trip budget as a plain number in US dollars, if said."),
          travelType: z
            .enum(["leisure", "business", "adventure", "cultural", "family", "solo"])
            .optional()
            .describe("The trip's intent mapped to the closest option, if said (honeymoon/beach -> leisure, trekking -> adventure, museums/history -> cultural)."),
          travelers: z.number().int().min(1).max(20).optional().describe("Number of travellers, if said."),
          priorities: z
            .array(z.string())
            .optional()
            .describe("What they want to prioritise, as short keywords, if said (food, museums, beaches, hiking, nightlife, shopping, relaxing)."),
        }),
      },
      ...BOOKING_VIRTUAL_SPECS,
    ];

    return [...registrySpecs, ...virtualSpecs];
  }

  /**
   * Build the LangGraph state machine
   */
  private buildGraph() {
    // Define the graph with Annotation and use method chaining
    const workflow = new StateGraph(AgentStateAnnotation)
      .addNode("planner", this.plannerNode.bind(this))
      .addNode("tool_executor", this.toolExecutorNode.bind(this))
      .addNode("timeline_editor", this.timelineEditorNode.bind(this))
      .addNode("booking_slot_fill", bookingSlotFillNode)
      .addNode("booking_search", bookingSearchNode)
      .addNode("booking_present_options", bookingPresentOptionsNode)
      .addNode("booking_confirm", bookingConfirmNode)
      .addNode("booking_execute", bookingExecuteNode)
      .addNode("trip_collect", tripCollectNode)
      .addNode("trip_flight_search", tripFlightSearchNode)
      .addNode("trip_flight_select", tripFlightSelectNode)
      .addNode("trip_hotel_search", tripHotelSearchNode)
      .addNode("trip_hotel_select", tripHotelSelectNode)
      .addNode("trip_payment", tripPaymentNode)
      .addNode("trip_itinerary", tripItineraryNode)
      .addNode("response_formatter", this.responseFormatterNode.bind(this))
      .addEdge("__start__", "planner")
      .addConditionalEdges("planner", (state: AgentState) => {
        const calls = state.toolCalls || [];
        // plan_full_trip is a marker too — it opens the guided trip-planning
        // branch rather than reaching the generic tool executor.
        if (calls.some((c) => c.name === "plan_full_trip")) {
          return "trip_collect";
        }
        // edit_timeline is a marker only — it never reaches tool_executor,
        // it routes straight to the specialized timeline_editor node.
        if (calls.some((c) => c.name === "edit_timeline")) {
          return "timeline_editor";
        }
        // book_hotel/book_flight are markers too — they route into the
        // booking pipeline instead of the generic tool executor.
        if (calls.some((c) => c.name === "book_hotel" || c.name === "book_flight")) {
          return "booking_slot_fill";
        }
        if (calls.length > 0) {
          return "tool_executor";
        }
        // No tool selected → casual chat, straight to the formatter.
        return "response_formatter";
      })
      .addEdge("tool_executor", "response_formatter")
      .addEdge("timeline_editor", "response_formatter")
      .addConditionalEdges("booking_slot_fill", (state: AgentState) =>
        state.error ? "response_formatter" : "booking_search"
      )
      .addEdge("booking_search", "booking_present_options")
      .addEdge("booking_present_options", "booking_confirm")
      .addConditionalEdges("booking_confirm", (state: AgentState) =>
        state.bookingConfirmed ? "booking_execute" : "response_formatter"
      )
      .addEdge("booking_execute", "response_formatter")
      // Trip planning. trip_collect loops back to itself while any required
      // field is still missing — one question per node execution, so each
      // answer is checkpointed and the extraction LLM call for earlier slots
      // is never replayed. See trip-planning-pipeline.ts's header.
      .addConditionalEdges("trip_collect", (state: AgentState) => {
        if (
          state.error ||
          state.toolData?.kind === "trip_cancelled" ||
          state.toolData?.kind === "trip_abandoned"
        ) {
          return "response_formatter";
        }
        return tripPlanIsComplete(state.tripPlan) ? "trip_flight_search" : "trip_collect";
      })
      .addEdge("trip_flight_search", "trip_flight_select")
      .addConditionalEdges("trip_flight_select", (state: AgentState) =>
        state.error || state.toolData?.kind === "trip_abandoned"
          ? "response_formatter"
          : "trip_hotel_search",
      )
      .addEdge("trip_hotel_search", "trip_hotel_select")
      .addConditionalEdges("trip_hotel_select", (state: AgentState) =>
        state.error || state.toolData?.kind === "trip_abandoned"
          ? "response_formatter"
          : "trip_payment",
      )
      .addEdge("trip_payment", "trip_itinerary")
      .addEdge("trip_itinerary", "response_formatter")
      .addEdge("response_formatter", "__end__");

    return workflow.compile({ checkpointer: this.checkpointer });
  }

  /**
   * Planner Node: Uses native Gemini tool-calling (bindTools) to decide
   * whether the query needs a tool at all, and if so, which one(s) with
   * what arguments — real structured output, not prompt+regex JSON.
   * Falls back to keyword-based detection only if the call itself throws
   * (quota/network), mirroring this codebase's existing degrade-don't-crash
   * convention for every other LLM call site.
   */
  private async plannerNode(state: AgentState): Promise<Partial<AgentState>> {
    console.log("\n🧠 [PLANNER] Analyzing user query:", state.userQuery);
    try {
      // RAG context reaches the planner too, not just the reply formatter.
      // Retrieval already ran in chat() and already includes the user's
      // profile layer and their past trips, but tool SELECTION never saw any
      // of it — so "book me a hotel like last time" or "plan another trip
      // somewhere I'd like" had to be answered from the message text alone.
      // Given here as reference material for choosing the tool and filling its
      // arguments; it must never be mistaken for what the user just asked.
      const ragBlock = state.ragContext
        ? `

${state.ragContext}

Use the context above only to resolve references in the user's message (a place they've been, a preference they hold). It is background, not a request — never treat it as the thing to act on.`
        : "";

      const response = await this.toolCallingModel.invoke([
        // Date context is appended per request, not baked into the constant —
        // the planner has to resolve "next month" against the real today.
        new SystemMessage(`${TOOL_SELECTION_SYSTEM_PROMPT}

${currentDateContext()}${ragBlock}`),
        new HumanMessage(state.userQuery),
      ]);

      const toolCalls = (response.tool_calls || []).map((tc: any) => ({
        name: tc.name,
        args: tc.args ?? {},
        id: tc.id,
      }));

      console.log(
        "🔧 [PLANNER] Tool calls:",
        toolCalls.map((c) => `${c.name}(${JSON.stringify(c.args)})`),
      );

      return {
        toolCalls,
        messages: [
          new AIMessage(
            toolCalls.length > 0
              ? `Calling: ${toolCalls.map((c) => c.name).join(", ")}`
              : String(response.content || "Understood."),
          ),
        ],
      };
    } catch (error) {
      console.error("Planner node error (falling back to keyword detection):", error);
      const detected = intentDetector.fallbackDetection(state.userQuery);
      return { toolCalls: this.legacyFallbackToToolCalls(detected, state.userQuery) };
    }
  }

  /**
   * Tool Executor Node: Generic dispatch over whatever tool_calls the
   * planner selected — no more per-intent switch. Executes every call
   * (nothing silently dropped), but only the first result's mapping
   * populates the state slot response_formatter reads, matching the
   * previous "one thing per turn" behavior.
   */
  private async toolExecutorNode(
    state: AgentState,
  ): Promise<Partial<AgentState>> {
    const calls = state.toolCalls || [];
    console.log(
      "\n🔧 [TOOL EXECUTOR] Running tool calls:",
      calls.map((c) => c.name),
    );
    if (calls.length === 0) return {};

    try {
      const results: Array<{ name: string; payload: any; isError: boolean; rendered?: string }> = [];

      for (const call of calls) {
        // plan_trip is a virtual action — not a toolRegistry entry.
        if (call.name === "plan_trip") {
          const destination = call.args.destination || this.extractDestination(state.userQuery);
          const duration = call.args.duration ?? this.extractDuration(state.userQuery);

          console.log(`🗓️ [TOOL] Building ${duration}-day itinerary for ${destination}`);
          const itinerary = await itineraryBuilder.buildItinerary(destination, duration);
          if (itinerary) {
            console.log(`✅ [TOOL] Successfully built itinerary with ${itinerary.days.length} days`);
          }
          results.push({ name: "plan_trip", payload: { itinerary }, isError: !itinerary });
          continue;
        }

        const tool = toolRegistry.getTool(call.name);
        if (!tool) {
          results.push({ name: call.name, payload: { error: `Unknown tool ${call.name}` }, isError: true });
          continue;
        }

        let args = call.args || {};

        // Fail-closed userId handling: never trust the LLM for this, even
        // though the bound schema already omits the field so Gemini can't
        // fill it in either. If there's no authenticated user, the tool is
        // never called at all.
        if (tool.userScoped) {
          if (!state.userId) {
            results.push({
              name: call.name,
              payload: { error: tool.signInMessage || "you'll need to be signed in for that." },
              isError: true,
            });
            continue;
          }
          args = { ...args, userId: state.userId };
        }

        // Narrow safety net: search_by_category requires a category; fall
        // back to keyword-derived ones if the LLM left it out.
        if (call.name === "search_by_category" && !args.category) {
          args = { ...args, category: formatCategoriesForAPI(getCategoriesFromQuery(state.userQuery)) };
        }

        try {
          const result = await toolRegistry.executeTool(call.name, args);
          const payload = result.content?.[0]?.text ? JSON.parse(result.content[0].text) : null;
          // content[1], when present, is the tool's own rendered markdown —
          // see mcp/createDomainServer.ts. content[0] is unchanged.
          const rendered = result.content?.[1]?.text;
          results.push({ name: call.name, payload, isError: !!result.isError, rendered });
        } catch (err) {
          results.push({ name: call.name, payload: { error: String(err) }, isError: true });
        }
      }

      const primary = results[0];
      if (!primary) return {};

      if (primary.isError) {
        return { error: primary.payload?.error || "I couldn't complete that request." };
      }

      // The tool rendered its own response — response_formatter returns it
      // verbatim and no per-tool mapping is needed here.
      if (primary.rendered) {
        return { toolRendered: primary.rendered, intent: primary.name };
      }

      // plan_trip is a virtual action with its own state slot.
      if (primary.name === "plan_trip") {
        return { itinerary: primary.payload.itinerary, intent: "plan_trip" };
      }

      // Everything else lands in one generic slot keyed by the tool's own
      // name. Only tools without a presentation function reach here —
      // currently just web_search, whose response is built by
      // summarizeWebSearch (an LLM call needing userQuery + ragContext, so
      // not a pure function of the payload). Booking kinds are written by the
      // booking pipeline, never by a tool, so there is no collision.
      return { toolData: { kind: primary.name, data: primary.payload }, intent: primary.name };
    } catch (error) {
      console.error("Tool executor error:", error);
      return {
        error: "Failed to fetch travel information. Please try again.",
      };
    }
  }

  /**
   * Degraded-path dispatch: only reached when the native tool-calling call
   * itself throws (quota/network). Rebuilds an equivalent toolCalls array
   * from the keyword-based fallback intent so the rest of the pipeline
   * (tool_executor / timeline_editor routing) doesn't need to know the
   * difference. This is where the old regex-based extraction helpers now
   * earn their keep — as a last-resort arg builder, not primary dispatch.
   */
  private legacyFallbackToToolCalls(
    detected: DetectedIntent,
    userQuery: string,
  ): Array<{ name: string; args: any }> {
    const destination = this.extractDestination(userQuery);
    const category = this.extractCategory(userQuery);

    switch (detected.primary_intent) {
      case "search_hotels":
        return [{ name: "search_by_category", args: { location: destination, category: "accomodations" } }];
      case "search_attractions":
      case "search_destination":
      case "unknown":
        return category
          ? [{ name: "search_by_category", args: { location: destination, category } }]
          : [{ name: "search_destinations", args: { query: destination } }];
      case "search_restaurants":
        return [{ name: "search_restaurants", args: { location: destination } }];
      case "find_nearby":
        // No hardcoded fallback coordinates — this fails cleanly instead of
        // always answering about Paris.
        return [{ name: "get_nearby_attractions", args: {} }];
      case "calculate_distance":
        return [{ name: "calculate_distance", args: this.parseOriginDestination(userQuery) }];
      case "plan_trip":
        return [{ name: "plan_trip", args: { destination, duration: this.extractDuration(userQuery) } }];
      case "web_search":
      case "search_flights":
      case "get_weather":
      case "convert_currency":
      case "estimate_budget":
        return [{ name: "web_search", args: { query: userQuery } }];
      case "search_events":
        return [{ name: "search_events", args: { city: detected.entities.location || destination } }];
      case "list_saved_trips":
        return [{ name: "list_saved_trips", args: {} }];
      case "get_upcoming_trip":
        return [{ name: "get_upcoming_trip", args: {} }];
      case "get_travel_preferences":
        return [{ name: "get_travel_preferences", args: {} }];
      case "update_travel_preferences":
        return [
          {
            name: "update_travel_preferences",
            args: {
              budget: detected.entities.budget,
              travelStyle: detected.entities.category,
              interests: detected.entities.preferences,
            },
          },
        ];
      case "edit_timeline":
        return [{ name: "edit_timeline", args: {} }];
      default:
        return [];
    }
  }

  /**
   * Helper: parse "from X to Y" / "between X and Y" / "how far is X from Y"
   * / "X to Y" out of a raw query. Only used by the degraded fallback path
   * now — the native tool-calling path has Gemini extract origin/
   * destination directly via calculate_distance's schema.
   */
  private parseOriginDestination(query: string): { origin: string; destination: string } {
    const trimmed = query.trim();
    let origin = "";
    let destination = "";

    let match = trimmed.match(/from\s+(.+?)\s+to\s+(.+)/i);
    if (match) {
      origin = match[1].trim();
      destination = match[2].trim();
    }
    if (!origin) {
      match = trimmed.match(/between\s+(.+?)\s+and\s+(.+)/i);
      if (match) {
        origin = match[1].trim();
        destination = match[2].trim();
      }
    }
    if (!origin) {
      match = trimmed.match(/how\s+far\s+is\s+(.+?)\s+from\s+(.+)/i);
      if (match) {
        origin = match[1].trim();
        destination = match[2].trim();
      }
    }
    if (!origin) {
      match = trimmed.match(/^(.+?)\s+to\s+(.+)$/i);
      if (match) {
        origin = match[1].trim();
        destination = match[2].trim();
      }
    }
    return { origin, destination };
  }

  /**
   * A short, accurate confirmation of the edit that was requested.
   *
   * chatController applies the mutations after the agent returns and
   * overwrites this response if application fails, so stating the intended
   * change here is safe: the user only ever sees it on the success path.
   */
  private describeMutations(mutations: any[]): string {
    const parts = (mutations || []).map((m) => {
      const name = m.activityName ? `**${m.activityName}**` : "that activity";
      switch (m.action) {
        case "delete":
        case "remove_activity":
          return `removed ${name} from your itinerary`;
        case "move":
          return `moved ${name}${m.toDay ? ` to day ${m.toDay}` : ""}${m.newTime ? ` (${m.newTime})` : ""}`;
        case "add":
        case "add_activity":
          return `added ${name}${m.toDay ? ` to day ${m.toDay}` : ""}`;
        case "rename":
          return `renamed ${name}${m.newName ? ` to **${m.newName}**` : ""}`;
        case "change_time":
          return `rescheduled ${name}${m.newTime ? ` to ${m.newTime}` : ""}`;
        case "swap_days":
          return `swapped day ${m.day1} and day ${m.day2}`;
        case "swap_activities":
          return `swapped those two activities`;
        case "undo":
          return `undone your last change`;
        case "redo":
          return `redone that change`;
        default:
          return `updated your itinerary`;
      }
    });

    if (parts.length === 0) return "I've updated your itinerary.";
    const joined =
      parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    return `Done — I've ${joined}. ✨`;
  }

  private async timelineEditorNode(
    state: AgentState,
  ): Promise<Partial<AgentState>> {
    console.log("\n✏️ [TIMELINE EDITOR] Generating mutation for:", state.userQuery);
    try {
      // 1. Check for deterministic edit
      const deterministicMutations = DeterministicCommandParser.parse(state.userQuery);
      if (deterministicMutations) {
        console.log("✏️ [TIMELINE EDITOR] Deterministic parser matched.");
        const summary = this.describeMutations(deterministicMutations);
        return {
          mutations: deterministicMutations,
          // `intent` MUST be set: response_formatter only passes state.response
          // through when intent === "edit_timeline". Without it the carefully
          // built confirmation was discarded and the LLM invented a reply
          // instead — which is how a successful delete came back as "I don't
          // have the current itinerary you're looking at".
          intent: "edit_timeline",
          response: summary,
          messages: [new AIMessage(summary)],
        };
      }

      console.log("✏️ [TIMELINE EDITOR] Falling back to Gemini for complex edit.");

      const editorPrompt = `You are an AI Timeline Editor. The user wants to modify their itinerary.
Respond with ONLY a valid JSON array of mutations. Example:
[
  { "action": "move", "activityName": "Hemis Monastery", "toDay": 2, "newTime": "morning" },
  { "action": "add", "activityName": "Louvre", "toDay": 1, "time": "morning" },
  { "action": "delete", "activityName": "Pangong Lake" },
  { "action": "swap_days", "day1": 1, "day2": 2 },
  { "action": "change_time", "activityName": "Lunch", "newTime": "1 PM" },
  { "action": "rename", "activityName": "Breakfast", "newName": "Brunch" },
  { "action": "undo" },
  { "action": "redo" }
]
Actions allowed: move, delete, add, replace, swap_activities, swap_days, change_time, rename, undo, redo.
CRITICAL: Do NOT include markdown backticks. Just pure JSON. Do NOT add any explanation, prose, or surrounding text. Return ONLY the JSON array.
User query: "${state.userQuery}"`;

      const response = await this.model.invoke([
        { role: 'system', content: editorPrompt },
        { role: 'user', content: state.userQuery }
      ]);

      console.log("✏️ [TIMELINE EDITOR] Raw Gemini response object:", JSON.stringify(response, null, 2));

      // 1. Check for max tokens truncation
      const finishReason = response.response_metadata?.finishReason || response.response_metadata?.finish_reason;
      const tokenUsage = response.response_metadata?.tokenUsage || response.response_metadata?.estimatedTokenUsage;

      console.log("✏️ [TIMELINE EDITOR] Generation Stats - Configured maxTokens: 4096, finishReason:", finishReason, ", tokenUsage:", tokenUsage);

      if (finishReason === "MAX_TOKENS" || finishReason === "length") {
        throw new Error(`LLM output was truncated due to token limit (MAX_TOKENS). The JSON is incomplete.`);
      }

      // Correctly extract the text from response.content
      let extractedText = "";
      if (Array.isArray(response.content)) {
        extractedText = response.content.map((c: any) => c.text || JSON.stringify(c)).join("");
      } else {
        extractedText = String(response.content || "");
      }

      console.log("✏️ [TIMELINE EDITOR] Extracted text before parsing:", extractedText);

      // Strip markdown code fences if present
      let cleanedText = extractedText.trim();
      if (cleanedText.startsWith("```")) {
        cleanedText = cleanedText.replace(/^```(json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      }

      const jsonMatch = cleanedText.match(/\[[\s\S]*\]/);
      let mutations = [];
      if (jsonMatch) {
        try {
          mutations = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          console.error("✏️ [TIMELINE EDITOR] JSON parsing failed!");
          console.error("Raw response:", response);
          console.error("Extracted text:", extractedText);
          console.error("Parse error:", parseError);
          throw new Error("Could not parse mutations from LLM response (JSON parse error)");
        }
      } else {
        console.error("✏️ [TIMELINE EDITOR] No JSON array matched in text!");
        console.error("Raw response:", response);
        console.error("Extracted text:", extractedText);
        throw new Error("Could not parse mutations from LLM response (No JSON array found)");
      }

      console.log("✏️ [TIMELINE EDITOR] Mutations:", mutations);

      const summary = this.describeMutations(mutations);
      return {
        mutations: mutations,
        intent: "edit_timeline",
        response: summary,
        messages: [new AIMessage(summary)],
      };
    } catch (error: any) {
      console.error("Timeline Editor error:", error);

      let friendlyError = error.message;
      if (error?.status === 429 || error.message?.includes('429 Too Many Requests') || error.message?.includes('quota')) {
        console.error("🚨 [TIMELINE EDITOR] Quota Exceeded (429)");
        friendlyError = "the AI service is temporarily unavailable due to high demand. Please try again in a few moments.";
      } else if (error.message?.includes('parse') || error.message?.includes('JSON') || error.message?.includes('MAX_TOKENS')) {
        console.error("🚨 [TIMELINE EDITOR] Parser Error: " + error.message);
      } else {
        console.error("🚨 [TIMELINE EDITOR] Mutation Error: " + error.message);
      }

      return {
        error: friendlyError,
        messages: [new AIMessage("I couldn't modify the timeline right now.")],
      };
    }
  }

  /**
   * Response Formatter Node: Creates conversational response from tool results
   */
  private async responseFormatterNode(
    state: AgentState,
  ): Promise<Partial<AgentState>> {
    console.log("\n✍️  [FORMATTER] Generating response...");
    try {
      const { intent, itinerary, toolData, error } = state;

      // Handle errors
      if (error) {
        return { response: `I apologize, but ${error}` };
      }

      // Format response based on what data we have
      let formattedResponse = "";

      if (state.toolRendered) {
        // The tool already rendered its own markdown (see
        // mcp/createDomainServer.ts) — nothing per-tool to do here.
        formattedResponse = state.toolRendered;
      } else if (toolData?.kind === "web_search") {
        // Not a pure function of the payload: needs the query, the RAG
        // context and an LLM call, so it can't live behind the tool boundary.
        formattedResponse = await this.summarizeWebSearch(
          state.userQuery,
          toolData.data,
          state.ragContext
        );
      } else if (toolData) {
        formattedResponse = this.formatToolData(toolData);
      } else if (itinerary) {
        formattedResponse = this.formatItinerary(itinerary);
      } else if (intent === 'edit_timeline' && state.response) {
        formattedResponse = state.response;
      } else {
        // No tool results, use LLM to generate conversational response
        const combinedSystemPrompt = state.ragContext
          ? `${TRAVEL_AGENT_SYSTEM_PROMPT}\n\n${state.ragContext}`
          : TRAVEL_AGENT_SYSTEM_PROMPT;

        const messages = [
          new SystemMessage(combinedSystemPrompt),
          new HumanMessage(state.userQuery),
        ];

        console.log(
          "🤖 [FORMATTER] Calling Gemini with RAG context for conversational response...",
        );

        try {
          const response = await this.model.invoke(messages);

          let contentStr = "";
          if (Array.isArray(response.content)) {
             contentStr = response.content.map((c: any) => c.text || JSON.stringify(c)).join("");
          } else {
             contentStr = String(response.content || "");
          }
          formattedResponse = contentStr;
        } catch (error: any) {
          if (error?.status === 429 || error.message?.includes('429 Too Many Requests') || error.message?.includes('quota')) {
            console.error("🚨 [FORMATTER] Quota Exceeded (429) while generating conversational response");
            formattedResponse = "I apologize, but the AI service is temporarily unavailable due to high demand. Please try again in a few moments.";
          } else {
            console.error("🚨 [FORMATTER] Error generating response:", error);
            formattedResponse = "I apologize, but I encountered an error while processing your request.";
          }
        }
      }

      console.log("✅ [FORMATTER] Response generated successfully\n");
      return { response: formattedResponse };
    } catch (error) {
      console.error("Response formatter error:", error);
      return {
        response:
          "I had trouble formatting the response. Please try asking again.",
      };
    }
  }

  /**
   * Helper: Extract destination name from user query
   */
  private extractDestination(query: string): string {
    const words = query.split(" ");

    // Pattern 1: "attractions in Paris", "things to do in Tokyo"
    const inIndex = words.findIndex((w) => w.toLowerCase() === "in");
    if (inIndex !== -1 && words[inIndex + 1]) {
      return words[inIndex + 1].replace(/[^a-zA-Z]/gi, "");
    }

    // Pattern 2: "visit Paris", "go to Barcelona"
    const prepositions = ["to", "at", "near", "around", "visit"];
    for (let i = 0; i < words.length; i++) {
      if (prepositions.includes(words[i].toLowerCase()) && words[i + 1]) {
        const nextWord = words[i + 1].toLowerCase();
        // Skip common words like "do", "see", "the"
        if (!["do", "see", "the", "a", "an", "some"].includes(nextWord)) {
          return words[i + 1].replace(/[^a-zA-Z]/gi, "");
        }
      }
    }

    // Pattern 3: Look for capitalized words (likely place names)
    const capitalized = query.match(/\b[A-Z][a-z]+\b/g);
    if (capitalized && capitalized.length > 0) {
      return capitalized[capitalized.length - 1];
    }

    // Fallback: return last word
    return words[words.length - 1].replace(/[^a-zA-Z]/gi, "");
  }

  /**
   * Helper: Extract trip duration from user query
   */
  private extractDuration(query: string): number {
    const lowerQuery = query.toLowerCase();

    // Pattern 1: "3-day", "5 day", "7 days"
    const dayMatch = query.match(/(\d+)[-\s]?days?/i);
    if (dayMatch) {
      return parseInt(dayMatch[1]);
    }

    // Pattern 2: "three day", "five days" (word numbers)
    const wordNumbers: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };

    for (const [word, num] of Object.entries(wordNumbers)) {
      if (lowerQuery.includes(`${word} day`)) {
        return num;
      }
    }

    // Pattern 3: "weekend" = 2-3 days
    if (lowerQuery.includes("weekend")) {
      return 3;
    }

    // Pattern 4: "week" = 7 days
    if (lowerQuery.includes("week")) {
      return 7;
    }

    // Default: 3 days
    return 3;
  }

  /**
   * Helper: Extract category/type from query
   * Maps user-friendly terms to OpenTripMap category codes
   */
  private extractCategory(query: string): string | null {
    const queryLower = query.toLowerCase();

    const categoryMap: { [key: string]: string } = {
      beach: "beaches",
      beaches: "beaches",
      restaurant: "foods",
      restaurants: "foods",
      food: "foods",
      dining: "foods",
      eat: "foods",
      museum: "museums",
      museums: "museums",
      park: "natural",
      parks: "natural",
      nature: "natural",
      natural: "natural",
      garden: "natural",
      gardens: "natural",
      monument: "monuments",
      monuments: "monuments",
      church: "religion",
      churches: "religion",
      temple: "religion",
      temples: "religion",
      mosque: "religion",
      mosques: "religion",
      shopping: "shops",
      shop: "shops",
      mall: "shops",
      hotel: "accomodations",
      hotels: "accomodations",
      stay: "accomodations",
      nightlife: "nightlife",
      bar: "nightlife",
      bars: "nightlife",
      club: "nightlife",
      clubs: "nightlife",
    };

    for (const [keyword, category] of Object.entries(categoryMap)) {
      if (queryLower.includes(keyword)) {
        return category;
      }
    }

    return null;
  }

  /**
   * Helper: Format search results into readable text
   */
  private async summarizeWebSearch(
    userQuery: string,
    searchData: any,
    ragContext?: string
  ): Promise<string> {
    const searchSummary = searchData.results
      .map((r: any, i: number) => `${i + 1}. ${r.title}\n${r.snippet}`)
      .join("\n\n");

    const prompt = `
The user asked:

"${userQuery}"

Below are web search results:

${searchSummary}

Answer the user's question naturally.

Rules:
- Do NOT mention "search results".
- Combine information from all sources.
- Ignore duplicate information.
- If multiple sources agree, present that as the answer.
- If there are different opinions, briefly mention them.
- Do not include URLs.
- Write like an experienced travel guide.
`;

    const combinedSystemPrompt = ragContext
      ? `${TRAVEL_AGENT_SYSTEM_PROMPT}\n\n${ragContext}`
      : TRAVEL_AGENT_SYSTEM_PROMPT;

    const messages = [
      new SystemMessage(combinedSystemPrompt),
      new HumanMessage(prompt),
    ];

    const response = await this.model.invoke(messages);

    return response.content as string;
  }

  /**
   * Helper: Format nearby attractions
   */

  /**
   * Format the booking pipeline's own toolData kinds.
   *
   * Every tool-backed capability now renders itself (see
   * mcp/createDomainServer.ts and the per-domain presentation.ts modules), so
   * the only kinds that reach here are the ones written by the booking
   * pipeline rather than by a tool.
   */
  private formatToolData(toolData: { kind: string; data: any }): string {
    const { kind, data } = toolData;
    switch (kind) {
      case "booking_options":
        return formatBookingOptions(data);
      case "booking_confirm_prompt":
        return formatBookingConfirmPrompt(data);
      case "booking_result":
        return formatBookingResult(data);
      case "booking_declined":
        return formatBookingDeclined(data);
      case "trip_plan_complete":
        return formatTripPlanComplete(data);
      case "trip_cancelled":
        return formatTripCancelled(data);
      case "trip_abandoned":
        return formatTripAbandoned(data);
      default:
        return "Here's what I found. ✨";
    }
  }

  /**
   * Helper: Format routing/directions results (get_directions/estimate_route,
   * newly reachable now that dispatch is generic instead of a fixed switch)
   */

  /**
   * Helper: Format itinerary into readable text
   */
  private formatItinerary(itinerary: Itinerary): string {
    const { tripMetadata, days } = itinerary;

    let response = `# 🗺️ ${tripMetadata.duration}-Day ${tripMetadata.destination} Itinerary\n\n`;
    response += `I've created a detailed ${tripMetadata.duration}-day itinerary for your trip to ${tripMetadata.destination}! Here's your personalized plan:\n\n`;
    response += `---\n\n`;

    days.forEach((day) => {
      response += `## 📅 Day ${day.dayNumber}: ${day.title}\n\n`;

      day.timeSlots.forEach((slot) => {
        if (slot.activities.length === 0) return;

        const emoji =
          slot.period === "morning"
            ? "☀️"
            : slot.period === "afternoon"
              ? "🌆"
              : "🌙";
        response += `### ${emoji} ${slot.period.charAt(0).toUpperCase() + slot.period.slice(1)} (${slot.startTime}-${slot.endTime})\n\n`;

        slot.activities.forEach((activity, idx) => {
          response += `**${idx + 1}. ${activity.name}**\n`;
          response += `   ⏱️  Duration: ${activity.duration}\n`;

          if (activity.estimatedCost) {
            response += `   💰 Cost: ${activity.estimatedCost}\n`;
          }

          if (activity.category) {
            response += `   🏷️  Type: ${activity.category}\n`;
          }

          if (activity.description) {
            response += `   📝 ${activity.description.substring(0, 100)}${activity.description.length > 100 ? "..." : ""}\n`;
          }

          response += `\n`;
        });
      });

      response += `---\n\n`;
    });

    response += `\n✨ This itinerary includes ${days.reduce((sum, day) => sum + day.timeSlots.reduce((s, slot) => s + slot.activities.length, 0), 0)} activities across ${days.length} days!\n\n`;
    response += `Would you like me to:\n`;
    response += `- Adjust the schedule\n`;
    response += `- Add more activities\n`;
    response += `- Find accommodations\n`;
    response += `- Get transportation details\n`;

    return response;
  }

  /**
   * Main method: Process user query and return response
   */
  async chat(
    userQuery: string,
    conversationId?: string,
    userId?: string,
    activeTripId?: string,
    timelineVersion?: number,
    mutationId?: string
  ): Promise<any> {
    try {
      console.log(`\n🤖 Processing: "${userQuery}"\n`);

      // Every invoke()/getState() call needs configurable.thread_id now
      // that the graph carries a checkpointer (invoke() throws outright if
      // configurable is entirely undefined). Callers without a
      // conversationId (test scripts) get a private, never-reused thread —
      // resume simply doesn't apply to them, which is fine.
      const threadId = conversationId || uuidv4();
      const config = { configurable: { thread_id: threadId } };

      // Is this thread currently paused on an interrupt (e.g.
      // bookingConfirmNode waiting on a yes/no reply)? Confirmed via direct
      // source read: getState() on a thread_id the checkpointer has never
      // seen resolves to {tasks: []}, it does not throw — the try/catch
      // here is a safety net for genuinely unexpected errors, not a
      // workaround for the "new thread" case.
      //
      // Note: if the *first* message in a booking flow loses the 30s
      // Promise.race timeout in chatController.ts, the abandoned promise
      // may still complete afterwards and record a paused checkpoint here
      // even though the client already got a 500 and Mongo's
      // pendingBooking was never written. The user's next ordinary message
      // would then be silently consumed as an implicit decline instead of
      // processing fresh. Narrow, self-heals after one turn — accepted,
      // not worth reconciliation machinery for this phase.
      let awaitingResume = false;
      try {
        const snapshot = await this.graph.getState(config);
        awaitingResume = (snapshot.tasks || []).some(
          (t: any) => t.interrupts && t.interrupts.length > 0
        );
      } catch {
        awaitingResume = false;
      }

      // ─── RAG Pipeline ─────────────────────────────────────────────────
      // Skipped when resuming: both resume outcomes (booking confirmed or
      // declined) are deterministic toolData formatters that never read
      // ragContext, so running RAG here would burn an embedding-API call
      // for a value that's provably never used. Safe because interrupt()
      // has exactly one call site (bookingConfirmNode) today — revisit if
      // a later phase adds another.
      let ragContext: string | undefined = undefined;
      if (!awaitingResume) {
        try {
          console.log(`🔍 [RAG] Generating embedding for user query...`);
          const queryEmbedding = await generateEmbedding(userQuery);

          console.log(`🔍 [RAG] Retrieving semantic knowledge...`);
          const retrievedDocs = await VectorRetrievalService.retrieveRelevantKnowledge(queryEmbedding, userId);

          console.log(`📝 [RAG] Building prompt context...`);
          ragContext = PromptBuilder.buildRagContextPrompt(retrievedDocs);
        } catch (ragError: any) {
          console.error(`⚠️ [RAG] Pipeline failed, proceeding without context: ${ragError.message}`);
        }
      }
      // ────────────────────────────────────────────────────────────────

      const runInput = awaitingResume
        ? new Command({ resume: userQuery })
        : ({
            messages: [],
            userQuery,
            conversationId,
            ragContext, // Inject RAG context into the state
            timestamp: new Date(),
            intent: undefined,
            itinerary: undefined,
            response: undefined,
            error: undefined,
            toolCalls: undefined,
            bookingRequest: undefined,
            bookingOptions: undefined,
            selectedBookingOption: undefined,
            bookingConfirmed: false,
            tripPlan: undefined,
            tripFlightOptions: undefined,
            tripHotelOptions: undefined,
            toolData: undefined,
            toolRendered: undefined,
            userId,
            mutations: [],
            activeTripId,
            timelineVersion,
            mutationId,
          } satisfies AgentState);

      // Run (or resume) the graph
      const result = await this.graph.invoke(runInput, config);

      // Paused again this run (e.g. a fresh booking confirmation prompt, a
      // slot-fill question, or a confirm-step clarification) —
      // response_formatter was never reached, so result.response doesn't
      // exist. Format directly from the interrupt's payload instead,
      // dispatching on its kind the same way formatToolData dispatches on
      // toolData.kind.
      if (isInterrupted<{ kind: string; request: any; options: any }>(result)) {
        const payload: { kind?: string; request?: any; options?: any; plan?: any } =
          result[INTERRUPT][0].value ?? {};

        // The trip-planning flow's pauses carry their own payload shape and
        // their own cards, so they're returned as pendingTrip rather than
        // being squeezed into pendingBooking's hotel/flight-options shape.
        if (TRIP_INTERRUPT_FORMATTERS[payload.kind as string]) {
          return {
            response: TRIP_INTERRUPT_FORMATTERS[payload.kind as string](payload),
            itinerary: undefined,
            mutations: [],
            error: undefined,
            pendingTrip: { ...payload, awaiting: true, createdAt: new Date() },
          };
        }

        const formatter =
          payload.kind === "booking_slot_fill"
            ? formatBookingSlotFillPrompt
            : payload.kind === "booking_clarify"
              ? formatBookingClarifyPrompt
              : formatBookingConfirmPrompt;
        return {
          response: formatter(payload),
          itinerary: undefined,
          mutations: [],
          error: undefined,
          pendingBooking: {
            type: payload.request?.type,
            destination: payload.request?.destination,
            options: payload.options,
            awaitingConfirmation: true,
            createdAt: new Date(),
          },
        };
      }

      // null clears a resolved booking (confirmed & executed, or
      // declined); undefined means "not a booking turn, don't touch
      // whatever's already there".
      const pendingBooking =
        result.toolData?.kind === "booking_result" || result.toolData?.kind === "booking_declined"
          ? null
          : undefined;

      // Structured booking outcome for this turn, if any — lets the
      // frontend render a real receipt/decline notice instead of
      // re-parsing formatToolData's markdown. Undefined (not present in
      // the response at all) for every non-resolving turn.
      const bookingResult =
        result.toolData?.kind === "booking_result"
          ? { ...result.toolData.data }
          : result.toolData?.kind === "booking_declined"
            ? { declined: true, ...result.toolData.data }
            : undefined;

      // A finished plan hands back the SavedTrip it created so the client can
      // adopt it as the active trip — that id is what makes the existing
      // edit_timeline path able to edit this itinerary by command.
      const tripPlanResult =
        result.toolData?.kind === "trip_plan_complete"
          ? {
              savedTripId: result.toolData.data?.savedTripId || null,
              plan: result.toolData.data?.plan,
            }
          : undefined;

      return {
        response:
          result.response ||
          "I apologize, but I had trouble processing your request.",
        itinerary: result.itinerary,
        mutations: result.mutations,
        error: result.error,
        pendingBooking,
        bookingResult,
        // null clears an in-progress plan card once the flow resolves.
        pendingTrip:
          result.toolData?.kind === "trip_plan_complete" ||
          result.toolData?.kind === "trip_cancelled" ||
          result.toolData?.kind === "trip_abandoned"
            ? null
            : undefined,
        tripPlanResult,
      };
    } catch (error) {
      console.error("Chat error:", error);
      return {
        response: "I encountered an error. Please try again.",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate itinerary with structured trip context
   *NEW: Uses Serp Api web search + Google Places API
   */
  async generateItineraryWithContext(tripContext: any): Promise<any> {
    try {
      console.log('\n🎯 [ENHANCED ITINERARY] Generating with OpenAI web search + Google Places API');

      const { TRAVEL_TYPE_PREFERENCES, calculateDailyBudget } = await import('../types/tripContext.js');
      const { enhancedItineraryBuilder } = await import('../services/enhancedItineraryBuilder.js');

      // Calculate total days from cities
      const totalDays = tripContext.cities.reduce((sum: number, city: any) => sum + city.days, 0);

      // Get daily budget breakdown
      const dailyBudget = calculateDailyBudget(
        tripContext.budget,
        tripContext.budgetMode,
        totalDays
      );

      // Get travel type preferences
      const travelPrefs = TRAVEL_TYPE_PREFERENCES[tripContext.travelType as keyof typeof TRAVEL_TYPE_PREFERENCES];

      console.log('💰 Daily budget:', dailyBudget);
      console.log('🎨 Travel preferences:', travelPrefs);
      console.log('🗓️ Total days:', totalDays);
      console.log('🏙️ Cities:', tripContext.cities.map((c: any) => `${c.name} (${c.days} days)`));

      // Build itineraries for each city using enhanced builder
      const allDays: any[] = [];
      let currentDayNumber = 1;

      for (const city of tripContext.cities) {
        console.log(`\n🌐 [WEB SEARCH] Processing ${city.name} (${city.days} days)`);

        // Use enhanced builder with web search + Google Places
        const cityItinerary = await enhancedItineraryBuilder.buildItineraryWithWebSearch(
          city.name,
          city.days,
          {
            travelType: tripContext.travelType,
            preferences: travelPrefs.categories,
            dailyBudget: dailyBudget.activities,
            activityLevel: travelPrefs.activityLevel,
            pacing: travelPrefs.pacing,
            numberOfPeople: tripContext.people
          }
        );

        if (cityItinerary && cityItinerary.days && cityItinerary.days.some((d: any) => d.timeSlots?.length > 0)) {
          // Add city-specific days to all days
          cityItinerary.days.forEach((day: any) => {
            day.dayNumber = currentDayNumber++;
            day.city = city.name;
            allDays.push(day);
          });

          console.log(`✅ Generated ${cityItinerary.days.length} days for ${city.name}`);
        } else {
          console.warn(`⚠️ Enhanced builder failed for ${city.name}. Falling back to old generation pipeline.`);
          try {
             const fallbackItin = await this.generateItineraryWithContext_OLD({
                 ...tripContext,
                 cities: [city]
             });
             if (fallbackItin && fallbackItin.itinerary && fallbackItin.itinerary.days) {
                 fallbackItin.itinerary.days.forEach((day: any) => {
                     day.dayNumber = currentDayNumber++;
                     day.city = city.name;
                     allDays.push(day);
                 });
                 console.log(`✅ Fallback generated ${fallbackItin.itinerary.days.length} days for ${city.name}`);
             }
          } catch (fallbackError) {
             console.error(`❌ Fallback also failed for ${city.name}:`, fallbackError);
          }
        }
      }

      if (allDays.length === 0) {
        console.warn('⚠️ All generation pipelines failed. Generating a generic empty template to prevent crash.');
        // Prevent fatal failure by creating at least one basic day per city
        tripContext.cities.forEach((city: any) => {
           for (let i=0; i<city.days; i++) {
              allDays.push({
                 dayNumber: currentDayNumber++,
                 city: city.name,
                 title: `Explore ${city.name}`,
                 timeSlots: [],
                 localTip: `Take your time to discover ${city.name}`
              });
           }
        });
      }

      // Create complete itinerary
      const completeItinerary = {
        tripMetadata: {
          destination: tripContext.cities.map((c: any) => c.name).join(' → '),
          duration: totalDays,
          startDate: tripContext.startDate,
          travelType: tripContext.travelType,
          numberOfPeople: tripContext.people,
          budget: {
            total: tripContext.budget.total,
            perDay: dailyBudget.totalPerDay,
            breakdown: dailyBudget
          }
        },
        days: allDays
      };

      // Format the response
      const formattedResponse = this.formatItineraryWithContext(completeItinerary, tripContext);

      console.log(`\n✅ [ENHANCED ITINERARY] Successfully generated ${allDays.length}-day itinerary`);
      console.log(`📊 Total activities: ${allDays.reduce((sum, day) =>
        sum + day.timeSlots.reduce((s: number, slot: any) => s + slot.activities.length, 0), 0)}`);

      return {
        response: formattedResponse,
        itinerary: completeItinerary,
        error: null
      };
    } catch (error) {
      console.error('❌ [ENHANCED ITINERARY] Error:', error);
      return {
        response: null,
        itinerary: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  async generateItineraryWithContext_OLD(tripContext: any): Promise<any> {
    try {
      console.log('\n🎯 [CONTEXT ITINERARY] Generating with full trip context');

      const { TRAVEL_TYPE_PREFERENCES, calculateDailyBudget } = await import('../types/tripContext.js');

      // Calculate total days from cities
      const totalDays = tripContext.cities.reduce((sum: number, city: any) => sum + city.days, 0);

      // Get daily budget breakdown
      const dailyBudget = calculateDailyBudget(
        tripContext.budget,
        tripContext.budgetMode,
        totalDays
      );

      // Get travel type preferences
      const travelPrefs = TRAVEL_TYPE_PREFERENCES[tripContext.travelType as keyof typeof TRAVEL_TYPE_PREFERENCES];

      console.log('💰 Daily budget:', dailyBudget);
      console.log('🎨 Travel preferences:', travelPrefs);
      console.log('🗓️ Total days:', totalDays);
      console.log('🏙️ Cities:', tripContext.cities.map((c: any) => `${c.name} (${c.days} days)`));

      // Collect all places from all cities first for better distribution
      const allCityPlaces: Map<string, any> = new Map();

      for (const city of tripContext.cities) {
        console.log(`\n🔍 Fetching enhanced places for ${city.name}`);

        // Get city coordinates
        const coords = await itineraryBuilder.getDestinationCoords(city.name);
        if (coords) {
          // Fetch enhanced places including hotels and trip-type specific activities
          const cityPlaces = await itineraryBuilder.fetchEnhancedPlaces(
            coords.lat,
            coords.lon,
            travelPrefs.categories,
            tripContext.travelType,
            true // Include hotels
          );

          allCityPlaces.set(city.name, {
            places: cityPlaces,
            coords: coords,
            days: city.days
          });

          console.log(`✅ Found ${cityPlaces.total} enhanced places in ${city.name} (${cityPlaces.activities.length} activities, ${cityPlaces.restaurants.length} restaurants, ${cityPlaces.hotels.length} hotels)`);
        }
      }

      // Build itinerary with intelligent distribution
      const allDays: any[] = [];
      let currentDayNumber = 1;

      // Global tracking to prevent repetition across all days
      const globalUsedPlaces = new Set<string>();

      for (const city of tripContext.cities) {
        const cityData = allCityPlaces.get(city.name);
        if (!cityData) continue;

        console.log(`\n🏙️ Building ${city.days} days for ${city.name}`);

        // Build city-specific itinerary with global state tracking
        const cityItinerary = await itineraryBuilder.buildItineraryWithContextAndState(
          city.name,
          city.days,
          {
            dailyBudget: dailyBudget.activities,
            preferredCategories: travelPrefs.categories,
            activityLevel: travelPrefs.activityLevel,
            pacing: travelPrefs.pacing,
            numberOfPeople: tripContext.people,
            places: cityData.places,
            coords: cityData.coords,
            globalUsedPlaces: globalUsedPlaces, // Pass global state
            startingDayNumber: currentDayNumber
          }
        );

        if (cityItinerary && cityItinerary.days) {
          // Add city-specific days to all days
          cityItinerary.days.forEach((day: any) => {
            day.city = city.name;
            allDays.push(day);
          });

          currentDayNumber += city.days;
        }
      }

      // Create complete itinerary
      const completeItinerary = {
        tripMetadata: {
          destination: tripContext.cities.map((c: any) => c.name).join(' → '),
          duration: totalDays,
          startDate: tripContext.startDate,
          travelType: tripContext.travelType,
          numberOfPeople: tripContext.people,
          budget: {
            total: tripContext.budget.total,
            perDay: dailyBudget.totalPerDay,
            breakdown: dailyBudget
          }
        },
        days: allDays
      };

      // Format the response
      const formattedResponse = this.formatItineraryWithContext(completeItinerary, tripContext);

      console.log(`✅ [CONTEXT ITINERARY] Successfully generated ${allDays.length}-day itinerary`);
      console.log(`📊 Total activities: ${allDays.reduce((sum, day) =>
        sum + day.timeSlots.reduce((s: number, slot: any) => s + slot.activities.length, 0), 0)}`);

      return {
        response: formattedResponse,
        itinerary: completeItinerary,
        error: null
      };

    } catch (error) {
      console.error('❌ Error generating context itinerary:', error);
      return {
        response: null,
        itinerary: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Format itinerary with trip context metadata
   */
  private formatItineraryWithContext(itinerary: any, tripContext: any): string {
    const { tripMetadata, days } = itinerary;
    const cityNames = tripContext.cities.map((c: any) => c.name).join(" → ");

    let response = `# 🗺️ Your ${tripMetadata.duration}-Day ${cityNames} Adventure\n\n`;
    response += `I've crafted a personalized **${tripContext.travelType}** itinerary for ${tripContext.people} ${tripContext.people === 1 ? "traveler" : "travelers"}!\n\n`;

    // Budget summary
    response += `## 💰 Budget Overview\n`;
    response += `- **Total Budget**: $${tripMetadata.budget.total.toLocaleString()}\n`;
    response += `- **Per Day**: $${Math.round(tripMetadata.budget.perDay).toLocaleString()}\n`;
    response += `- **Activities/Day**: $${Math.round(tripMetadata.budget.breakdown.activities).toLocaleString()}\n\n`;

    response += `---\n\n`;

    // Group days by city for multi-city trips
    const daysByCity = days.reduce((acc: any, day: any) => {
      const city = day.city || tripContext.cities[0].name;
      if (!acc[city]) acc[city] = [];
      acc[city].push(day);
      return acc;
    }, {});

    Object.entries(daysByCity).forEach(([city, cityDays]: [string, any]) => {
      if (Object.keys(daysByCity).length > 1) {
        response += `# 🏙️ ${city}\n\n`;
      }

      (cityDays as any[]).forEach((day) => {
        response += `## 📅 Day ${day.dayNumber}: ${day.title}\n\n`;

        day.timeSlots.forEach((slot: any) => {
          if (slot.activities.length === 0) return;

          const emoji =
            slot.period === "morning"
              ? "☀️"
              : slot.period === "afternoon"
                ? "🌆"
                : "🌙";
          response += `### ${emoji} ${slot.period.charAt(0).toUpperCase() + slot.period.slice(1)} (${slot.startTime}-${slot.endTime})\n\n`;

          slot.activities.forEach((activity: any, idx: number) => {
            response += `**${idx + 1}. ${activity.name}**\n`;
            response += `   ⏱️  Duration: ${activity.duration}\n`;

            if (activity.estimatedCost) {
              response += `   💰 Cost: ${activity.estimatedCost}\n`;
            }

            if (activity.category) {
              response += `   🏷️  Type: ${activity.category}\n`;
            }

            if (activity.description) {
              response += `   📝 ${activity.description.substring(0, 100)}${activity.description.length > 100 ? "..." : ""}\n`;
            }

            response += `\n`;
          });
        });

        response += `---\n\n`;
      });
    });

    const totalActivities = days.reduce(
      (sum: number, day: any) =>
        sum +
        day.timeSlots.reduce(
          (s: number, slot: any) => s + slot.activities.length,
          0,
        ),
      0,
    );

    response += `\n✨ Your itinerary includes **${totalActivities} activities** across **${days.length} days**!\n\n`;
    response += `🎯 Optimized for: **${tripContext.travelType} travel**\n`;
    response += `👥 Perfect for: **${tripContext.people} ${tripContext.people === 1 ? "person" : "people"}**\n\n`;

    return response;
  }
}

// Lazy singleton instance - only created when first accessed
let _travelAgentInstance: TravelAgent | null = null;

export function getTravelAgent(): TravelAgent {
  if (!_travelAgentInstance) {
    _travelAgentInstance = new TravelAgent({
      modelName: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
      temperature: 0.7,
    });
  }
  return _travelAgentInstance;
}

// For backward compatibility
export const travelAgent = new Proxy({} as TravelAgent, {
  get(target, prop) {
    return getTravelAgent()[prop as keyof TravelAgent];
  },
});
