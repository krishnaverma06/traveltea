import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { getCategoriesFromQuery } from '../config/opentripmap-categories.js';
import { createChatModel } from "../config/llm.js";
import type { AgentConfig } from "./types.js";
import { z } from 'zod';

/**
 * Intent schema for structured output
 */
export const IntentSchema = z.object({
  primary_intent: z.enum([
    'search_destination',
    'search_attractions',
    'search_hotels',
    'search_flights',
    'search_restaurants',
    'plan_trip',
    'get_details',
    'find_nearby',
    'calculate_distance',
    'get_directions',
    'web_search',
    'get_weather',
    'convert_currency',
    'estimate_budget',
    'edit_timeline',
    'search_events',
    'list_saved_trips',
    'get_upcoming_trip',
    'get_travel_preferences',
    'update_travel_preferences',
    'casual_chat',
    'unknown'
  ]).describe('The primary intent of the user query'),
  
  entities: z.object({
    location: z.string().nullish().describe('Main location/destination mentioned'),
    origin: z.string().nullish().describe('Starting location for travel'),
    destination: z.string().nullish().describe('Destination for travel'),
    dates: z.object({
      start: z.string().nullish(),
      end: z.string().nullish(),
    }).nullish().describe('Travel dates in ISO format'),
    duration: z.number().nullish().describe('Number of days for the trip'),
    budget: z.enum(['budget', 'mid-range', 'luxury']).nullish().describe('Budget preference'),
    number_of_people: z.number().nullish().describe('Number of travelers'),
    preferences: z.array(z.string()).nullish().describe('User preferences like adventure, culture, food, etc.'),
    category: z.string().nullish().describe('Category of interest like museums, parks, restaurants'),
    opentripmap_kinds: z.array(z.string()).nullish().describe('OpenTripMap category codes detected from query'),
    query_terms: z.array(z.string()).nullish().describe('Key search terms'),
  }).describe('Extracted entities from the query'),
  
  tools_to_call: z.array(z.string()).describe('List of tools that should be called to fulfill this request'),
  
  confidence: z.number().min(0).max(1).describe('Confidence score for the intent detection'),
  
  reasoning: z.string().describe('Brief explanation of why this intent was chosen'),
});

export type DetectedIntent = z.infer<typeof IntentSchema>;

/**
 * LLM-based Intent Detector
 * Uses GPT to understand user queries and determine which tools to call
 */
export class IntentDetector {
  private model: ChatGoogleGenerativeAI;

  constructor(config: AgentConfig = {}) {
    this.model = createChatModel({
      modelName: config.modelName,
      temperature: config.temperature || 0.7,
      maxOutputTokens: config.maxTokens || 1000,
      streaming: config.streaming || false,
    });
  }

  /**
   * Detect user intent from query with category extraction
   */
  async detectIntent(userQuery: string, conversationHistory?: string[], travelType?: string): Promise<DetectedIntent> {
    try {
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(userQuery, conversationHistory);

      const response = await this.model.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      // Parse the JSON response
      const content = response.content as string;
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const validated = IntentSchema.parse(parsed);

      // Extract OpenTripMap categories from the query
      const detectedCategories = getCategoriesFromQuery(userQuery, travelType);
      validated.entities.opentripmap_kinds = detectedCategories;

      console.log('🎯 [INTENT DETECTOR] Detected:', {
        intent: validated.primary_intent,
        tools: validated.tools_to_call,
        categories: detectedCategories,
        confidence: validated.confidence,
      });

      return validated;
    } catch (error) {
      console.error('Intent detection error:', error);
      
      // Fallback to simple keyword-based detection
      return this.fallbackDetection(userQuery, travelType);
    }
  }

  /**
   * Build system prompt for intent detection
   */
  private buildSystemPrompt(): string {
    return `You are an expert travel assistant intent classifier. Your job is to analyze user queries about travel and determine:
1. What the user wants to do (primary intent)
2. What information they're asking about (entities)
3. Which tools should be called to help them (tools_to_call)

Available Tools:
- search_destinations: Search for cities, countries, or destinations
- search_attractions: Find tourist attractions, monuments, museums
- search_hotels: Find accommodation options
- search_flights: Search for flight options
- search_restaurants: Find dining options
- get_nearby_attractions: Find attractions near a location
- get_place_details: Get detailed info about a specific place
- calculate_distance: Calculate distance between two locations
- get_directions: Get routing/directions
- web_search: Search the web for travel information
- get_weather: Get weather forecast
- convert_currency: Convert between currencies
- estimate_budget: Estimate trip costs
- plan_trip: Create a full itinerary
- search_events: Find concerts, sports, festivals and live events in a city
- list_saved_trips: List the user's own saved trips
- get_upcoming_trip: Find the user's next upcoming or in-progress saved trip
- get_travel_preferences: Read the user's saved travel preferences
- update_travel_preferences: Change the user's saved travel preferences (budget/travel style/interests)
- edit_timeline: Modify an existing itinerary timeline (e.g., "Move Hemis Monastery to tomorrow morning", "Make Day 2 less hectic", "Undo my last change", "Swap Day 1 and Day 2", "Delete lunch")
- search_events: Find concerts, sports, festivals and live events in a city (e.g., "what concerts are on in Lisbon in May")
- list_saved_trips: List the user's own saved trips (e.g., "show my saved trips", "what trips have I saved")
- get_upcoming_trip: Find the user's next upcoming or in-progress saved trip (e.g., "what's my next trip", "when am I travelling next")
- get_travel_preferences: Read the user's saved travel preferences (e.g., "what are my travel preferences")
- update_travel_preferences: Change the user's saved travel preferences — budget level, travel style, or interests (e.g., "set my budget to luxury", "add hiking to my interests"). This is about the user's account-level preferences, NOT about editing an itinerary — do not confuse with edit_timeline, which only modifies a specific trip's day-by-day plan.

Intent Categories:
- search_destination: User wants to explore a destination
- search_attractions: Looking for things to do/see
- search_hotels: Looking for places to stay
- search_flights: Looking for flight options
- search_restaurants: Looking for food/dining
- plan_trip: Wants a full itinerary
- get_details: Wants more info about specific place
- find_nearby: Looking for things near a location
- calculate_distance: Wants distance/travel time
- get_directions: Wants routing information
- web_search: General travel research
- get_weather: Weather information
- convert_currency: Currency conversion
- estimate_budget: Budget planning
- edit_timeline: Modify an existing itinerary's day-by-day plan (a specific trip's timeline)
- search_events: Looking for concerts/sports/festivals/live events in a city
- list_saved_trips: Wants to see their own saved trips
- get_upcoming_trip: Wants to know their next/current trip
- get_travel_preferences: Wants to see their saved account-level preferences
- update_travel_preferences: Wants to change their saved account-level preferences (budget/travel style/interests) — NOT the same as edit_timeline
- casual_chat: Just chatting, no specific intent
- unknown: Cannot determine intent

Respond with ONLY a valid JSON object matching this schema:
{
  "primary_intent": "intent_name",
  "entities": {
    "location": "place name if mentioned",
    "origin": "starting point if mentioned",
    "destination": "destination if mentioned",
    "dates": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "duration": number_of_days,
    "budget": "budget|mid-range|luxury",
    "number_of_people": number,
    "preferences": ["preference1", "preference2"],
    "category": "type of attraction/activity",
    "query_terms": ["search", "terms"]
  },
  "tools_to_call": ["tool1", "tool2"],
  "confidence": 0.0-1.0,
  "reasoning": "why this intent was chosen"
}`;
  }

  /**
   * Build user prompt
   */
  private buildUserPrompt(userQuery: string, conversationHistory?: string[]): string {
    let prompt = `Analyze this user query and determine the intent:\n\nQuery: "${userQuery}"`;

    if (conversationHistory && conversationHistory.length > 0) {
      prompt += `\n\nRecent conversation context:\n${conversationHistory.slice(-3).join('\n')}`;
    }

    prompt += '\n\nProvide your analysis as a JSON object.';
    return prompt;
  }

  /**
   * Fallback intent detection using simple keyword matching.
   * Public: called directly by the planner's native tool-calling path when
   * the LLM call itself fails (quota/network), so it doesn't have to retry
   * the same doomed call via detectIntent() first.
   */
  fallbackDetection(userQuery: string, travelType?: string): DetectedIntent {
    const query = userQuery.toLowerCase();
    let intent: DetectedIntent['primary_intent'] = 'unknown';
    let tools: string[] = [];

    const detectedCategories = getCategoriesFromQuery(userQuery, travelType);
    // Only populated by the update_travel_preferences branch below — the LLM
    // path normally extracts these via IntentSchema.entities, but this is the
    // keyword-fallback path, so preference *values* need their own parsing.
    const preferenceEntities: { budget?: 'budget' | 'mid-range' | 'luxury'; category?: string; preferences?: string[] } = {};

    // Simple keyword matching
    // Account/saved-trip/event checks run first so they don't get shadowed by
    // the broader edit_timeline ("add"/"change") or generic search/show checks below.
    if (/(upcoming|next)\s+trip|when\s+am\s+i\s+(travel(l)?ing|going)/.test(query)) {
      intent = 'get_upcoming_trip';
      tools = ['get_upcoming_trip'];
    } else if (
      /(set|update|change)\s+my\s+(budget|travel\s*style|interests?)/.test(query) ||
      /add\s+.+\s+to\s+my\s+interests/.test(query) ||
      /remove\s+.+\s+(from|in)\s+my\s+interests/.test(query)
    ) {
      intent = 'update_travel_preferences';
      tools = ['update_travel_preferences'];

      const budgetValue = query.match(/\bto\s+(budget|mid-range|mid\s*range|luxury)\b/);
      const styleValue = query.match(/\bto\s+(adventure|relaxation|cultural|business)\b/);
      const interestValue = query.match(/add\s+(.+?)\s+to\s+my\s+interests/);
      if (budgetValue) {
        preferenceEntities.budget = budgetValue[1].replace(/\s+/g, '-') as 'budget' | 'mid-range' | 'luxury';
      }
      if (styleValue) {
        preferenceEntities.category = styleValue[1];
      }
      if (interestValue) {
        preferenceEntities.preferences = [interestValue[1].trim()];
      }
    } else if (/preferences|travel\s*style/.test(query)) {
      intent = 'get_travel_preferences';
      tools = ['get_travel_preferences'];
    } else if (/\bsaved\s+trips?\b|\bmy\s+trips\b/.test(query)) {
      intent = 'list_saved_trips';
      tools = ['list_saved_trips'];
    } else if (/\b(events?|concerts?|gigs?|festivals?)\b/.test(query)) {
      intent = 'search_events';
      tools = ['search_events'];
    } else if (
      query.includes('move') || query.includes('swap') || query.includes('delete') ||
      query.includes('remove') || query.includes('add') || query.includes('undo') || 
      query.includes('redo') || query.includes('rename') || query.includes('replace') ||
      query.includes('less hectic') || query.includes('optimise') || query.includes('balance') ||
      query.includes('shift') || query.includes('reschedule') || query.includes('change time')
    ) {
      intent = 'edit_timeline';
      tools = ['edit_timeline'];
    } else if (query.includes('hotel') || query.includes('accommodation') || query.includes('stay')) {
      intent = 'search_hotels';
      tools = ['search_hotels'];
    } else if (query.includes('flight') || query.includes('fly')) {
      intent = 'search_flights';
      tools = ['search_flights'];
    } else if (query.includes('restaurant') || query.includes('food') || query.includes('eat')) {
      intent = 'search_restaurants';
      tools = ['search_restaurants', 'search_attractions'];
    } else if (query.includes('plan') && query.includes('trip')) {
      intent = 'plan_trip';
      tools = ['search_destinations', 'search_attractions', 'search_hotels', 'search_restaurants'];
    } else if (query.includes('weather')) {
      intent = 'get_weather';
      tools = ['get_weather'];
    } else if (query.includes('distance') || query.includes('how far')) {
      intent = 'calculate_distance';
      tools = ['calculate_distance'];
    } else if (query.includes('nearby') || query.includes('near')) {
      intent = 'find_nearby';
      tools = ['get_nearby_attractions'];
    } else if (query.includes('search') || query.includes('find') || query.includes('show')) {
      intent = 'search_attractions';
      tools = ['search_attractions', 'search_destinations'];
    } else {
      intent = 'casual_chat';
      tools = [];
    }

    return {
      primary_intent: intent,
      entities: {
        query_terms: userQuery.split(' ').filter(word => word.length > 3),
         opentripmap_kinds: detectedCategories,
        ...preferenceEntities,
      },
      tools_to_call: tools,
      confidence: 0.6,  
      reasoning: 'Fallback keyword-based detection with category extraction',
    };
  }
}

// Export singleton instance
export const intentDetector = new IntentDetector();