import { z } from "zod";
import { interrupt } from "@langchain/langgraph";
import { toolRegistry } from "./tool-registry.js";
import * as bookingService from "../services/bookingService.js";
import { createStructuredChatModel } from "../config/llm.js";
import { itineraryBuilder } from "../services/itineraryBuilder.js";
import { TRAVEL_TYPE_PREFERENCES, calculateDailyBudget } from "../types/tripContext.js";
import type { TravelType } from "../types/tripContext.js";
import type { NormalizedFlight, NormalizedHotel } from "../models/travelData.js";
import type { Itinerary } from "../types/itinerary.js";
import { saveItineraryAsTrip } from "../services/tripPersistence.js";
import type { BookingOption } from "./booking-pipeline.js";
import type { AgentState } from "./travel-agent.js";

/**
 * Trip planning pipeline — the fully agent-driven path: the user says they
 * want a trip and the agent takes it from there, collecting destination,
 * dates, budget and trip style in conversation, booking a flight and a
 * hotel, taking payment, and only then generating an itinerary built around
 * what was actually booked. The result is saved as a real SavedTrip so the
 * existing edit_timeline path can edit it by command afterwards.
 *
 * ── Why this is six nodes and not one ────────────────────────────────────
 *
 * LangGraph resumes an interrupted run by re-invoking the *paused node* from
 * the top; already-resolved interrupt() calls return their stored value
 * instead of pausing again, so every line before them re-executes. A single
 * node doing "collect -> search -> book -> pay -> generate" would therefore
 * re-run createBooking on every later resume and double-book the user.
 *
 * Nodes that have already returned are checkpointed and never re-run, so the
 * pipeline is split so that each node contains at most one interrupt point,
 * and — the rule that actually matters — **every side effect sits after the
 * last interrupt in its node**. Code after the final interrupt runs exactly
 * once, because a paused node stopped before reaching it.
 *
 * ── Collection is a self-loop, not an in-node loop ────────────────────────
 *
 * tripCollectNode asks for exactly one field per execution and returns the
 * merged plan, with a conditional edge back to itself while anything is
 * still missing. Looping *inside* the node instead would work, but each
 * resume would replay every previous slot's extraction LLM call — O(n²)
 * tokens over a six-field flow. Returning between questions checkpoints the
 * progress, so each answer costs exactly one extraction call.
 *
 * ── Guided but flexible ──────────────────────────────────────────────────
 *
 * The extractor is multi-slot, not single-field: it's asked about the whole
 * plan on every reply, so "Goa for 5 days in December, about ₹80k, honeymoon"
 * fills four slots at once, and a later "actually make it 7 days" revises an
 * answer already given. The node only ever *asks* for the first missing
 * field; it never refuses information offered out of order.
 */

export interface TripPlan {
  destination?: string;
  origin?: string;
  startDate?: string;   // YYYY-MM-DD
  days?: number;
  budget?: number;      // total for the trip, in USD
  travelType?: TravelType;
  travelers?: number;
  /** What the traveller wants to prioritise — free text, mapped to categories. */
  priorities?: string[];
  /**
   * Set when the user says they'll arrange their own travel. Distinct from
   * `origin` simply being absent: without it, "I'm driving there" would leave
   * the origin question unanswered and the flow would keep asking.
   */
  noFlightNeeded?: boolean;

  // Booking progress
  skipFlight?: boolean;
  skipHotel?: boolean;
  flightOption?: BookingOption;
  flightBookingId?: string;
  hotelOption?: BookingOption;
  hotelBookingId?: string;

  // Outcome
  paid?: boolean;
  savedTripId?: string;

  // Guard against an endless question loop when a user keeps replying
  // with things that aren't answers.
  asked?: number;
}

const ok = <T extends Partial<AgentState>>(partial: T) => partial;

/**
 * Everything the flow needs before it can plan and book a trip, asked in the
 * order a person would naturally give it: where, when, how long, who, how
 * much, what kind, what matters most, and where from.
 *
 * `origin` is required but satisfiable two ways — either a departure city, or
 * saying they'll arrange their own travel (`noFlightNeeded`). See
 * firstMissingField.
 */
const REQUIRED: Array<keyof TripPlan> = [
  "destination",
  "startDate",
  "days",
  "travelers",
  "budget",
  "travelType",
  "priorities",
  "origin",
];

const QUESTIONS: Record<string, string> = {
  destination: "Where would you like to go?",
  startDate: "When does the trip start?",
  days: "How many days will you be travelling for?",
  travelers: "How many people are travelling?",
  budget: "Roughly what's your total budget for the trip?",
  travelType:
    "What kind of trip is this — leisure, adventure, cultural, family, business, or solo?",
  priorities:
    "What matters most to you on this trip? (for example: food, museums and history, beaches, nightlife, nature and hiking, shopping, or just relaxing)",
  origin:
    "Last one — which city will you be flying from? If you're arranging your own travel, just say so and I'll skip flights.",
};

// One more than the number of required fields, so a single misunderstood
// answer doesn't end the flow, but a user who keeps replying off-topic isn't
// questioned forever.
const MAX_QUESTIONS = REQUIRED.length + 4;

/**
 * Floor for the per-day activity budget the itinerary is planned against,
 * in USD. Not a spending recommendation — purely a guard so that a trip whose
 * flight and hotel ate the whole budget still gets a real itinerary instead
 * of only the handful of free entries a $0/day budget leaves selectable.
 */
const MIN_ACTIVITY_BUDGET_PER_DAY = 30;

export function firstMissingField(plan: TripPlan | undefined): keyof TripPlan | null {
  const p = plan || {};
  for (const field of REQUIRED) {
    // Two ways to answer the origin question: name a city, or decline flights.
    if (field === "origin" && p.noFlightNeeded) continue;

    const value = p[field];
    if (value === undefined || value === null || value === "") return field;
    // An empty priorities array is an unanswered question, not an answer.
    if (Array.isArray(value) && value.length === 0) return field;
  }
  return null;
}

export function tripPlanIsComplete(plan: TripPlan | undefined): boolean {
  return firstMissingField(plan) === null;
}

/**
 * Map the traveller's stated priorities onto OpenTripMap category keys.
 *
 * The travel type alone (leisure/cultural/...) is a coarse bucket; two people
 * on a "leisure" trip who care about food versus hiking should not get the
 * same day plan. Unrecognised words are dropped rather than passed through —
 * an invalid category makes the place lookup return nothing at all.
 */
const PRIORITY_CATEGORIES: Record<string, string[]> = {
  food: ["restaurants", "cafes", "foods"],
  restaurants: ["restaurants", "foods"],
  cafes: ["cafes"],
  nightlife: ["theatres_and_entertainments", "restaurants"],
  museums: ["museums", "cultural"],
  history: ["historic", "museums", "architecture"],
  historic: ["historic", "architecture"],
  art: ["museums", "cultural"],
  architecture: ["architecture", "historic"],
  temples: ["religion", "historic"],
  religion: ["religion"],
  beaches: ["beaches", "natural"],
  beach: ["beaches", "natural"],
  nature: ["natural", "parks"],
  hiking: ["natural", "sport"],
  wildlife: ["natural"],
  parks: ["parks", "natural"],
  adventure: ["sport", "climbing", "natural"],
  sport: ["sport"],
  shopping: ["shopping"],
  relaxing: ["beaches", "parks", "natural"],
  relaxation: ["beaches", "parks", "natural"],
  photography: ["interesting_places", "architecture", "natural"],
  sightseeing: ["interesting_places", "architecture"],
  family: ["amusement_parks", "parks"],
};

export function categoriesForPriorities(priorities: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const raw of priorities || []) {
    const key = String(raw).trim().toLowerCase();
    const mapped = PRIORITY_CATEGORIES[key];
    if (mapped) {
      mapped.forEach((c) => out.add(c));
      continue;
    }
    // Substring match catches "museums and history" style answers the
    // extractor didn't split cleanly.
    for (const [word, cats] of Object.entries(PRIORITY_CATEGORIES)) {
      if (key.includes(word)) cats.forEach((c) => out.add(c));
    }
  }
  return [...out];
}

/**
 * Parse a slot date into a real UTC Date, or null.
 *
 * `startDate` comes from an LLM, so it is not guaranteed to be a valid
 * YYYY-MM-DD however firmly the schema asks for one — it can arrive as
 * "next month", an empty string, or a malformed day. Every downstream use
 * (`tripEndDate`, `checkOutDate`, stamping dates onto days, the SavedTrip's
 * own startDate) fed it straight into `new Date(...).toISOString()`, which
 * throws RangeError on an invalid value. That crashed the hotel search and
 * then the itinerary node, losing a trip that had otherwise been built.
 */
export function parseTripDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const d = new Date(`${value.trim()}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Rejects impossible days that JS would otherwise roll over (2026-02-31).
  return d.toISOString().slice(0, 10) === value.trim() ? d : null;
}

/** Trip start as a Date, falling back to today so no caller can throw. */
function tripStart(plan: TripPlan): Date {
  return parseTripDate(plan.startDate) ?? new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
}

/** Last day of the trip, inclusive — the hotel's check-out / return date. */
export function tripEndDate(plan: TripPlan): string {
  const start = tripStart(plan);
  start.setUTCDate(start.getUTCDate() + Math.max((plan.days || 1) - 1, 0));
  return start.toISOString().slice(0, 10);
}

/** Check-out is the morning after the last night. */
function checkOutDate(plan: TripPlan): string {
  const start = tripStart(plan);
  start.setUTCDate(start.getUTCDate() + Math.max(plan.days || 1, 1));
  return start.toISOString().slice(0, 10);
}

const TRAVEL_TYPES = [
  "leisure",
  "business",
  "adventure",
  "cultural",
  "family",
  "solo",
] as const;

/**
 * Multi-slot extraction from one free-text reply.
 *
 * Every field is optional and the model is shown the plan so far, so a reply
 * can fill several slots at once, fill none (an off-topic message), or
 * *revise* an earlier answer — which is what makes the flow flexible rather
 * than a rigid form. Fields the reply doesn't mention are omitted and the
 * caller keeps the existing value.
 *
 * .optional() rather than .nullable() throughout, for the same reason as
 * booking-pipeline.ts's extractBookingField: .nullable() compiles to a JSON
 * Schema type-array, which some Gemini models' response_schema validation
 * rejects outright.
 */
const TripSlotSchema = z.object({
  destination: z
    .string()
    .optional()
    .describe("The city or place they want to travel TO. Omit if not mentioned."),
  origin: z
    .string()
    .optional()
    .describe("The city they are travelling FROM / flying out of. Omit if not mentioned."),
  startDate: z
    .string()
    .optional()
    .describe("Trip start date resolved to YYYY-MM-DD. Omit if no usable date is mentioned."),
  days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("Trip length in days. Omit if not mentioned."),
  budget: z
    .number()
    .optional()
    .describe(
      "Total trip budget as a plain number in US dollars. Convert other currencies to an approximate USD amount (₹80,000 -> 950, €1,200 -> 1300). Omit if no budget is mentioned.",
    ),
  travelType: z
    .enum(TRAVEL_TYPES)
    .optional()
    .describe(
      "The intent/style of the trip, mapped to the closest option: honeymoon/romantic/relaxing/beach -> leisure; hiking/trekking/skiing/roadtrip -> adventure; history/museums/art/food-and-culture -> cultural; kids/family -> family; work/conference -> business; travelling alone -> solo. Omit if not mentioned.",
    ),
  travelers: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe(
      "How many people are travelling in total. 'me and my wife' -> 2, 'solo' -> 1, 'family of four' -> 4. Omit if not mentioned.",
    ),
  priorities: z
    .array(z.string())
    .optional()
    .describe(
      "What the traveller wants to prioritise, as short lowercase keywords drawn from what they actually said: food, museums, history, architecture, beaches, nature, hiking, nightlife, shopping, relaxing, adventure, photography, temples, wildlife, art. Omit if they haven't said what they care about.",
    ),
  noFlightNeeded: z
    .boolean()
    .optional()
    .describe(
      "True whenever they indicate no flight should be booked, wherever it appears in their message: 'no flights needed', 'we're driving', 'taking the train', 'I already have flights', 'skip flights', 'arranging my own travel'.",
    ),
  cancel: z
    .boolean()
    .optional()
    .describe("True only if the user wants to abandon planning this trip entirely."),
  unrelated: z
    .boolean()
    .optional()
    .describe(
      "True if the reply is not an answer to the question at all — a new question or request about something else (the weather, a different city they are NOT proposing as the destination, a general travel query). False when they are answering, even partially or indirectly.",
    ),
});

async function extractTripSlots(
  reply: string,
  plan: TripPlan,
  askedField: string,
  todayISO: string,
): Promise<Partial<TripPlan> & { cancel?: boolean; unrelated?: boolean }> {
  const known = Object.entries({
    destination: plan.destination,
    origin: plan.origin,
    startDate: plan.startDate,
    days: plan.days,
    budget: plan.budget,
    travelType: plan.travelType,
    travelers: plan.travelers,
    priorities: plan.priorities?.join(", "),
  })
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const prompt = `You are collecting details for a trip. Today's date is ${todayISO}; resolve every relative date ("next month", "first week of December") against it.

Details known so far:
${known || "(nothing yet)"}

The user was asked: "${QUESTIONS[askedField] || askedField}"
They replied: "${reply}"

Extract every trip detail their reply contains — not only the field they were asked about. If they correct or change something already known, return the new value. Omit any field their reply doesn't mention.`;

  try {
    const model = createStructuredChatModel(TripSlotSchema, { temperature: 0 });
    const result = (await model.invoke(prompt)) as Partial<TripPlan> & {
      cancel?: boolean;
      unrelated?: boolean;
    };

    // An off-topic reply must not be mined for slots. Without this, "what's the
    // weather in Tokyo?" asked mid-collection was read as an answer and
    // silently REWROTE the destination from Porto to Tokyo — the user would
    // then have been booked into the wrong city.
    if (result.unrelated) return { unrelated: true };

    // Strip omitted/blank fields so a merge never overwrites a good value
    // with an empty one.
    const cleaned: Partial<TripPlan> & { cancel?: boolean; unrelated?: boolean } = {};
    for (const [key, value] of Object.entries(result)) {
      if (value === undefined || value === null || value === "") continue;
      // A date the model returned in some other shape ("next month", an
      // impossible day) is dropped rather than stored — leaving the slot
      // unfilled makes the flow ask again, which is recoverable, whereas
      // storing it throws several steps later when nothing can be undone.
      if (key === "startDate" && !parseTripDate(String(value))) {
        console.warn(`Discarding unparseable startDate from extraction: ${JSON.stringify(value)}`);
        continue;
      }
      (cleaned as any)[key] = value;
    }
    return cleaned;
  } catch (err) {
    console.error("Trip slot extraction failed:", err);
    return {};
  }
}

/**
 * collect: ask for the first missing field, merge whatever the reply yields,
 * and return. The graph's conditional edge routes back here while anything
 * required is still missing — see the file header for why this is a self-loop
 * rather than a loop inside the node.
 */
export async function tripCollectNode(state: AgentState): Promise<Partial<AgentState>> {
  // Seed from the planner's tool args on the first pass, so "plan me a 5-day
  // trip to Goa" doesn't ask for what the user already said.
  let plan: TripPlan = state.tripPlan || seedPlanFromToolCall(state);

  const missing = firstMissingField(plan);
  if (!missing) return ok({ tripPlan: plan });

  if ((plan.asked || 0) >= MAX_QUESTIONS) {
    return ok({
      tripPlan: plan,
      error:
        "I'm having trouble pinning down the trip details. Try telling me all at once — for example: \"7 days in Lisbon from 12 December, budget $2000, cultural trip\".",
    });
  }

  const reply = interrupt({
    kind: "trip_slot",
    field: missing,
    plan,
    asked: plan.asked || 0,
  });

  const todayISO = new Date().toISOString().slice(0, 10);
  const extracted = await extractTripSlots(String(reply ?? ""), plan, String(missing), todayISO);

  if (extracted.cancel) {
    return ok({
      tripPlan: plan,
      toolData: { kind: "trip_cancelled", data: { plan } },
    });
  }

  // They asked about something else entirely. Re-prompting would hold their
  // next few messages hostage to a question they have moved past — the same
  // failure the option lists avoid via their "abandon" branch. Release it.
  if (extracted.unrelated) {
    return ok({
      tripPlan: plan,
      toolData: { kind: "trip_abandoned", data: { plan, stage: "details" } },
    });
  }

  delete extracted.cancel;
  delete extracted.unrelated;

  plan = { ...plan, ...extracted, asked: (plan.asked || 0) + 1 };
  return ok({ tripPlan: plan });
}

function seedPlanFromToolCall(state: AgentState): TripPlan {
  const call = (state.toolCalls || []).find((c) => c.name === "plan_full_trip");
  const args = call?.args || {};
  const plan: TripPlan = {};
  if (args.destination) plan.destination = args.destination;
  if (args.origin) plan.origin = args.origin;
  // Validated, not trusted: the planner is an LLM too, and has been observed
  // emitting a doubled value ("2026-09-05,2026-09-05") that then crashed every
  // downstream date call. An unusable seed is dropped so the flow simply asks.
  if (args.startDate && parseTripDate(String(args.startDate))) {
    plan.startDate = String(args.startDate).trim();
  }
  if (args.days) plan.days = args.days;
  if (args.budget) plan.budget = args.budget;
  if (args.travelType) plan.travelType = args.travelType;
  if (args.travelers) plan.travelers = args.travelers;
  if (Array.isArray(args.priorities) && args.priorities.length) plan.priorities = args.priorities;
  return plan;
}

/**
 * flight search. Needs an origin, which isn't in REQUIRED — a user who only
 * wants the hotel and the plan shouldn't be forced to name a departure city
 * — so a missing origin skips flights rather than blocking the flow. The
 * user is told, and can still book a flight separately.
 */
export async function tripFlightSearchNode(state: AgentState): Promise<Partial<AgentState>> {
  const plan = state.tripPlan;
  if (!plan) return {};

  // No origin, or they told us they're arranging their own travel.
  if (!plan.origin || plan.noFlightNeeded) {
    return ok({ tripPlan: { ...plan, skipFlight: true }, tripFlightOptions: [] });
  }

  try {
    const result = await toolRegistry.executeTool("search_flights", {
      origin: plan.origin,
      destination: plan.destination,
      departDate: plan.startDate,
      returnDate: tripEndDate(plan),
      adults: plan.travelers || 1,
    });
    const payload = result?.content?.[0]?.text ? JSON.parse(result.content[0].text) : null;

    if (!payload || result.isError || payload.error) {
      return ok({ tripPlan: { ...plan, skipFlight: true }, tripFlightOptions: [] });
    }

    const flights: NormalizedFlight[] = payload.flights || [];
    const options: BookingOption[] = flights.slice(0, 5).map((f) => ({
      id: f.id,
      type: "flight",
      name: `${f.airline} — ${f.departure.iata} → ${f.arrival.iata}`,
      price: f.price,
      priceNote: `${f.duration}, ${f.stops === 0 ? "nonstop" : `${f.stops} stop${f.stops > 1 ? "s" : ""}`}`,
    }));

    return ok({
      tripPlan: { ...plan, skipFlight: options.length === 0 },
      tripFlightOptions: options,
    });
  } catch (err) {
    console.error("Trip flight search failed:", err);
    return ok({ tripPlan: { ...plan, skipFlight: true }, tripFlightOptions: [] });
  }
}

const PickSchema = z.object({
  decision: z
    .enum(["pick", "skip", "abandon", "unclear"])
    .describe(
      "pick: they chose one of the numbered options. " +
        "skip: they don't want to book this one thing, but are still planning the trip (no thanks / skip it / I've already got a flight). " +
        "abandon: they've dropped the trip entirely, or moved on to something unrelated — a different city, the weather, a general question — with no reference to the options at all. " +
        "unclear: they're still engaging with the options but ambiguously (a question about them, a vague reply).",
    ),
  optionNumber: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "The 1-based option NUMBER they referenced, exactly as numbered in the list they were shown. Omit if they didn't reference a specific option.",
    ),
});

/**
 * Classify a reply to a numbered option list. The list shown to the model is
 * 1-based, matching what the user read; the single 0-based conversion happens
 * in the caller — the same discipline (and for the same reason) as
 * booking-pipeline.ts's classifyBookingDecision.
 */
async function classifyPick(
  reply: string,
  options: BookingOption[],
  what: string,
): Promise<{ decision: "pick" | "skip" | "abandon" | "unclear"; optionNumber?: number }> {
  const list = options
    .map((o, i) => `${i + 1}: ${o.name}${o.price ? ` (${o.price.currency} ${o.price.amount})` : ""}`)
    .join("\n");
  try {
    const model = createStructuredChatModel(PickSchema, { temperature: 0 });
    return await model.invoke(
      `The user was shown this numbered list of ${what} options:\n${list}\n\nThey were asked to pick one or skip. They replied: "${reply}"\n\nClassify their reply.`,
    );
  } catch (err) {
    console.error("Trip option pick classification failed:", err);
    return { decision: "unclear" };
  }
}

/**
 * Shared select-then-book step for the flight and hotel stages.
 *
 * createBooking sits after the last interrupt() on purpose — a node that
 * pauses never reaches the code below its interrupt, so the booking is
 * created exactly once no matter how many times the node replays. See the
 * file header.
 */
async function selectAndBook(
  state: AgentState,
  kind: "flight" | "hotel",
  options: BookingOption[],
): Promise<Partial<AgentState>> {
  const plan = state.tripPlan;
  if (!plan) return {};

  const skipKey = kind === "flight" ? "skipFlight" : "skipHotel";
  if (options.length === 0) {
    return ok({ tripPlan: { ...plan, [skipKey]: true } });
  }

  let picked: BookingOption | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = interrupt({
      kind: kind === "flight" ? "trip_flight_options" : "trip_hotel_options",
      plan,
      options,
      attempt,
    });
    const classified = await classifyPick(String(reply ?? ""), options, kind);

    if (classified.decision === "skip") {
      return ok({ tripPlan: { ...plan, [skipKey]: true } });
    }
    if (classified.decision === "abandon") {
      // The user has moved on. Re-prompting would hold their next messages
      // hostage to a list they've abandoned — the same failure mode
      // bookingConfirmNode's "unrelated" branch exists to avoid. Release the
      // flow and say plainly what is and isn't booked.
      return ok({
        toolData: {
          kind: "trip_abandoned",
          data: { plan, stage: kind },
        },
      });
    }
    if (classified.decision === "pick") {
      const index =
        classified.optionNumber !== undefined
          ? Math.min(Math.max(classified.optionNumber - 1, 0), options.length - 1)
          : 0;
      picked = options[index];
      break;
    }
    // unclear — re-prompt once.
  }

  if (!picked) {
    return ok({ tripPlan: { ...plan, [skipKey]: true } });
  }

  if (!state.userId) {
    return ok({ error: "you'll need to be signed in for me to book anything." });
  }

  const request =
    kind === "flight"
      ? {
          type: "flight" as const,
          origin: plan.origin,
          destination: plan.destination || "",
          departDate: plan.startDate,
          returnDate: tripEndDate(plan),
          guests: plan.travelers || 1,
          confirmed: true,
        }
      : {
          type: "hotel" as const,
          destination: plan.destination || "",
          checkIn: plan.startDate,
          checkOut: checkOutDate(plan),
          guests: plan.travelers || 1,
          confirmed: true,
        };

  try {
    const booking = await bookingService.createBooking(state.userId, {
      type: kind,
      option: picked,
      request,
      source: "chat",
      conversationId: state.conversationId,
    });
    const bookingId = (booking._id as { toString(): string }).toString();

    return ok({
      tripPlan:
        kind === "flight"
          ? { ...plan, flightOption: picked, flightBookingId: bookingId }
          : { ...plan, hotelOption: picked, hotelBookingId: bookingId },
    });
  } catch (err) {
    console.error(`Trip ${kind} booking creation failed:`, err);
    return ok({ tripPlan: { ...plan, [skipKey]: true } });
  }
}

export async function tripFlightSelectNode(state: AgentState): Promise<Partial<AgentState>> {
  return selectAndBook(state, "flight", state.tripFlightOptions || []);
}

export async function tripHotelSearchNode(state: AgentState): Promise<Partial<AgentState>> {
  const plan = state.tripPlan;
  if (!plan) return {};

  try {
    const result = await toolRegistry.executeTool("search_hotels", {
      destination: plan.destination,
      checkIn: plan.startDate,
      checkOut: checkOutDate(plan),
      adults: plan.travelers || 1,
    });
    const payload = result?.content?.[0]?.text ? JSON.parse(result.content[0].text) : null;

    if (!payload || result.isError || payload.error) {
      return ok({ tripPlan: { ...plan, skipHotel: true }, tripHotelOptions: [] });
    }

    const hotels: NormalizedHotel[] = payload.hotels || [];
    const options: BookingOption[] = hotels.slice(0, 5).map((h) => ({
      id: h.id,
      type: "hotel",
      name: h.name,
      location: h.location,
      rating: h.rating,
      image: h.image || undefined,
      price: h.price,
      // Built conditionally: SerpAPI often returns no address, and blindly
      // interpolating one left a dangling "per night, " that then rendered
      // as literal underscores once the formatter italicised it.
      priceNote: [h.price ? "per night" : "Live pricing unavailable", h.address]
        .filter(Boolean)
        .join(" · "),
    }));

    return ok({
      tripPlan: { ...plan, skipHotel: options.length === 0 },
      tripHotelOptions: options,
    });
  } catch (err) {
    console.error("Trip hotel search failed:", err);
    return ok({ tripPlan: { ...plan, skipHotel: true }, tripHotelOptions: [] });
  }
}

export async function tripHotelSelectNode(state: AgentState): Promise<Partial<AgentState>> {
  return selectAndBook(state, "hotel", state.tripHotelOptions || []);
}

/**
 * payment.
 *
 * The bookings already exist (created by the select nodes) in
 * `pending_payment`. This node hands the frontend their ids and pauses; the
 * inline payment panel posts card/UPI/netbanking details **straight to
 * POST /api/bookings/:id/pay**, never through a chat message — chat messages
 * are persisted verbatim to Mongo and replayed to the model, which is no
 * place for payment details. The panel then sends a plain message to resume
 * this node, and the node re-reads the bookings from the database to decide
 * whether payment actually succeeded. The user's word is never the evidence.
 */
export async function tripPaymentNode(state: AgentState): Promise<Partial<AgentState>> {
  const plan = state.tripPlan;
  if (!plan) return {};

  const bookingIds = [plan.flightBookingId, plan.hotelBookingId].filter(Boolean) as string[];
  if (bookingIds.length === 0 || !state.userId) {
    return ok({ tripPlan: { ...plan, paid: false } });
  }

  // Two attempts: the panel can be dismissed, or a card can be declined, and
  // a single missed payment shouldn't silently drop the user into an
  // itinerary for bookings they never paid for.
  for (let attempt = 0; attempt < 2; attempt++) {
    const bookings = await readBookings(bookingIds, state.userId);
    const outstanding = bookings.filter((b) => b.status === "pending_payment");

    // Already settled — never ask for money twice.
    if (bookings.length === bookingIds.length && outstanding.length === 0) {
      return ok({ tripPlan: { ...plan, paid: true } });
    }

    interrupt({
      kind: "trip_payment",
      plan,
      attempt,
      bookings: outstanding.map((b: any) => ({
        id: b._id.toString(),
        type: b.type,
        reference: b.bookingReference,
        name: b.option?.name,
        price: b.option?.price,
      })),
    });
    // Loop: the next iteration re-reads from the database rather than
    // trusting the reply text — the user saying "done" is not evidence.
  }

  const final = await readBookings(bookingIds, state.userId);
  const paid = final.length === bookingIds.length && final.every((b) => b.status === "confirmed");
  return ok({ tripPlan: { ...plan, paid } });
}

/** getBooking returns {booking, transactions}|null — this flow only wants the bookings. */
async function readBookings(bookingIds: string[], userId: string): Promise<any[]> {
  const results = await Promise.all(
    bookingIds.map((id) =>
      bookingService.getBooking(id, userId).catch((err) => {
        console.error(`Reading booking ${id} failed:`, err);
        return null;
      }),
    ),
  );
  return results.map((r) => r?.booking).filter(Boolean);
}

/**
 * itinerary: build it around what was actually booked, save it as a real
 * SavedTrip, and hand the id back so the frontend can adopt it as the active
 * trip — which is what makes the existing edit_timeline path able to edit
 * this itinerary by command afterwards.
 */
export async function tripItineraryNode(state: AgentState): Promise<Partial<AgentState>> {
  const plan = state.tripPlan;
  if (!plan || !tripPlanIsComplete(plan)) {
    return ok({ error: "I don't have enough trip details yet to build an itinerary." });
  }

  const travelType = (plan.travelType || "leisure") as TravelType;
  const prefs = TRAVEL_TYPE_PREFERENCES[travelType];
  const days = plan.days || 1;
  const travelers = plan.travelers || 1;

  // The itinerary is planned around the money left after flights and the
  // hotel, not the headline budget — otherwise a trip that spent most of its
  // budget on a flight gets an itinerary it can't afford.
  const spent = bookedSpend(plan);
  const remaining = (plan.budget || 0) - spent;

  // ...but never plan against literally nothing. A $0/day activity budget
  // makes the builder reject every priced attraction, so an over-budget trip
  // came back as a handful of free entries repeated across the days rather
  // than a real plan. Fall back to a modest floor and say so instead.
  const planningBudget = Math.max(remaining, MIN_ACTIVITY_BUDGET_PER_DAY * days);
  const dailyBudget = calculateDailyBudget(
    { total: planningBudget, travel: 0, accommodation: 0, food: 40, events: 60 },
    "capped",
    days,
  );

  let itinerary: Itinerary | null = null;
  try {
    // The traveller's own priorities lead, with the travel type's defaults
    // behind them so a thin answer still yields a full day.
    const preferredCategories = [
      ...new Set([...categoriesForPriorities(plan.priorities), ...prefs.categories]),
    ];

    itinerary = await itineraryBuilder.buildItineraryWithContext(plan.destination as string, days, {
      dailyBudget: dailyBudget.activities,
      preferredCategories,
      activityLevel: prefs.activityLevel,
      pacing: prefs.pacing,
      numberOfPeople: travelers,
    });
  } catch (err) {
    console.error("Trip itinerary build failed:", err);
  }

  // Days existing is not the same as the itinerary having anything in it: the
  // builder returns the requested number of (empty) days even when the place
  // lookup found nothing, so counting days alone would present a blank
  // schedule as a finished plan. Count actual activities.
  const activityCount = (itinerary?.days || []).reduce(
    (n, day) => n + day.timeSlots.reduce((m, slot) => m + slot.activities.length, 0),
    0,
  );

  if (!itinerary || activityCount === 0) {
    const paidNote = plan.flightBookingId || plan.hotelBookingId
      ? " Your flight and stay are booked and unaffected"
      : " Nothing was booked";
    return ok({
      tripPlan: plan,
      error:
        `I couldn't find enough to do around ${plan.destination} to build a day-by-day plan.` +
        `${paidNote} — you can ask me to plan the days again, or name a nearby city and I'll build it around that instead.`,
    });
  }

  // Stamp real calendar dates onto the days so the itinerary lines up with
  // the flight and hotel that were actually booked.
  itinerary.days.forEach((day, i) => {
    const d = tripStart(plan);
    d.setUTCDate(d.getUTCDate() + i);
    day.date = d.toISOString().slice(0, 10);
  });
  itinerary.tripMetadata = {
    ...itinerary.tripMetadata,
    startDate: plan.startDate,
    endDate: tripEndDate(plan),
    travelers,
    travelType,
    budget: String(plan.budget),
  };

  const savedTripId = await persistSavedTrip(state.userId, plan, itinerary, travelType, travelers);

  return ok({
    tripPlan: { ...plan, savedTripId: savedTripId || undefined },
    itinerary,
    toolData: {
      kind: "trip_plan_complete",
      data: {
        plan: { ...plan, savedTripId: savedTripId || undefined },
        itinerary,
        savedTripId,
        spent,
        remaining,
      },
    },
  });
}

/**
 * What the bookings actually cost the user.
 *
 * Deliberately the plain sum of `option.price.amount` — no multiplying by
 * travellers or nights — because that is exactly what bookingService charges
 * (`bookingService.ts:198`). Scaling it here would print a "spent" figure
 * that contradicts the user's own transaction history.
 */
function bookedSpend(plan: TripPlan): number {
  const sum = [plan.flightOption, plan.hotelOption]
    .map((o) => Number(o?.price?.amount || 0))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => a + b, 0);
  return sum;
}

/**
 * Persist as a SavedTrip. Deliberately non-fatal: the itinerary is already
 * built and worth showing even if the save fails — the user just loses the
 * ability to edit it by command, which is reported honestly rather than
 * throwing away the whole turn.
 */
async function persistSavedTrip(
  userId: string | undefined,
  plan: TripPlan,
  itinerary: Itinerary,
  travelType: TravelType,
  travelers: number,
): Promise<string | null> {
  if (!userId) return null;

  try {
    const days = plan.days || itinerary.days.length;

    // Shared with the REST save path (services/tripPersistence.ts), which also
    // embeds the trip and ingests it into the vector layer. Doing it inline
    // here previously skipped both, so agent-planned trips were saved but
    // invisible to search and to RAG.
    const trip = await saveItineraryAsTrip(userId, itinerary, {
      title: `${days}-day ${travelType} trip to ${plan.destination}`,
      description: `Planned with the TravelTea agent${plan.origin ? ` from ${plan.origin}` : ""}.`,
      startDate: tripStart(plan),
      travelType,
      travelers,
      budgetTotal: plan.budget || 0,
      tags: [travelType, plan.destination as string, "agent-planned"],
    });

    return (trip._id as { toString(): string }).toString();
  } catch (err) {
    console.error("Saving agent-planned trip failed:", err);
    return null;
  }
}

// ── Formatters ────────────────────────────────────────────────────────────
// Deterministic, like every other toolData/interrupt formatter in this
// codebase — no LLM call to render something already fully known.

/**
 * Indented, italicised sub-line for an option — omitted entirely when the
 * note is blank. Emitting `_${note}_` unconditionally rendered as literal
 * underscores whenever the note was empty or ended in a dangling separator.
 */
function noteLine(note?: string): string {
  const text = (note || "").trim().replace(/[,·—-]\s*$/, "").trim();
  return text ? `   _${text}_\n` : "";
}

export function formatTripSlotPrompt(data: any): string {
  const field = String(data?.field || "");
  const plan: TripPlan = data?.plan || {};
  const question = QUESTIONS[field] || `Could you tell me the ${field}?`;

  if ((data?.asked || 0) === 0 && !plan.destination) {
    return `Let's plan this properly — I'll book the flight and hotel and build the itinerary for you.\n\n${question}`;
  }

  const known: string[] = [];
  if (plan.destination) known.push(`**${plan.destination}**`);
  if (plan.days) known.push(`${plan.days} days`);
  if (plan.startDate) known.push(`from ${plan.startDate}`);
  if (plan.travelers) known.push(`${plan.travelers} ${plan.travelers === 1 ? "traveller" : "travellers"}`);
  if (plan.budget) known.push(`budget $${plan.budget}`);
  if (plan.travelType) known.push(`${plan.travelType} trip`);
  if (plan.priorities?.length) known.push(plan.priorities.join(" · "));
  if (plan.origin) known.push(`from ${plan.origin}`);

  const recap = known.length ? `Got it so far: ${known.join(" · ")}.\n\n` : "";
  return `${recap}${question}`;
}

export function formatTripFlightOptions(data: any): string {
  const plan: TripPlan = data?.plan || {};
  const options: BookingOption[] = data?.options || [];
  if (data?.attempt > 0) {
    return `I didn't catch which flight you meant — give me a number from the list, or say "skip flights".`;
  }

  let out = `## ✈️ Flights ${plan.origin} → ${plan.destination}\n\n`;
  out += `Departing ${plan.startDate}, returning ${tripEndDate(plan)}.\n\n`;
  options.forEach((o, i) => {
    const price = o.price ? ` — 💰 ${o.price.currency} ${o.price.amount}` : "";
    out += `${i + 1}. **${o.name}**${price}\n${noteLine(o.priceNote)}`;
  });
  out += `\nWhich one should I book? Give me a number, or say "skip flights" if you're sorting your own travel.`;
  return out;
}

export function formatTripHotelOptions(data: any): string {
  const plan: TripPlan = data?.plan || {};
  const options: BookingOption[] = data?.options || [];
  if (data?.attempt > 0) {
    return `I didn't catch which hotel you meant — give me a number from the list, or say "skip the hotel".`;
  }

  let out = `## 🏨 Stays in ${plan.destination}\n\n`;
  out += `${plan.startDate} → ${checkOutDate(plan)}, ${plan.days} night${plan.days === 1 ? "" : "s"}.\n\n`;
  options.forEach((o, i) => {
    const rating = o.rating ? ` — ⭐ ${o.rating}` : "";
    const price = o.price ? ` — 💰 ${o.price.currency} ${o.price.amount}` : "";
    out += `${i + 1}. **${o.name}**${rating}${price}\n${noteLine(o.priceNote)}`;
  });
  out += `\nWhich one should I book? Give me a number, or say "skip the hotel".`;
  return out;
}

export function formatTripPaymentPrompt(data: any): string {
  const bookings: any[] = data?.bookings || [];
  if (data?.attempt > 0) {
    return (
      `That payment hasn't come through yet — the booking${bookings.length === 1 ? " is" : "s are"} still held, unpaid. ` +
      `Use the panel below to try again (a different method is fine), then send me a message once it's gone through.`
    );
  }

  let out = `## 💳 Ready to pay\n\nI've held these for you:\n\n`;
  bookings.forEach((b) => {
    const price = b.price ? ` — ${b.price.currency} ${b.price.amount}` : "";
    out += `- ${b.type === "flight" ? "✈️" : "🏨"} **${b.name}**${price}  \n  _Ref \`${b.reference}\`_\n`;
  });
  out += `\nUse the payment panel below to pay — it's simulated, no real charge, and no card number is stored. Once it goes through I'll build your itinerary.`;
  return out;
}

export function formatTripCancelled(_data: any): string {
  return `No problem — I've dropped that trip plan. Nothing was booked. Just say the word whenever you want to start again.`;
}

/**
 * The user moved on mid-flow. Not a rejection — say what actually happened,
 * including anything already held unpaid, so nothing is left as a surprise
 * on their account.
 */
export function formatTripAbandoned(data: any): string {
  const plan: TripPlan = data?.plan || {};
  const held: string[] = [];
  if (plan.flightBookingId && plan.flightOption) held.push(`✈️ ${plan.flightOption.name}`);
  if (plan.hotelBookingId && plan.hotelOption) held.push(`🏨 ${plan.hotelOption.name}`);

  let out = `I've set that trip plan aside since you've moved on.\n\n`;
  if (held.length) {
    out += `Held but **not paid for**, so nothing was charged:\n${held.map((h) => `- ${h}`).join("\n")}\n\nYou can pay for or cancel ${held.length === 1 ? "it" : "them"} from your profile.\n\n`;
  } else {
    out += `Nothing was booked.\n\n`;
  }
  out += `Ask me your question again, or say "plan my trip" whenever you'd like to pick this back up.`;
  return out;
}

export function formatTripPlanComplete(data: any): string {
  const plan: TripPlan = data?.plan || {};
  const itinerary: Itinerary = data?.itinerary;
  const days = itinerary?.days || [];

  let out = `# 🎉 Your ${plan.days}-day ${plan.travelType} trip to ${plan.destination}\n\n`;

  const booked: string[] = [];
  if (plan.flightOption) {
    booked.push(
      `✈️ **${plan.flightOption.name}**${plan.flightOption.price ? ` — ${plan.flightOption.price.currency} ${plan.flightOption.price.amount}` : ""}`,
    );
  }
  if (plan.hotelOption) {
    booked.push(
      `🏨 **${plan.hotelOption.name}**${plan.hotelOption.price ? ` — ${plan.hotelOption.price.currency} ${plan.hotelOption.price.amount}/night` : ""}`,
    );
  }
  if (booked.length) {
    out += plan.paid
      ? `## Booked & paid\n${booked.map((b) => `- ${b}`).join("\n")}\n\n_Receipts are in your profile under Transaction History._\n\n`
      : `## Held — payment still outstanding\n${booked.map((b) => `- ${b}`).join("\n")}\n\n_These aren't paid for yet. You can settle them any time from your profile — I've built the plan around them regardless._\n\n`;
  } else {
    out += `_No flight or hotel was booked — here's the plan itself._\n\n`;
  }

  if (typeof data?.remaining === "number" && plan.budget) {
    out +=
      data.remaining < 0
        ? `💰 Heads up — the flight and stay came to **$${Math.round(data.spent)}**, which is **$${Math.abs(Math.round(data.remaining))} over** your $${plan.budget} budget. I've still planned the days below, but there's nothing left in the budget for activities and food.\n\n`
        : `💰 Spent **$${Math.round(data.spent)}** of your $${plan.budget} budget — about **$${Math.round(data.remaining)}** left for activities and food.\n\n`;
  }

  out += `---\n\n`;

  days.forEach((day) => {
    out += `## 📅 Day ${day.dayNumber}${day.date ? ` · ${day.date}` : ""}: ${day.title}\n\n`;
    day.timeSlots.forEach((slot) => {
      if (slot.activities.length === 0) return;
      const emoji = slot.period === "morning" ? "☀️" : slot.period === "afternoon" ? "🌆" : "🌙";
      out += `### ${emoji} ${slot.period} (${slot.startTime}–${slot.endTime})\n\n`;
      slot.activities.forEach((a, i) => {
        out += `**${i + 1}. ${a.name}**\n`;
        if (a.duration) out += `   ⏱️ ${a.duration}\n`;
        if (a.estimatedCost) out += `   💰 ${a.estimatedCost}\n`;
        out += `\n`;
      });
    });
    out += `---\n\n`;
  });

  if (data?.savedTripId) {
    out += `\n✏️ This is saved as a real trip, so you can just tell me what to change — "move the museum to day 3", "remove the beach on day 2", "add a rooftop bar on day 1" — and I'll edit it.\n`;
  } else {
    out += `\n_I couldn't save this trip to your account, so I can't edit it by command — sign in and ask me to plan it again if you'd like that._\n`;
  }

  return out;
}
