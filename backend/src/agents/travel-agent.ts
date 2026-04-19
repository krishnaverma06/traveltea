import { StateGraph, Annotation } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { openTripMapAPI } from "../mcp-servers/places/api.js";
import { itineraryBuilder } from "../services/itineraryBuilder.js";
import { intentDetector } from "./intent-detector.js";
import { toolRegistry } from "./tool-registry.js";
import { TRAVEL_AGENT_SYSTEM_PROMPT } from "./prompts.js";
import type { AgentConfig } from "./types.js";
import type { Destination } from "../mcp-servers/places/types.js";
import type { Itinerary } from "../types/itinerary.js";
import type { DetectedIntent } from "./intent-detector.js";
import {
  formatCategoriesForAPI,
  getCategoryDisplayName,
} from "../config/opentripmap-categories.js";

// RAG Imports
import { generateEmbedding } from "../services/embedding.js";
import { VectorRetrievalService } from "../vector/services/vector-retrieval.service.js";
import { PromptBuilder } from "../vector/utils/prompt-builder.js";

// Deterministic Parser
import { DeterministicCommandParser } from "../utils/deterministicParser.js";

/**
 * Define agent state using Annotation API
 */
const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  userQuery: Annotation<string>({
    reducer: (left, right) => right ?? left,
    default: () => "",
  }),
  intent: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  searchResults: Annotation<Destination[] | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  placeDetails: Annotation<any>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  nearbyAttractions: Annotation<Destination[] | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  categories: Annotation<string[] | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  itinerary: Annotation<Itinerary | null | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  activeTripId: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  timelineVersion: Annotation<number | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  mutationId: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  mutations: Annotation<any[]>({
    reducer: (left, right) => right ?? left,
    default: () => [],
  }),
  response: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  error: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  conversationId: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  ragContext: Annotation<string | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
  timestamp: Annotation<Date | undefined>({
    reducer: (left, right) => right ?? left,
    default: () => undefined,
  }),
});

type AgentState = typeof AgentStateAnnotation.State;

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
  private graph: any; // LangGraph compiled graph

  constructor(config: AgentConfig = {}) {
    // Initialize Gemini model
    this.model = new ChatGoogleGenerativeAI({
      model: config.modelName || process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
      temperature: config.temperature || 0.7,
      maxOutputTokens: config.maxTokens || 4096,
      streaming: config.streaming || false,
      apiKey: process.env.GEMINI_API_KEY,
    });

    // Build the LangGraph workflow
    this.graph = this.buildGraph();
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
      .addNode("response_formatter", this.responseFormatterNode.bind(this))
      .addEdge("__start__", "planner")
      .addConditionalEdges("planner", (state: AgentState) => {
        if (state.intent === "edit_timeline") {
          return "timeline_editor";
        }
        
        // Map new intent types to appropriate actions
        const intentsThatNeedTools = [
          "search_destination",
          "search_attractions",
          "search_hotels",
          "search_flights",
          "search_restaurants",
          "plan_trip",
          "get_details",
          "find_nearby",
          "calculate_distance",
          "get_directions",
          "web_search",
          "estimate_budget",
          // Legacy intents for backward compatibility
          "SEARCH_DESTINATION",
          "GET_DETAILS",
          "FIND_NEARBY",
          "PLAN_TRIP",
        ];

        if (intentsThatNeedTools.includes(state.intent || "")) {
          return "tool_executor";
        }
        // Otherwise, go directly to response formatter for casual chat
        return "response_formatter";
      })
      .addEdge("tool_executor", "response_formatter")
      .addEdge("timeline_editor", "response_formatter")
      .addEdge("response_formatter", "__end__");

    return workflow.compile();
  }

  /**
   * Planner Node: Analyzes user query and decides which tools to use
   * Now uses LLM-based intent detection with category extraction
   */
  private async plannerNode(state: AgentState): Promise<Partial<AgentState>> {
    console.log("\n🧠 [PLANNER] Analyzing user query:", state.userQuery);
    try {
      // Use LLM-based intent detector
      const detectedIntent = await intentDetector.detectIntent(state.userQuery);

      console.log(
        "🎯 [PLANNER] Detected intent:",
        detectedIntent.primary_intent,
      );
      console.log("🔧 [PLANNER] Tools to call:", detectedIntent.tools_to_call);
      console.log(
        "🏷️  [PLANNER] Categories:",
        detectedIntent.entities.opentripmap_kinds,
      );
      console.log("📊 [PLANNER] Confidence:", detectedIntent.confidence);
      console.log("💭 [PLANNER] Reasoning:", detectedIntent.reasoning);

      // Store the detected intent and entities for tool execution
      const intentString = detectedIntent.primary_intent;

      return {
        intent: intentString,
        categories: detectedIntent.entities.opentripmap_kinds || [],
        messages: [new AIMessage(`Understood: ${detectedIntent.reasoning}`)],
      };
    } catch (error) {
      console.error("Planner node error:", error);
      return {
        error: "Failed to analyze your request. Please try again.",
      };
    }
  }

  /**
   * Tool Executor Node: Calls appropriate MCP tools based on intent
   * Now uses detected categories from intent detection
   */
  private async toolExecutorNode(
    state: AgentState,
  ): Promise<Partial<AgentState>> {
    console.log("\n🔧 [TOOL EXECUTOR] Running tools for intent:", state.intent);
    try {
      const { intent, userQuery } = state;

      const detectedCategories = state.categories || [];

      // Map intent to new naming convention if needed
      const normalizedIntent =
        intent?.toLowerCase().replace("_", "_") || "unknown";

      switch (normalizedIntent) {
        case "search_destination":
        case "search_attractions":
        case "search_hotels": {
          // Extract destination and category from query
          const destination = this.extractDestination(userQuery);

          let categories =
            detectedCategories.length > 0
              ? detectedCategories
              : [this.extractCategory(userQuery)].filter(Boolean);

          if (normalizedIntent === "search_hotels") {
            categories = ["accomodations"];
          }

          console.log(
            `🔍 [TOOL] Searching for ${categories.join(", ") || "attractions"} in ${destination}`,
          );

          if (categories.length > 0) {
            // Use the search_by_category tool with detected categories
            const categoryKinds = formatCategoriesForAPI(categories);

            const result = await toolRegistry.executeTool(
              "search_by_category",
              {
                location: destination,
                category: categoryKinds,
                limit: 10,
              },
            );

            const categoryResults = result.content?.[0]?.text
              ? JSON.parse(result.content[0].text).places
              : [];

            console.log(
              `✅ [TOOL] Got ${categoryResults.length} results for categories: ${categories.map(getCategoryDisplayName).join(", ")}`,
            );
            return { searchResults: categoryResults };
          } else {
            // Generic search
            const result = await toolRegistry.executeTool(
              "search_destinations",
              {
                query: destination,
                limit: 10,
              },
            );

            const searchResults = result.content?.[0]?.text
              ? JSON.parse(result.content[0].text).destinations
              : [];

            console.log(`✅ [TOOL] Got ${searchResults.length} results`);
            return { searchResults };
          }
        }

        case "search_restaurants": {
          const destination = this.extractDestination(userQuery);
          console.log(`🍽️ [TOOL] Searching for restaurants in ${destination}`);

          const result = await toolRegistry.executeTool("search_restaurants", {
            location: destination,
            limit: 10,
          });

          const restaurants = result.content?.[0]?.text
            ? JSON.parse(result.content[0].text).restaurants
            : [];

          return { searchResults: restaurants };
        }

        case "find_nearby": {
          // Use coordinates from context or defaults
          const result = await toolRegistry.executeTool(
            "get_nearby_attractions",
            {
              latitude: 48.8584,
              longitude: 2.2945,
              radius: 5000,
              limit: 10,
            },
          );

          const attractions = result.content?.[0]?.text
            ? JSON.parse(result.content[0].text).attractions
            : [];

          return { nearbyAttractions: attractions };
        }

        case "calculate_distance": {
          const query = userQuery.trim();

          let origin = "";
          let destination = "";

          // Pattern: from X to Y
          let match = query.match(/from\s+(.+?)\s+to\s+(.+)/i);

          if (match) {
            origin = match[1].trim();
            destination = match[2].trim();
          }

          // Pattern: between X and Y
          if (!origin) {
            match = query.match(/between\s+(.+?)\s+and\s+(.+)/i);

            if (match) {
              origin = match[1].trim();
              destination = match[2].trim();
            }
          }

          // Pattern: how far is X from Y
          if (!origin) {
            match = query.match(/how\s+far\s+is\s+(.+?)\s+from\s+(.+)/i);

            if (match) {
              origin = match[1].trim();
              destination = match[2].trim();
            }
          }

          // Pattern: X to Y
          if (!origin) {
            match = query.match(/^(.+?)\s+to\s+(.+)$/i);

            if (match) {
              origin = match[1].trim();
              destination = match[2].trim();
            }
          }

          if (!origin || !destination) {
            return {
              error:
                "I couldn't identify the origin and destination. Please try something like 'Distance from Paris to London'.",
            };
          }

          console.log(
            `📏 [TOOL] Calculating distance from "${origin}" to "${destination}"`,
          );

          const result = await toolRegistry.executeTool("calculate_distance", {
            origin,
            destination,
          });

          const distanceData = result.content?.[0]?.text
            ? JSON.parse(result.content[0].text)
            : null;

          return {
            placeDetails: distanceData,
          };
        }

        case "web_search":
        case "search_flights":
        case "get_weather":
        case "convert_currency":
        case "estimate_budget": {
          console.log(`🌐 [TOOL] Web search for: ${userQuery}`);

          const result = await toolRegistry.executeTool("web_search", {
            query: userQuery,
            numResults: 5,
          });

          const searchData = result.content?.[0]?.text
            ? JSON.parse(result.content[0].text)
            : null;

          return {
            placeDetails: searchData,
          };
        }

        case "get_details": {
          if (state.searchResults && state.searchResults.length > 0) {
            const placeId = state.searchResults[0].id;
            console.log(`📄 Getting details for place: ${placeId}`);
            const result = await toolRegistry.executeTool("get_place_details", {
              placeId,
            });

            const details = result.content?.[0]?.text
              ? JSON.parse(result.content[0].text)
              : null;
            return { placeDetails: details };
          }
          return { error: "No place found to get details for." };
        }

        case "plan_trip": {
          // Extract trip parameters from query
          const destination = this.extractDestination(userQuery);
          const duration = this.extractDuration(userQuery);

          console.log(
            `🗓️ [TOOL] Building ${duration}-day itinerary for ${destination}`,
          );

          const itinerary = await itineraryBuilder.buildItinerary(
            destination,
            duration,
          );

          if (itinerary) {
            console.log(
              `✅ [TOOL] Successfully built itinerary with ${itinerary.days.length} days`,
            );
          }

          return { itinerary };
        }

        default:
          console.log("ℹ️  [TOOL] No specific tools needed for this intent");
          return {};
      }
    } catch (error) {
      console.error("Tool executor error:", error);
      return {
        error: "Failed to fetch travel information. Please try again.",
      };
    }
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
        return {
          mutations: deterministicMutations,
          response: "Applying your change...",
          messages: [new AIMessage(`I've made the requested changes to your timeline.`)],
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
      
      return {
        mutations: mutations,
        response: "Updating your timeline...", 
        messages: [new AIMessage(`I've made the requested changes to your timeline.`)],
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
      const {
        intent,
        searchResults,
        nearbyAttractions,
        placeDetails,
        itinerary,
        error,
      } = state;

      // Handle errors
      if (error) {
        return { response: `I apologize, but ${error}` };
      }

      // Format response based on what data we have
      let formattedResponse = "";

      if (itinerary) {
        formattedResponse = this.formatItinerary(itinerary);
      } else if (searchResults && searchResults.length > 0) {
        formattedResponse = this.formatSearchResults(searchResults);
      } else if (nearbyAttractions && nearbyAttractions.length > 0) {
        formattedResponse = this.formatNearbyAttractions(nearbyAttractions);
      } else if (placeDetails) {
        if (intent === "calculate_distance") {
          formattedResponse = this.formatDistance(placeDetails);
        } else if (intent === "web_search") {
          formattedResponse = await this.summarizeWebSearch(
            state.userQuery,
            placeDetails,
            state.ragContext
          );
        } else {
          formattedResponse = this.formatPlaceDetails(placeDetails);
        }
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
  private formatSearchResults(results: any[]): string {
    const count = results.length;
    let response = `I found ${count} amazing places! Here are the highlights:\n\n`;

    results.slice(0, 5).forEach((place, index) => {
      response += `${index + 1}. **${place.name}**\n`;
      response += `   📍 Location: ${place.location.latitude.toFixed(4)}, ${place.location.longitude.toFixed(4)}\n`;

      if (place.category && place.category.length > 0) {
        response += `   🏷️  Categories: ${place.category.slice(0, 3).join(", ")}\n`;
      }

      if (place.rating) {
        response += `   ⭐ Rating: ${place.rating}/7\n`;
      }

      response += "\n";
    });

    response +=
      "\nWould you like more details about any of these places? Just let me know! 🗺️";
    return response;
  }

  /**
   * Helper: Format nearby attractions
   */
  private formatNearbyAttractions(attractions: any[]): string {
    let response = `Here's what I found nearby:\n\n`;

    attractions.slice(0, 5).forEach((place, index) => {
      response += `${index + 1}. **${place.name}**\n`;

      if (place.distance) {
        response += `   📏 Distance: ${place.distance}m\n`;
      }

      if (place.category && place.category.length > 0) {
        response += `   🏷️  ${place.category.slice(0, 2).join(", ")}\n`;
      }

      response += "\n";
    });

    response +=
      "\nThese are all within walking distance! Want to add any to your itinerary? ✨";
    return response;
  }

  /**
   * Helper: Format place details
   */
  private formatDistance(details: any): string {
    if (!details) {
      return "❌ No distance information found.";
    }

    if (details.error) {
      return `❌ ${details.error}`;
    }

    if (!details.distance) {
      console.log("Unexpected distance object:", details);
      return "❌ Invalid distance data received.";
    }

    return `
## 📍 Distance Information

**From:** ${details.origin}
**To:** ${details.destination}

🚗 Distance: ${details.distance.kilometers} km (${details.distance.miles} miles)

⏱️ Estimated Time: ${details.estimated_travel_time.by_car_hours} hours
(${details.estimated_travel_time.by_car_minutes} minutes)
`;
  }
  private formatPlaceDetails(details: any): string {
    let response = `# ${details.name}\n\n`;

    if (details.description) {
      response += `${details.description}\n\n`;
    }

    if (details.rating) {
      response += `⭐ **Rating**: ${details.rating}/7\n`;
    }

    if (details.category && details.category.length > 0) {
      response += `🏷️  **Categories**: ${details.category.join(", ")}\n`;
    }

    if (details.image) {
      response += `\n🖼️ [View Image](${details.image})\n`;
    }

    response += "\nWould you like more details about any of these places? ✨";
    return response;
  }

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

      // ─── RAG Pipeline ─────────────────────────────────────────────────────────
      let ragContext: string | undefined = undefined;
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
      // ────────────────────────────────────────────────────────────────────────

      const initialState: AgentState = {
        messages: [],
        userQuery,
        conversationId,
        ragContext, // Inject RAG context into the state
        timestamp: new Date(),
        intent: undefined,
        searchResults: undefined,
        nearbyAttractions: undefined,
        placeDetails: undefined,
        itinerary: undefined,
        response: undefined,
        error: undefined,
        categories: undefined,
        mutations: [],
        activeTripId,
        timelineVersion,
        mutationId,
      };

      // Run the graph
      const result = await this.graph.invoke(initialState);

      return {
        response:
          result.response ||
          "I apologize, but I had trouble processing your request.",
        itinerary: result.itinerary,
        mutations: result.mutations,
        error: result.error,
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

        console.log(`\n�️ Building ${city.days} days for ${city.name}`);

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
