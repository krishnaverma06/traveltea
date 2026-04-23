import { z } from "zod";
import { interrupt } from "@langchain/langgraph";
import { toolRegistry } from "./tool-registry.js";
import * as bookingService from "../services/bookingService.js";
import { createStructuredChatModel } from "../config/llm.js";
import type { NormalizedFlight, NormalizedHotel } from "../models/travelData.js";
import type { AgentState } from "./travel-agent.js";

/**
 * Booking pipeline — search -> present-options -> await-confirmation ->
 * execute-booking, added as their own branch off the planner (alongside
 * edit_timeline, which already bypasses the generic tool executor the
 * same way).
 *
 * Cross-turn confirmation (Phase 4): bookingConfirmNode calls interrupt()
 * to pause the graph and wait for the user's next message, resumed via
 * travel-agent.ts's chat() using a Command({resume}) + MemorySaver
 * checkpointer. On the paused run, the node never returns — chat() detects
 * the pause itself (isInterrupted) and formats a response directly from
 * the interrupt's payload, which is why that case has no toolData entry
 * below the way every other outcome does.
 *
 * Search (Phase 5): hotels and flights both search real data via
 * search_hotels/search_flights (SerpAPI's google_hotels/google_flights
 * engines — legitimate scraping-as-a-service, no Amadeus, no raw HTML
 * scraper). Both option types can be resolvable/bookable now — nothing
 * downstream special-cases "flight" as permanently unavailable anymore.
 *
 * Execution (Phase 6): bookingExecuteNode persists a real Booking via
 * bookingService.createBooking, then immediately pays it with an
 * internally-synthesized dummy card via bookingService.autoPayDummy —
 * never real user input, since a chat exchange can't collect card-shaped
 * details the way a form can. This goes through the exact same
 * validation/persistence path (submitPayment) the REST /api/bookings/:id/pay
 * route uses for a genuine multi-step create-then-pay flow, which is what
 * a future frontend payment form will drive.
 *
 * Slot-filling & confirm disambiguation (Phase 7): bookingSlotFillNode (new,
 * runs before bookingSearchNode) asks for any required BookingRequest field
 * the planner didn't supply, one at a time, via the same interrupt()-based
 * pause/resume primitive bookingConfirmNode already used for confirmation —
 * a LangGraph node can call interrupt() multiple times in one execution,
 * each resume replaying prior interrupt() calls from the checkpoint and
 * pausing fresh at the next new one. bookingConfirmNode's decision parsing
 * is upgraded the same way: a structured (not regex) confirm/decline/
 * unclear classification, with re-prompting on "unclear" instead of
 * silently treating anything non-affirmative as a decline, and option-index
 * selection so "book the second one" actually picks option 2.
 */

export interface BookingOption {
  id: string;
  type: "hotel" | "flight";
  name: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  category?: string[];
  image?: string;
  price?: { amount: string; currency: string };
  priceNote: string;
}

export interface BookingRequest {
  type: "hotel" | "flight";
  destination: string;
  origin?: string;
  checkIn?: string;
  checkOut?: string;
  departDate?: string;
  returnDate?: string;
  guests?: number;
  confirmed: boolean;
}

export const bookHotelToolSchema = z.object({
  destination: z.string().optional().describe("City or place to find/book a hotel in, if the user has said one — if not, leave it out, the agent will ask."),
  checkIn: z.string().optional().describe("Check-in date if the user specified one, e.g. 2026-08-20"),
  checkOut: z.string().optional().describe("Check-out date if the user specified one"),
  guests: z.number().int().min(1).optional().describe("Number of guests, if specified"),
  confirmed: z.boolean().optional().describe(
    "Set true ONLY if the user has already explicitly told you to go ahead and book a specific option in this same message (e.g. 'book the first one', 'yes, confirm it'). Leave unset/false for an initial search like 'find me a hotel in Lisbon'."
  ),
});

export const bookFlightToolSchema = z.object({
  origin: z.string().optional().describe("Departure city, if the user has said one — if not, leave it out, the agent will ask."),
  destination: z.string().optional().describe("Arrival city, if the user has said one — if not, leave it out, the agent will ask."),
  departDate: z.string().optional().describe(
    "Departure date, e.g. 2026-08-20, if the user has given one — if not, leave it out, the agent will ask."
  ),
  returnDate: z.string().optional().describe("Return date if the user specified one"),
  guests: z.number().int().min(1).optional().describe("Number of passengers, if specified"),
  confirmed: z.boolean().optional().describe(
    "Set true ONLY if the user has already explicitly told you to go ahead and book, not for an initial search."
  ),
});

export const BOOKING_VIRTUAL_SPECS = [
  {
    name: "book_hotel",
    description:
      "Find or book a place to stay. Use for a specific hotel search/booking request — not for a full multi-day itinerary (use plan_trip) and not for a general list of attractions (use search_by_category).",
    schema: bookHotelToolSchema,
  },
  {
    name: "book_flight",
    description: "Find or book a flight between two places. Requires a departure date — ask the user for one first if they haven't given it.",
    schema: bookFlightToolSchema,
  },
];

const ok = <T extends Partial<AgentState>>(partial: T) => partial;

/**
 * Bounded ask-extract-retry loop shared by slot-filling: interrupt() to
 * pause and get the user's free-text reply, then try to extract a typed
 * value from it. Returns the first non-null extraction, or null once
 * maxAttempts is exhausted — callers decide what "give up" means for them.
 */
async function resolveViaInterrupt<T>(
  promptPayload: (attempt: number) => any,
  extract: (reply: string, attempt: number) => Promise<T | null>,
  maxAttempts = 2,
): Promise<T | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const reply = interrupt(promptPayload(attempt));
    const result = await extract(String(reply ?? ""), attempt);
    if (result !== null) return result;
  }
  return null;
}

const REQUIRED_FIELDS: Record<"hotel" | "flight", Array<keyof BookingRequest>> = {
  hotel: ["destination"],
  flight: ["origin", "destination", "departDate"],
};

const FIELD_QUESTIONS: Record<string, string> = {
  destination: "Which destination did you have in mind?",
  origin: "Which city are you departing from?",
  departDate: "What date would you like to depart?",
  returnDate: "What date would you like to return?",
};

/**
 * Structured (not regex) single-field extraction from free text — the
 * Phase-2 convention of native LLM structured output over hand-rolled
 * parsing, applied here to slot values instead of tool-call args. Dates
 * get today's date in the prompt so relative phrases ("next Friday")
 * resolve to a real value; a reply that doesn't actually contain the
 * requested field (off-topic, "I don't know") resolves to null so the
 * caller can retry or give up instead of storing garbage.
 */
async function extractBookingField(
  field: keyof BookingRequest,
  reply: string,
  todayISO: string,
): Promise<string | null> {
  const isDate = field === "departDate" || field === "returnDate";
  // .optional() rather than .nullable() — .nullable() compiles to a JSON
  // Schema type-array (["string","null"]), which some Gemini models'
  // response_schema validation rejects outright (confirmed: 400 "Proto
  // field is not repeating, cannot start list" on gemini-3.1-flash-lite).
  // .optional() just omits the property instead, which is universally
  // supported and behaves identically for this code's purposes.
  const model = createStructuredChatModel(
    z.object({
      value: z
        .string()
        .optional()
        .describe(
          isDate
            ? "The date the user means, resolved to YYYY-MM-DD. Omit if the reply doesn't contain a usable date."
            : "The place name the user means. Omit if the reply doesn't contain one.",
        ),
    }),
    { temperature: 0 },
  );

  const prompt = isDate
    ? `Today's date is ${todayISO}. The user was asked "${FIELD_QUESTIONS[field]}" and replied: "${reply}". Resolve their reply to a single YYYY-MM-DD date, handling relative phrases like "next Friday" or "in two weeks" relative to today. If the reply doesn't contain a usable date, omit the value.`
    : `The user was asked "${FIELD_QUESTIONS[field]}" and replied: "${reply}". Extract just the place name they mean. If the reply doesn't contain one, omit the value.`;

  try {
    const result = await model.invoke(prompt);
    const value = (result as { value?: string }).value;
    return value && value.trim() ? value.trim() : null;
  } catch (err) {
    console.error(`Slot extraction failed for ${field}:`, err);
    return null;
  }
}

/**
 * slot-fill: asks for any required BookingRequest field the triggering
 * book_hotel/book_flight call didn't supply, one at a time, before search
 * ever runs. Rebuilds the request fresh from state.toolCalls on every
 * replay (safe — toolCalls is stable for the duration of one booking
 * turn-chain); the in-progress request otherwise lives in this local
 * variable, replayed deterministically by LangGraph across interrupt()
 * pauses the same way bookingConfirmNode's single interrupt already works.
 */
export async function bookingSlotFillNode(state: AgentState): Promise<Partial<AgentState>> {
  const call = (state.toolCalls || []).find(
    (c) => c.name === "book_hotel" || c.name === "book_flight"
  );
  if (!call) return {};

  const args = call.args || {};
  const type: "hotel" | "flight" = call.name === "book_hotel" ? "hotel" : "flight";

  const request: BookingRequest = {
    type,
    destination: args.destination || "",
    origin: args.origin,
    checkIn: args.checkIn,
    checkOut: args.checkOut,
    departDate: args.departDate,
    returnDate: args.returnDate,
    guests: args.guests,
    confirmed: !!args.confirmed,
  };

  const todayISO = new Date().toISOString().slice(0, 10);

  for (const field of REQUIRED_FIELDS[type]) {
    if (request[field]) continue;

    const resolved = await resolveViaInterrupt<string>(
      (attempt) => ({ kind: "booking_slot_fill", field, request, attempt }),
      (reply) => extractBookingField(field, reply, todayISO),
    );

    if (resolved) {
      (request as any)[field] = resolved;
    } else {
      return ok({
        bookingRequest: request,
        bookingOptions: [],
        error: `I still don't have a ${field === "departDate" ? "departure date" : field} for this — let's try again later with that detail.`,
      });
    }
  }

  return ok({ bookingRequest: request });
}

/**
 * search: bookingSlotFillNode guarantees state.bookingRequest already has
 * every required field for its type by the time this node runs — searches
 * real data (search_hotels/search_flights, SerpAPI's google_hotels/
 * google_flights engines) with no missing-field checks needed here anymore.
 */
export async function bookingSearchNode(state: AgentState): Promise<Partial<AgentState>> {
  const bookingRequest = state.bookingRequest;
  if (!bookingRequest) return {};

  const type = bookingRequest.type;

  if (type === "flight") {
    try {
      const result = await toolRegistry.executeTool("search_flights", {
        origin: bookingRequest.origin,
        destination: bookingRequest.destination,
        departDate: bookingRequest.departDate,
        returnDate: bookingRequest.returnDate,
        adults: bookingRequest.guests,
      });
      const payload = result?.content?.[0]?.text ? JSON.parse(result.content[0].text) : null;

      if (!payload || result.isError || payload.error) {
        return ok({
          bookingRequest,
          bookingOptions: [],
          error: payload?.error || "I couldn't find flights for that route.",
        });
      }

      const flights: NormalizedFlight[] = payload.flights || [];
      const bookingOptions: BookingOption[] = flights.map((f) => ({
        id: f.id,
        type: "flight",
        name: `${f.airline} — ${f.departure.iata} → ${f.arrival.iata}`,
        price: f.price,
        priceNote: `${f.duration}, ${f.stops === 0 ? "nonstop" : `${f.stops} stop${f.stops > 1 ? "s" : ""}`}`,
      }));

      return ok({ bookingRequest, bookingOptions });
    } catch (err) {
      return ok({
        bookingRequest,
        bookingOptions: [],
        error: "I couldn't search for flights right now. Please try again.",
      });
    }
  }

  try {
    const result = await toolRegistry.executeTool("search_hotels", {
      destination: bookingRequest.destination,
      checkIn: bookingRequest.checkIn,
      checkOut: bookingRequest.checkOut,
      adults: bookingRequest.guests,
    });
    const payload = result?.content?.[0]?.text ? JSON.parse(result.content[0].text) : null;

    if (!payload || result.isError || payload.error) {
      return ok({
        bookingRequest,
        bookingOptions: [],
        error: payload?.error || "I couldn't find hotels for that destination.",
      });
    }

    const hotels: NormalizedHotel[] = payload.hotels || [];
    const bookingOptions: BookingOption[] = hotels.map((h) => ({
      id: h.id,
      type: "hotel",
      name: h.name,
      location: h.location,
      rating: h.rating,
      image: h.image || undefined,
      price: h.price,
      priceNote: h.price ? `per night, ${h.address}` : `Live pricing unavailable — ${h.address}`,
    }));

    // Thread the actual dates search_hotels used (it applies defaults when
    // the user didn't give any) back into bookingRequest so the confirm
    // prompt and result screens show real dates, not undefined.
    return ok({
      bookingRequest: {
        ...bookingRequest,
        checkIn: payload.checkIn || bookingRequest.checkIn,
        checkOut: payload.checkOut || bookingRequest.checkOut,
      },
      bookingOptions,
    });
  } catch (err) {
    return ok({
      bookingRequest,
      bookingOptions: [],
      error: "I couldn't search for hotels right now. Please try again.",
    });
  }
}

/**
 * present-options: formats the search results into toolData for the
 * response formatter — no LLM call, deterministic like every other
 * toolData-backed capability in this codebase.
 */
export async function bookingPresentOptionsNode(state: AgentState): Promise<Partial<AgentState>> {
  const req = state.bookingRequest;
  if (!req) return {};
  const options = state.bookingOptions || [];
  return ok({
    toolData: {
      kind: "booking_options",
      data: { type: req.type, request: req, options, unavailable: options.length === 0 },
    },
  });
}

const ConfirmDecisionSchema = z.object({
  decision: z.enum(["confirm", "decline", "unclear", "unrelated"]).describe(
    "confirm: they want to proceed with booking (a specific option or the general idea of 'yes'). " +
      "decline: they explicitly don't want to book (no/cancel/never mind). " +
      "unrelated: they've moved on and are asking about something else entirely — a different city, the weather, an itinerary, a general travel question — with no reference to the booking. " +
      "unclear: they're still engaging with the booking but ambiguously (a question about the options, a vague reply)."
  ),
  optionNumber: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("The 1-based option NUMBER they referenced, exactly as numbered in the list they were shown, e.g. 'the second one' -> 2, 'option 3' -> 3, 'the Hilton' -> whichever number matches. Omit if they didn't reference a specific option."),
});

/**
 * Structured (not regex) confirm/decline/unclear classification of a
 * free-text reply to the booking confirmation prompt, with optional
 * option selection ("book the second one" / "book option 2" / "I'll take
 * the Hilton"). The option list shown to the model — and the number it
 * returns — are both 1-based, matching exactly what the user themselves
 * read in formatBookingOptions/formatBookingConfirmPrompt's own numbered
 * list (and what a "book option N" button click sends). The ONLY 0-based
 * conversion happens once, deterministically, in bookingConfirmNode below
 * — not inside the prompt, where a 0-based list previously caused a real
 * off-by-one bug: the model matched "option 2" against a 0-based list's
 * literal "2:" entry (the THIRD option) instead of correctly subtracting 1.
 */
async function classifyBookingDecision(
  reply: string,
  options: BookingOption[],
): Promise<{ decision: "confirm" | "decline" | "unclear" | "unrelated"; optionNumber?: number }> {
  const optionList = options
    .map((o, i) => `${i + 1}: ${o.name}${o.price ? ` (${o.price.currency} ${o.price.amount})` : ""}`)
    .join("\n");
  const model = createStructuredChatModel(ConfirmDecisionSchema, { temperature: 0 });
  const prompt = `The user was shown this numbered list of booking options:\n${optionList}\n\nThey were asked to confirm, decline, or pick one. They replied: "${reply}"\n\nClassify their reply.`;

  try {
    return await model.invoke(prompt);
  } catch (err) {
    console.error("Booking decision classification failed:", err);
    return { decision: "unclear" };
  }
}

/**
 * await-confirmation.
 *
 * Four outcomes:
 * 1. Not resolvable (no options found, for either type) — nothing to
 *    confirm, same terminal prompt every time, no pause.
 * 2. Already confirmed in the same message that triggered the search
 *    (e.g. "book the first hotel in Lisbon right now, I confirm") —
 *    resolves immediately to option 0, no pause needed. Deliberately not
 *    extended with option-selection for this one-shot path — that would
 *    mean extending book_hotel/book_flight's own schema, a separate
 *    concern from this node's HITL confirm loop.
 * 3. Clear decline, or an "unclear" reply that exhausts its re-prompt
 *    budget (treated as a decline — a safer default than silently
 *    booking on ambiguous input).
 * 4. Clear confirm, optionally pointing at a specific option by index.
 *
 * Pauses via interrupt() and waits for the user's next message to resume
 * this exact call with their reply as `decision` — re-prompting via a
 * fresh interrupt() (bounded, 2 attempts) when the reply is unclear rather
 * than silently treating it as a decline.
 */
export async function bookingConfirmNode(state: AgentState): Promise<Partial<AgentState>> {
  const req = state.bookingRequest;
  const options = state.bookingOptions || [];
  const resolvable = options.length > 0;

  if (!resolvable) {
    return ok({
      bookingConfirmed: false,
      toolData: {
        kind: "booking_confirm_prompt",
        data: { request: req, options, reason: "no_options" },
      },
    });
  }

  if (req?.confirmed) {
    return ok({ selectedBookingOption: options[0], bookingConfirmed: true });
  }

  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const payload =
      attempt === 0
        ? { kind: "booking_confirm_prompt", request: req, options }
        : { kind: "booking_clarify", request: req, options, attempt };
    const decision = interrupt(payload);
    const classified = await classifyBookingDecision(String(decision ?? ""), options);

    if (classified.decision === "confirm") {
      // The only 0-based conversion in this whole flow — see
      // classifyBookingDecision's comment for why it happens here and not
      // inside the prompt.
      const index =
        classified.optionNumber !== undefined
          ? Math.min(Math.max(classified.optionNumber - 1, 0), options.length - 1)
          : 0;
      return ok({ selectedBookingOption: options[index], bookingConfirmed: true });
    }
    if (classified.decision === "decline") {
      return ok({
        bookingConfirmed: false,
        toolData: { kind: "booking_declined", data: { request: req, options } },
      });
    }
    if (classified.decision === "unrelated") {
      // The user has moved on. Re-prompting would hold their next few
      // messages hostage to a confirmation they've abandoned — every reply
      // gets read as an answer to it until maxAttempts runs out. Release the
      // booking instead and say so, so their next message is handled normally.
      return ok({
        bookingConfirmed: false,
        toolData: {
          kind: "booking_declined",
          data: { request: req, options, reason: "abandoned" },
        },
      });
    }
    // "unclear" — loop back for another attempt, up to maxAttempts.
  }

  // Exhausted retries on unclear input — decline is the safer default over
  // silently booking on ambiguous input.
  return ok({
    bookingConfirmed: false,
    toolData: { kind: "booking_declined", data: { request: req, options } },
  });
}

/**
 * execute-booking: persists a real Booking, then pays it with an
 * internally-synthesized dummy card (autoPayDummy) — no real payment
 * gateway, no real charge, but a real DB record with a real reference/
 * transaction id.
 */
export async function bookingExecuteNode(state: AgentState): Promise<Partial<AgentState>> {
  const option = state.selectedBookingOption;
  const request = state.bookingRequest;
  if (!option || !request) {
    return ok({ error: "I couldn't complete the booking — no option was selected." });
  }

  // A Booking must belong to a real user — same fail-closed pattern as the
  // userScoped tools in agents/tools/account.ts. Never trust the LLM for
  // this; state.userId is always the server-authenticated value.
  if (!state.userId) {
    return ok({ error: "you'll need to be signed in for me to complete a booking." });
  }

  try {
    const booking = await bookingService.createBooking(state.userId, {
      type: option.type,
      option,
      request,
      source: "chat",
      conversationId: state.conversationId,
    });
    const { transaction } = await bookingService.autoPayDummy(
      (booking._id as { toString(): string }).toString(),
      state.userId
    );

    return ok({
      toolData: {
        kind: "booking_result",
        data: {
          bookingReference: booking.bookingReference,
          transactionId: transaction.transactionId,
          status: booking.status,
          option,
          note: "Payment was simulated automatically for chat bookings — no real charge was made.",
        },
      },
    });
  } catch (err) {
    console.error("Booking execution failed:", err);
    return ok({ error: "I ran into a system error completing that booking. Please try again." });
  }
}

export function formatBookingOptions(data: any): string {
  const options: BookingOption[] = data.options || [];
  const type: "hotel" | "flight" = data.type;
  const label = type === "flight" ? "✈️ Flight" : "🏨 Hotel";

  if (options.length === 0) {
    return `I couldn't find any ${type} options for **${data.request?.destination || "your destination"}** — want to try different dates or a nearby city?`;
  }

  const heading =
    type === "hotel"
      ? `## ${label} Options in ${data.request.destination}`
      : `## ${label} Options: ${data.request?.origin} → ${data.request.destination}`;

  let response = `${heading}\n\n`;
  options.forEach((opt, i) => {
    const ratingStr = opt.rating ? ` — ⭐ ${opt.rating}` : "";
    const priceStr = opt.price ? ` — 💰 ${opt.price.currency} ${opt.price.amount}` : "";
    response += `${i + 1}. **${opt.name}**${ratingStr}${priceStr}\n   _${opt.priceNote}_\n`;
  });
  response += `\nWant me to book one of these? Say "yes" for the first option, or name/number a specific one, e.g. "book option 2".`;
  return response;
}

export function formatBookingConfirmPrompt(data: any): string {
  if (data.reason === "no_options") {
    const type = data.request?.type === "flight" ? "flight" : "hotel";
    return `I don't have any ${type} options lined up yet for **${data.request?.destination}** — ask me to search first.`;
  }

  let response = `Just to confirm before I book:\n\n`;
  (data.options || []).slice(0, 5).forEach((opt: BookingOption, i: number) => {
    const priceStr = opt.price ? ` — 💰 ${opt.price.currency} ${opt.price.amount}` : "";
    response += `${i + 1}. **${opt.name}**${priceStr}\n`;
  });
  response += `\nSay "yes" for the first option, name/number a specific one (e.g. "the second one"), or "no" to cancel.`;
  return response;
}

/**
 * booking_slot_fill interrupt: asks for one missing required field at a
 * time. attempt > 0 means the previous reply didn't yield a usable value —
 * softened with an acknowledgment instead of repeating the same blunt ask.
 */
export function formatBookingSlotFillPrompt(data: any): string {
  const field = data.field as string;
  const question = FIELD_QUESTIONS[field] || `Could you give me the ${field}?`;
  if (data.attempt > 0) {
    return `Sorry, I couldn't quite catch that. ${question}`;
  }
  return question;
}

/**
 * booking_clarify interrupt: bookingConfirmNode's re-prompt when a reply to
 * the confirmation step was neither a clear confirm nor a clear decline.
 */
export function formatBookingClarifyPrompt(_data: any): string {
  return `I didn't quite catch that — say "yes" to book the first option, name/number a specific one, or "no" to cancel.`;
}

export function formatBookingResult(data: any): string {
  const priceLine = data.option?.price ? `\nPrice: ${data.option.price.currency} ${data.option.price.amount}` : "";
  return `## ✅ Booking Confirmed\n\n**${data.option?.name}**${priceLine}\nBooking Reference: \`${data.bookingReference}\`\nTransaction ID: \`${data.transactionId}\`\n\n_${data.note}_`;
}

export function formatBookingDeclined(data: any): string {
  // An abandoned booking isn't a rejection — the user just moved on. Say what
  // happened and invite them to repeat the question they actually asked,
  // rather than implying they turned the options down.
  if (data?.reason === "abandoned") {
    return (
      `I've set that booking aside since you've moved on — nothing was booked. ` +
      `Go ahead and ask me your question again, or say "book a hotel in <city>" whenever you're ready.`
    );
  }
  return `No problem, I won't book that. Let me know if you'd like to search again or try a different option.`;
}
