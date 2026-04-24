import 'dotenv/config';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import SavedTrip from '../models/SavedTrip.js';
import { Booking } from '../models/Booking.js';

/**
 * End-to-end exercise of the agent-driven trip-planning flow through the real
 * chat API: guided slot collection, out-of-order and revised answers, flight
 * and hotel selection, inline payment against POST /api/bookings/:id/pay, the
 * generated itinerary, the SavedTrip it persists, and editing that itinerary
 * by command afterwards.
 *
 * Assertions are loose about wording (the LLM phrases things differently
 * every run) and strict about structure — which pause the flow is on, what
 * exists in the database, and — the one that actually matters — that no
 * booking is ever created twice by a graph replay.
 *
 * Run: npm run qa:trip
 */

const BASE = 'http://localhost:5000';
const USER_ID = process.env.QA_USER_ID || '6a5fdc43ac8fc4f60b8b1793';
const TOKEN = jwt.sign({ sub: USER_ID }, process.env.JWT_SECRET as string, {
  expiresIn: '1h' as jwt.SignOptions['expiresIn'],
});
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

let pass = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
}

interface Reply {
  status: number;
  text: string;
  itinerary?: any;
  pendingTrip?: any;
  tripPlanResult?: any;
  raw: any;
}

async function chat(message: string, conversationId: string, extra: any = {}): Promise<Reply> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ message, conversationId, ...extra }),
  });
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return {
    status: res.status,
    text: String(body.message || ''),
    itinerary: body.itinerary,
    pendingTrip: body.pendingTrip,
    tripPlanResult: body.tripPlanResult,
    raw: body,
  };
}

const preview = (s: string, n = 100) => s.replace(/\s+/g, ' ').slice(0, n);
const convo = (tag: string) => `qa-trip-${tag}-${Date.now()}`;

/**
 * Send each reply in turn, stopping early only once the flow has reached
 * `stopAt` — never on the pause it was already sitting on when we started,
 * which is why the caller passes the kind it wants to *arrive* at.
 */
async function advance(
  cid: string,
  replies: string[],
  stopAt?: string,
): Promise<Reply | null> {
  let last: Reply | null = null;
  for (const reply of replies) {
    last = await chat(reply, cid);
    console.log(`    → "${reply}"  ⇒  [${last.pendingTrip?.kind || 'no pause'}] ${preview(last.text, 70)}`);
    if (stopAt && last.pendingTrip?.kind === stopAt) return last;
  }
  return last;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log('\n=== Agent-driven trip planning ===\n');

  // ── 1. Guided collection, one question at a time ────────────────────────
  console.log('1. Guided slot collection');
  {
    const cid = convo('collect');
    const r1 = await chat('plan my trip for me, do everything', cid);
    check('bare "plan my trip" opens the flow', r1.pendingTrip?.kind === 'trip_slot',
      `kind=${r1.pendingTrip?.kind} ${preview(r1.text, 60)}`);
    check('asks for the destination first', r1.pendingTrip?.field === 'destination',
      `field=${r1.pendingTrip?.field}`);

    const r2 = await chat('Lisbon', cid);
    check('destination captured', r2.pendingTrip?.plan?.destination?.toLowerCase().includes('lisbon'),
      JSON.stringify(r2.pendingTrip?.plan));
    check('moves on to the next missing field', r2.pendingTrip?.field !== 'destination',
      `field=${r2.pendingTrip?.field}`);
  }

  // ── 2. Multi-slot + out-of-order + revision ─────────────────────────────
  console.log('\n2. Flexible collection (several slots at once, then a revision)');
  {
    const cid = convo('multi');
    await chat('plan and book me a whole trip', cid);
    const r = await chat('Lisbon for 3 days starting 2026-11-10, budget 2500 dollars, cultural trip, 2 people, we love museums and food, flying from Paris', cid);
    const plan = r.pendingTrip?.plan || r.tripPlanResult?.plan;
    check('one reply fills several slots', !!plan?.destination && !!plan?.days && !!plan?.budget,
      JSON.stringify(plan));
    check('days parsed', plan?.days === 3, `days=${plan?.days}`);
    check('travelType mapped', plan?.travelType === 'cultural', `travelType=${plan?.travelType}`);
    check('travelers parsed out of order', plan?.travelers === 2, `travelers=${plan?.travelers}`);
    check('date resolved to ISO', plan?.startDate === '2026-11-10', `startDate=${plan?.startDate}`);
    check('collection completes — no longer asking for slots', r.pendingTrip?.kind !== 'trip_slot',
      `kind=${r.pendingTrip?.kind}`);
  }

  // ── 3. Intent mapping: a word that isn't one of the six travel types ────
  console.log('\n3. Trip intent mapped from natural language');
  {
    const cid = convo('intent');
    await chat('plan a trip for me please', cid);
    await chat('Goa', cid);
    // One slot per turn, answering the actual questions in order.
    const r = await advance(cid, ['2026-12-01', '4 days', '2 of us', '$1800', "it's our honeymoon", 'beaches and food', 'flying from Mumbai']);
    const plan = r?.pendingTrip?.plan || r?.tripPlanResult?.plan;
    check('all four answers accumulate across turns',
      plan?.days === 4 && plan?.budget === 1800 && plan?.startDate === '2026-12-01',
      JSON.stringify(plan));
    check('"honeymoon" maps to a real travel type — never left blank',
      ['leisure', 'cultural', 'solo', 'family', 'adventure', 'business'].includes(String(plan?.travelType)),
      `travelType=${plan?.travelType}`);
    check('collection ends once every required slot is filled',
      r?.pendingTrip?.kind !== 'trip_slot', `kind=${r?.pendingTrip?.kind}`);
  }

  // ── 4. Full flow: collect → hotel → payment → itinerary ─────────────────
  console.log('\n4. Full flow through to a paid, saved, editable itinerary');
  let savedTripId: string | null = null;
  {
    const cid = convo('full');
    const bookingsBefore = await Booking.countDocuments({ user: USER_ID });

    await chat('plan and book my entire trip', cid);
    // No origin given, so flights are skipped and the flow goes to hotels.
    let r = await advance(cid, [
      'Lisbon, 2 days from 2026-11-20, budget $1200, leisure trip for 1 person, mainly food and beaches, no flights needed',
    ]);
    check('reaches the hotel step', r?.pendingTrip?.kind === 'trip_hotel_options',
      `kind=${r?.pendingTrip?.kind} ${preview(r?.text || '', 70)}`);
    check('hotel options are real', (r?.pendingTrip?.options?.length || 0) > 0,
      `count=${r?.pendingTrip?.options?.length}`);

    // Pick one → a pending_payment booking must exist.
    r = await chat('option 1', cid);
    check('picking a hotel reaches the payment step', r.pendingTrip?.kind === 'trip_payment',
      `kind=${r.pendingTrip?.kind} ${preview(r.text, 70)}`);

    const held = r.pendingTrip?.bookings || [];
    check('payment step names the held booking', held.length === 1, `count=${held.length}`);

    const bookingsAfter = await Booking.countDocuments({ user: USER_ID });
    check('exactly one booking was created (no replay double-book)',
      bookingsAfter === bookingsBefore + 1, `${bookingsBefore} -> ${bookingsAfter}`);

    const bookingId = held[0]?.id;
    const dbBefore = await Booking.findById(bookingId);
    check('booking is held unpaid', dbBefore?.status === 'pending_payment', `status=${dbBefore?.status}`);

    // The flow must NOT accept the user's word for payment.
    const lied = await chat('I paid, go ahead', cid);
    check('claiming payment without paying does not advance to the itinerary',
      lied.pendingTrip?.kind === 'trip_payment' && !lied.tripPlanResult,
      `kind=${lied.pendingTrip?.kind}`);

    // Pay for real, the way the inline panel does — straight to the REST route.
    const payRes = await fetch(`${BASE}/api/bookings/${bookingId}/pay`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ method: 'upi', upiId: 'traveltea@hdfc' }),
    });
    const payBody: any = await payRes.json();
    check('inline payment succeeds', payBody.booking?.status === 'confirmed',
      `status=${payBody.booking?.status} txn=${payBody.transaction?.transactionId}`);

    // Resume: the flow re-reads the database and proceeds.
    const done = await chat('payment done', cid);
    check('itinerary is generated after real payment', (done.itinerary?.days?.length || 0) > 0,
      `days=${done.itinerary?.days?.length} ${preview(done.text, 70)}`);
    check('itinerary covers the requested number of days', done.itinerary?.days?.length === 2,
      `days=${done.itinerary?.days?.length}`);
    check('days carry real calendar dates from the trip start',
      done.itinerary?.days?.[0]?.date === '2026-11-20',
      `date=${done.itinerary?.days?.[0]?.date}`);
    check('response reports the booked hotel', /hotel|booked|paid/i.test(done.text), preview(done.text, 70));

    // Regression: buildBudgetAwareDayPlan's used-place sets used to be
    // per-day despite claiming to be global, so a short itinerary in a place
    // with few named attractions scheduled the same one on day 1 and day 2.
    const names: string[] = (done.itinerary?.days || []).flatMap((d: any) =>
      (d.timeSlots || []).flatMap((s: any) => (s.activities || []).map((a: any) => a.name)));
    check('no activity is scheduled twice across the itinerary',
      names.length === new Set(names).size,
      `${names.length} activities, ${new Set(names).size} distinct`);

    savedTripId = done.tripPlanResult?.savedTripId || null;
    check('a SavedTrip id comes back for editing', !!savedTripId, `id=${savedTripId}`);

    if (savedTripId) {
      const trip: any = await SavedTrip.findById(savedTripId);
      check('SavedTrip persisted with the itinerary',
        !!trip && trip.generatedItinerary?.days?.length === 2,
        `days=${trip?.generatedItinerary?.days?.length}`);
      check('SavedTrip belongs to the requesting user', String(trip?.user) === USER_ID, String(trip?.user));
      check('SavedTrip carries the collected trip context',
        trip?.travelType === 'leisure' && trip?.totalDays === 2 && trip?.budget?.total === 1200,
        `travelType=${trip?.travelType} days=${trip?.totalDays} budget=${trip?.budget?.total}`);
    }

    check('pendingTrip cleared once the flow resolves', done.pendingTrip === null,
      String(done.pendingTrip));
  }

  // ── 5. Editing the generated itinerary by command ───────────────────────
  console.log('\n5. Editing the agent-generated itinerary by command');
  if (savedTripId) {
    const cid = convo('edit');
    const before: any = await SavedTrip.findById(savedTripId);
    const countBefore = before.generatedItinerary.days.reduce(
      (n: number, d: any) => n + d.timeSlots.reduce((m: number, s: any) => m + s.activities.length, 0), 0);
    const victim = before.generatedItinerary.days[0].timeSlots.find((s: any) => s.activities.length > 0)
      ?.activities[0]?.name;

    check('the generated itinerary has activities to edit', countBefore > 0 && !!victim,
      `activities=${countBefore} first="${victim}"`);

    if (victim) {
      const r = await chat(`remove ${victim} from day 1`, cid, {
        activeTripId: savedTripId,
        timelineVersion: before.timeline?.version,
        mutationId: `qa-${Date.now()}`,
      });
      const after: any = await SavedTrip.findById(savedTripId);
      const countAfter = after.generatedItinerary.days.reduce(
        (n: number, d: any) => n + d.timeSlots.reduce((m: number, s: any) => m + s.activities.length, 0), 0);
      check('a command edit actually mutates the saved trip', countAfter === countBefore - 1,
        `${countBefore} -> ${countAfter} | ${preview(r.text, 60)}`);
    }
  } else {
    check('editing skipped — no SavedTrip was produced', false);
  }

  // ── 6. Abandoning mid-flow releases the conversation ────────────────────
  console.log('\n6. Abandoning mid-flow');
  {
    const cid = convo('abandon');
    await chat('plan and book my whole trip', cid);
    // Answered field by field so the flow reliably reaches the option list —
    // this section is about abandoning from there, not about extraction.
    const r = await advance(
      cid,
      [
        'Porto, 2 days from 2026-11-25, $900, leisure, 1 person, food and architecture',
        "I'll sort my own travel, skip flights",
      ],
      'trip_hotel_options',
    );
    check('reached the hotel step to abandon from', r?.pendingTrip?.kind === 'trip_hotel_options',
      `kind=${r?.pendingTrip?.kind}`);

    const away = await chat("actually what's the weather like in Tokyo right now?", cid);
    check('moving on releases the flow instead of re-asking',
      away.pendingTrip === null || away.pendingTrip === undefined,
      `pendingTrip=${JSON.stringify(away.pendingTrip)} ${preview(away.text, 60)}`);
    check('and says nothing was booked', /aside|nothing was booked|not paid/i.test(away.text),
      preview(away.text, 80));

    // The very next message must be handled normally, not swallowed.
    const next = await chat('what are the top attractions in Rome?', cid);
    check('the next message is handled normally', next.status === 200 && next.text.length > 40,
      preview(next.text, 70));
  }

  // ── 7. plan_trip is not hijacked by the new flow ────────────────────────
  console.log('\n7. Plain itinerary requests still use plan_trip');
  {
    const cid = convo('plain');
    const r = await chat('make me a 2-day itinerary for Rome', cid);
    check('a plain itinerary request does not open the booking flow',
      !r.pendingTrip && (r.itinerary?.days?.length || 0) > 0,
      `pendingTrip=${r.pendingTrip?.kind} days=${r.itinerary?.days?.length}`);
  }

  // ── 8. Flight + hotel: two bookings, both paid, one itinerary ──────────
  console.log('\n8. Flight path — an origin routes the flow through flights too');
  {
    const cid = convo('flights');
    const before = await Booking.countDocuments({ user: USER_ID });

    await chat('plan and book my whole trip end to end', cid);
    let r = await advance(cid, [
      'Delhi to Goa, 2 days from 2026-12-05, budget $900, leisure, 1 person, beaches and nightlife',
    ]);
    check('an origin routes the flow through flights first',
      r?.pendingTrip?.kind === 'trip_flight_options',
      `kind=${r?.pendingTrip?.kind} ${preview(r?.text || '', 70)}`);
    check('flight options are real', (r?.pendingTrip?.options?.length || 0) > 0,
      `count=${r?.pendingTrip?.options?.length}`);

    r = await chat('option 1', cid);
    check('picking a flight advances to hotels', r.pendingTrip?.kind === 'trip_hotel_options',
      `kind=${r.pendingTrip?.kind} ${preview(r.text, 70)}`);

    r = await chat('option 1', cid);
    check('picking a hotel advances to payment', r.pendingTrip?.kind === 'trip_payment',
      `kind=${r.pendingTrip?.kind} ${preview(r.text, 70)}`);

    const held = r.pendingTrip?.bookings || [];
    check('both the flight and the hotel are held', held.length === 2,
      `count=${held.length} types=${held.map((b: any) => b.type).join(',')}`);

    const after = await Booking.countDocuments({ user: USER_ID });
    check('exactly two bookings created across several graph resumes',
      after === before + 2, `${before} -> ${after}`);

    // Pay both the way the inline panel does — sequentially, direct to REST,
    // never through a chat message.
    for (const b of held) {
      const res = await fetch(`${BASE}/api/bookings/${b.id}/pay`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ method: 'netbanking', bank: 'HDFC Bank' }),
      });
      const body: any = await res.json();
      check(`${b.type} payment succeeds`, body.booking?.status === 'confirmed',
        `status=${body.booking?.status}`);
    }

    const done = await chat('payment done', cid);
    check('one itinerary covers the whole booked trip',
      (done.itinerary?.days?.length || 0) === 2, `days=${done.itinerary?.days?.length}`);
    check('the summary lists both bookings',
      done.text.includes('✈️') && done.text.includes('🏨'), preview(done.text, 90));
    // Goa flights run into four figures, so this trip is almost always over
    // its $900 budget — which is the case that used to break the itinerary.
    check('budget accounting is reported either way',
      /Spent\s+\*\*\$\d+/.test(done.text) || /over\*\* your \$\d+ budget/.test(done.text),
      preview(done.text, 140));

    // Regression, two bugs in one assertion. An over-budget trip left the
    // activity budget at $0, which made the builder reject every priced
    // attraction; the day-filling fallback then relaxed *uniqueness* rather
    // than budget, so the few free entries got scheduled repeatedly — the
    // same sanctuary in both the morning and afternoon of one day.
    const names: string[] = (done.itinerary?.days || []).flatMap((d: any) =>
      (d.timeSlots || []).flatMap((s: any) => (s.activities || []).map((a: any) => a.name)));
    check('an over-budget trip still gets a real itinerary', names.length >= 4,
      `${names.length} activities`);
    check('and never schedules the same place twice',
      names.length === new Set(names).size,
      `${names.length} activities, ${new Set(names).size} distinct`);
  }

  await mongoose.disconnect();

  console.log(`\n=== ${pass} passed, ${failures.length} failed ===`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  FAIL  ${f}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
