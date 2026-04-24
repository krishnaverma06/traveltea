import 'dotenv/config';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

/**
 * End-to-end exercise of the whole agent surface through the real chat API:
 * places, transport, web search, events, flights, hotels, the booking
 * pipeline, itinerary generation, timeline editing, account tools and RAG.
 *
 * Assertions are deliberately loose about wording (the LLM phrases things
 * differently each run) and strict about structure — which tool ran, whether
 * real data came back, whether the DB actually changed.
 *
 * Run: npm run qa:agent
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

interface ChatReply {
  status: number;
  text: string;
  itinerary?: any;
  pendingBooking?: any;
  bookingResult?: any;
  mutations?: any[];
  raw: any;
}

async function chat(message: string, conversationId: string, extra: any = {}): Promise<ChatReply> {
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
    text: String(body.message || body.response || ''),
    itinerary: body.itinerary,
    pendingBooking: body.pendingBooking,
    bookingResult: body.bookingResult,
    mutations: body.mutations,
    raw: body,
  };
}

const preview = (s: string, n = 95) => s.replace(/\s+/g, ' ').slice(0, n);
const convo = (tag: string) => `qa-agent-${tag}-${Date.now()}`;

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);

  console.log('='.repeat(78));
  console.log('AGENT FLOW — full capability sweep');
  console.log('='.repeat(78));

  // ── places ────────────────────────────────────────────────────────────────
  console.log('\n[places]');
  {
    const c = convo('places');

    let r = await chat('attractions in Prague', c);
    console.log(`   > ${preview(r.text)}`);
    check(
      'search: "attractions in Prague" returns places',
      r.status === 200 && /found \d+ (amazing )?place/i.test(r.text) && !/found 0/i.test(r.text),
      `status=${r.status}`,
    );

    r = await chat('find me restaurants in Lisbon', c);
    console.log(`   > ${preview(r.text)}`);
    check('restaurants in Lisbon', r.status === 200 && r.text.length > 40, `status=${r.status}`);

    r = await chat('tell me about the Eiffel Tower', c);
    console.log(`   > ${preview(r.text)}`);
    check('place details lookup', r.status === 200 && r.text.length > 40, `status=${r.status}`);
  }

  // ── transport ─────────────────────────────────────────────────────────────
  console.log('\n[transport]');
  {
    const c = convo('transport');

    let r = await chat('how far is Paris from Lyon?', c);
    console.log(`   > ${preview(r.text)}`);
    check(
      'distance Paris -> Lyon mentions km',
      r.status === 200 && /\d/.test(r.text) && /km|kilomet|hour|distance/i.test(r.text),
      `status=${r.status}`,
    );

    r = await chat('plan a route from Paris to Lyon to Marseille', c);
    console.log(`   > ${preview(r.text)}`);
    check('multi-stop route', r.status === 200 && r.text.length > 40, `status=${r.status}`);
  }

  // ── web search / events ───────────────────────────────────────────────────
  console.log('\n[web search + events]');
  {
    const c = convo('misc');

    let r = await chat('travel tips for Japan', c);
    console.log(`   > ${preview(r.text)}`);
    check('travel tips', r.status === 200 && r.text.length > 60, `status=${r.status}`);

    r = await chat('what events are happening in Berlin next month?', c);
    console.log(`   > ${preview(r.text)}`);
    // No TICKETMASTER_API_KEY yet, so an honest "couldn't find any" is a pass;
    // a crash or an empty reply is not.
    check(
      'events (graceful without Ticketmaster key)',
      r.status === 200 && r.text.length > 20,
      `status=${r.status}`,
    );
  }

  // ── flights + hotels search ───────────────────────────────────────────────
  console.log('\n[flights + hotels]');
  {
    const c = convo('search');

    let r = await chat('find hotels in Lisbon', c);
    console.log(`   > ${preview(r.text)}`);
    check('hotel search responds', r.status === 200 && r.text.length > 40, `status=${r.status}`);

    r = await chat('find flights from Delhi to Mumbai on 2026-09-15', c);
    console.log(`   > ${preview(r.text)}`);
    check('flight search responds', r.status === 200 && r.text.length > 30, `status=${r.status}`);
  }

  // ── account tools ─────────────────────────────────────────────────────────
  console.log('\n[account tools]');
  {
    const c = convo('account');

    let r = await chat('show me my saved trips', c);
    console.log(`   > ${preview(r.text)}`);
    check(
      'saved trips (user-scoped)',
      r.status === 200 && /trip/i.test(r.text),
      `status=${r.status}`,
    );

    r = await chat('what are my travel preferences?', c);
    console.log(`   > ${preview(r.text)}`);
    check('travel preferences', r.status === 200 && r.text.length > 20, `status=${r.status}`);
  }

  // ── booking pipeline ──────────────────────────────────────────────────────
  console.log('\n[booking pipeline]');
  {
    const c = convo('booking');

    const search = await chat('book a hotel in Lisbon for 2 nights starting 2026-09-01', c);
    console.log(`   > ${preview(search.text)}`);
    const options = search.pendingBooking?.options || [];
    check(
      'booking search returns options',
      search.status === 200 && options.length > 0,
      `options=${options.length}`,
    );
    check(
      'options carry real names and prices',
      options.length > 0 && !!options[0]?.name && !!options[0]?.price?.amount,
      options[0] ? `first="${options[0].name}" ${options[0].price?.currency} ${options[0].price?.amount}` : '',
    );

    if (options.length > 0) {
      const confirm = await chat('yes, book the second one', c);
      console.log(`   > ${preview(confirm.text)}`);
      const result = confirm.bookingResult;
      check(
        'confirmation produces a booking',
        confirm.status === 200 && !!result?.bookingReference,
        result ? `ref=${result.bookingReference} txn=${result.transactionId}` : 'no bookingResult',
      );
      check(
        'selected the option the user named (2nd)',
        !!result && result.option?.name === options[1]?.name,
        result ? `booked="${result.option?.name}" expected="${options[1]?.name}"` : '',
      );
      check('pendingBooking cleared after resolve', confirm.pendingBooking === null);

      // The booking must actually exist in Mongo, not just in the reply.
      if (result?.bookingReference) {
        const doc = await mongoose.connection
          .collection('bookings')
          .findOne({ bookingReference: result.bookingReference });
        check('booking persisted to MongoDB', !!doc, doc ? `status=${(doc as any).status}` : 'not found');

        const txn = await mongoose.connection
          .collection('transactions')
          .findOne({ booking: (doc as any)?._id });
        check('transaction persisted', !!txn, txn ? `status=${(txn as any).status}` : 'not found');
      }
    }

    // Declining must not create a booking.
    const c2 = convo('decline');
    const s2 = await chat('book a hotel in Porto', c2);
    if ((s2.pendingBooking?.options || []).length > 0) {
      const declined = await chat('no, cancel that', c2);
      console.log(`   > ${preview(declined.text)}`);
      check(
        'declining produces no booking',
        declined.status === 200 && !declined.bookingResult?.bookingReference,
        `declined=${declined.bookingResult?.declined}`,
      );
    } else {
      console.log('   (skipped decline check — Porto search returned no options)');
    }
  }

  // ── itinerary generation ──────────────────────────────────────────────────
  console.log('\n[itinerary generation]');
  {
    const c = convo('itinerary');
    const r = await chat('plan a 3 day trip to Rome', c);
    console.log(`   > ${preview(r.text)}`);
    const days = r.itinerary?.days?.length ?? 0;
    check('plan_trip builds an itinerary', r.status === 200 && days > 0, `days=${days}`);
    if (days > 0) {
      const acts = r.itinerary.days.flatMap((d: any) =>
        (d.timeSlots || []).flatMap((s: any) => s.activities || []),
      );
      check('itinerary has activities', acts.length > 0, `activities=${acts.length}`);
      const empty = r.itinerary.days.filter(
        (d: any) => (d.timeSlots || []).flatMap((s: any) => s.activities || []).length === 0,
      );
      check('no empty days', empty.length === 0, `emptyDays=${empty.length}`);
    }
  }

  // ── timeline editing ──────────────────────────────────────────────────────
  console.log('\n[timeline editing]');
  {
    const trips = mongoose.connection.collection('savedtrips');
    const trip: any = await trips.findOne(
      {
        user: new mongoose.Types.ObjectId(USER_ID),
        'generatedItinerary.days.0': { $exists: true },
      },
      { sort: { createdAt: -1 } },
    );

    if (!trip) {
      console.log('   (skipped — no saved trip with an itinerary)');
    } else {
      const names = (trip.generatedItinerary?.days || []).flatMap((d: any) =>
        (d.timeSlots || []).flatMap((s: any) => (s.activities || []).map((a: any) => a.name)),
      );
      const before = names.length;
      const target = names[0];

      const r = await chat(`remove ${target} from day 1`, convo('timeline'), {
        activeTripId: String(trip._id),
        timelineVersion: trip.timeline?.version ?? 0,
        mutationId: `qa-agent-${Date.now()}`,
      });
      console.log(`   > ${preview(r.text)}`);

      const after: any = await trips.findOne({ _id: trip._id });
      const afterNames = (after.generatedItinerary?.days || []).flatMap((d: any) =>
        (d.timeSlots || []).flatMap((s: any) => (s.activities || []).map((a: any) => a.name)),
      );
      check(
        `timeline delete removed "${target}"`,
        afterNames.length === before - 1 && !afterNames.includes(target),
        `${before} -> ${afterNames.length} activities`,
      );
    }
  }

  // ── RAG + casual chat ─────────────────────────────────────────────────────
  console.log('\n[RAG + casual chat]');
  {
    const c = convo('rag');

    const r = await chat('what should I know before visiting Jaipur?', c);
    console.log(`   > ${preview(r.text)}`);
    check('knowledge question answered', r.status === 200 && r.text.length > 80, `status=${r.status}`);

    const casual = await chat('thanks, that was helpful!', c);
    console.log(`   > ${preview(casual.text)}`);
    check(
      'casual chat does not leak a previous tool result',
      casual.status === 200 &&
        casual.text.length > 5 &&
        !/found \d+ amazing places|Booking Confirmed|Travel Tips for/i.test(casual.text),
      `status=${casual.status}`,
    );
  }

  console.log('\n' + '='.repeat(78));
  console.log(`RESULT: ${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('='.repeat(78));

  await mongoose.disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('agent flow crashed:', e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
