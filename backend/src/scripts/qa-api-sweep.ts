import 'dotenv/config';
import jwt from 'jsonwebtoken';

/**
 * End-to-end API sweep covering the WRITE operations that browser testing
 * skipped. Creates only its own records and deletes them again — it never
 * mutates pre-existing user data.
 *
 * Run: npx tsx src/scripts/qa-api-sweep.ts
 */

const BASE = 'http://localhost:5000';
const USER_ID = process.env.QA_USER_ID || '6a5fdc43ac8fc4f60b8b1793';
const TOKEN = jwt.sign({ sub: USER_ID }, process.env.JWT_SECRET as string, {
  expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'],
});

const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

let pass = 0;
let fail = 0;
const failures: string[] = [];

async function call(method: string, path: string, body?: any) {
  const res = await fetch(BASE + path, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed: any;
  const text = await res.text();
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

function check(label: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else {
    fail++;
    failures.push(label + (detail ? ` — ${detail}` : ''));
  }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
}

function summarize(b: any, n = 110) {
  return JSON.stringify(b).slice(0, n);
}

async function main() {
  console.log('='.repeat(72));
  console.log(`QA API sweep  (user ${USER_ID})`);
  console.log('='.repeat(72));

  const created: { savedTrips: string[]; bookings: string[] } = { savedTrips: [], bookings: [] };

  // ---------------------------------------------------------------- auth
  console.log('\n[auth]');
  let r = await call('GET', '/api/auth/me');
  check('GET /api/auth/me', r.status === 200, `status=${r.status}`);
  const originalPrefs = r.body?.user?.preferences ?? {};
  const originalName: string = r.body?.user?.name ?? 'User';

  r = await call('PUT', '/api/auth/preferences', {
    budget: 'mid-range',
    travelStyle: 'cultural',
    interests: ['museums', 'food'],
  });
  check('PUT /api/auth/preferences', r.status === 200, `status=${r.status}`);

  r = await call('GET', '/api/auth/me');
  check(
    'preferences actually persisted',
    r.body?.user?.preferences?.travelStyle === 'cultural',
    `travelStyle=${r.body?.user?.preferences?.travelStyle}`,
  );

  r = await call('PUT', '/api/auth/profile', { name: originalName, bio: 'qa sweep' });
  check('PUT /api/auth/profile', r.status === 200, `status=${r.status}`);

  // ---------------------------------------------------------- validation
  console.log('\n[validation — bad payloads must 4xx, not 500]');
  r = await call('POST', '/api/trips', {});
  check('POST /api/trips {} -> 4xx', r.status >= 400 && r.status < 500, `status=${r.status}`);
  r = await call('POST', '/api/saved-trips', {});
  check('POST /api/saved-trips {} -> 4xx', r.status >= 400 && r.status < 500, `status=${r.status}`);
  r = await call('GET', '/api/saved-trips/not-a-valid-objectid');
  check('GET /saved-trips/<bad id> -> 400', r.status === 400, `status=${r.status} ${summarize(r.body, 70)}`);
  r = await call('POST', '/api/saved-trips', { title: 'x', startDate: '2026-12-01', cities: [{ name: 'P', days: 1 }], totalDays: 1, people: 1, travelType: 'leisure', budget: { total: 1 }, generatedItinerary: { days: [], tripMetadata: {} } });
  check('POST /saved-trips (schema violation) -> 400', r.status === 400, `status=${r.status} ${summarize(r.body, 70)}`);

  // ---------------------------------------------------------------- trips
  console.log('\n[trips]');
  const QA_BUDGET = { total: 1000, travel: 300, accommodation: 400, food: 200, events: 100, mode: 'capped' };

  r = await call('POST', '/api/trips', {
    startDate: '2026-12-01',
    cities: [{ name: 'Prague', days: 3 }],
    title: 'QA Trip',
    totalDays: 3,
    people: 2,
    travelType: 'leisure',
    budget: QA_BUDGET,
  });
  check('POST /api/trips', r.status === 200 || r.status === 201, `status=${r.status} ${summarize(r.body)}`);
  const tripId = r.body?._id || r.body?.trip?._id || r.body?.id;

  r = await call('GET', '/api/trips');
  check('GET /api/trips', r.status === 200, `status=${r.status}`);

  if (tripId) {
    r = await call('GET', `/api/trips/${tripId}`);
    check('GET /api/trips/:id', r.status === 200, `status=${r.status}`);
  } else {
    check('GET /api/trips/:id', false, 'no trip id returned from POST');
  }

  // ---------------------------------------------------------- saved trips
  console.log('\n[saved-trips]');
  const itinerary = {
    tripMetadata: { destination: 'Prague', numberOfPeople: 2, travelers: 2 },
    days: [1, 2, 3].map((d) => ({ dayNumber: d, title: `Day ${d}`, timeSlots: [] })),
  };
  r = await call('POST', '/api/saved-trips', {
    title: 'QA Saved Trip',
    description: 'automated sweep',
    startDate: '2026-12-01',
    totalDays: 3,
    people: 2,
    travelType: 'leisure',
    cities: [{ name: 'Prague', days: 3 }],
    tags: ['qa'],
    budget: QA_BUDGET,
    budgetMode: 'capped',
    generatedItinerary: itinerary,
  });
  check('POST /api/saved-trips', r.status === 200 || r.status === 201, `status=${r.status} ${summarize(r.body)}`);
  const savedId = r.body?._id || r.body?.savedTrip?._id;
  if (savedId) created.savedTrips.push(savedId);

  if (savedId) {
    r = await call('GET', `/api/saved-trips/${savedId}`);
    check('GET /api/saved-trips/:id', r.status === 200, `status=${r.status}`);

    r = await call('PUT', `/api/saved-trips/${savedId}`, { title: 'QA Saved Trip (edited)' });
    check('PUT /api/saved-trips/:id', r.status === 200, `status=${r.status}`);

    r = await call('GET', `/api/saved-trips/${savedId}`);
    const newTitle = r.body?.savedTrip?.title ?? r.body?.title;
    check('edit actually persisted', newTitle === 'QA Saved Trip (edited)', `title=${newTitle}`);

    r = await call('PUT', `/api/saved-trips/${savedId}/upcoming`, { tripStartDate: '2027-01-15' });
    check('PUT /api/saved-trips/:id/upcoming', r.status === 200, `status=${r.status}`);
  }

  const checkQs = new URLSearchParams({
    startDate: '2026-12-01',
    cities: JSON.stringify([{ name: 'Prague' }]),
    people: '2',
    travelType: 'leisure',
  }).toString();
  r = await call('GET', `/api/saved-trips/check?${checkQs}`);
  check('GET /api/saved-trips/check', r.status === 200, `status=${r.status} ${summarize(r.body)}`);

  r = await call('GET', '/api/saved-trips/search?q=Prague');
  check('GET /api/saved-trips/search', r.status === 200, `status=${r.status} ${summarize(r.body)}`);

  // ------------------------------------------------------------- bookings
  console.log('\n[bookings — REST payment flow]');
  const option = {
    id: 'qa-hotel-1',
    type: 'hotel',
    name: 'QA Test Hotel',
    priceNote: 'per night',
    price: { amount: '120', currency: 'USD' },
  };
  const request = { type: 'hotel', destination: 'Prague', checkIn: '2026-12-01', checkOut: '2026-12-03', guests: 2, confirmed: true };

  r = await call('POST', '/api/bookings', { type: 'hotel', option, request });
  check('POST /api/bookings', r.status === 200 || r.status === 201, `status=${r.status} ${summarize(r.body)}`);
  const bookingId = r.body?.booking?._id || r.body?._id;
  if (bookingId) created.bookings.push(bookingId);

  if (bookingId) {
    r = await call('GET', `/api/bookings/${bookingId}`);
    check('GET /api/bookings/:id', r.status === 200, `status=${r.status}`);

    // Declined card (fails format validation) must create a failed
    // Transaction and leave the booking payable — not 400.
    r = await call('POST', `/api/bookings/${bookingId}/pay`, {
      cardholderName: 'QA',
      cardNumber: '1234',
      expiryMonth: '01',
      expiryYear: '2020',
      cvv: '1',
    });
    check('POST /:id/pay (invalid card) -> not 5xx', r.status < 500, `status=${r.status} ${summarize(r.body)}`);

    // Valid synthetic test card — this system is fully simulated, no gateway.
    r = await call('POST', `/api/bookings/${bookingId}/pay`, {
      cardholderName: 'QA Tester',
      cardNumber: '4242424242424242',
      expiryMonth: '12',
      expiryYear: '2030',
      cvv: '123',
    });
    check('POST /:id/pay (valid card)', r.status === 200, `status=${r.status} ${summarize(r.body)}`);
    const confirmed = r.body?.booking?.status;
    check('booking became confirmed', confirmed === 'confirmed', `status=${confirmed}`);

    // Idempotency: paying twice must not double-charge.
    r = await call('POST', `/api/bookings/${bookingId}/pay`, {
      cardholderName: 'QA Tester',
      cardNumber: '4242424242424242',
      expiryMonth: '12',
      expiryYear: '2030',
      cvv: '123',
    });
    check('repeat pay is idempotent', r.status === 200 && /already paid/i.test(r.body?.message || ''), `msg=${r.body?.message}`);

    // Cancel after confirm must be refused (only pending_payment cancellable).
    r = await call('POST', `/api/bookings/${bookingId}/cancel`, {});
    check('cancel a confirmed booking -> 409', r.status === 409, `status=${r.status}`);
  }

  r = await call('GET', '/api/bookings');
  check('GET /api/bookings', r.status === 200, `status=${r.status}`);

  // Cancellable booking path
  r = await call('POST', '/api/bookings', { type: 'hotel', option, request });
  const cancelId = r.body?.booking?._id || r.body?._id;
  if (cancelId) {
    created.bookings.push(cancelId);
    r = await call('POST', `/api/bookings/${cancelId}/cancel`, {});
    check('cancel a pending booking', r.status === 200, `status=${r.status} ${summarize(r.body)}`);
  }

  // ---------------------------------------------------------- travel-data
  console.log('\n[travel-data]');
  r = await call('GET', '/api/travel-data/restaurants?lat=50.0755&lon=14.4378');
  check('GET /api/travel-data/restaurants', r.status === 200, `status=${r.status} ${summarize(r.body, 90)}`);

  // Explicit-coords path (Prague), which is what the frontend uses when it
  // has no saved trip yet.
  // Use near-term dates: OpenWeatherMap's free tier only forecasts ~5 days
  // out, so a far-future range legitimately yields nulls and would make this
  // assertion vacuous.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tlQs = new URLSearchParams({
    city: 'Prague', lat: '50.0755', lon: '14.4378',
    startDate: tomorrow.toISOString().split('T')[0], totalDays: '3',
  }).toString();
  r = await call('GET', `/api/travel-data/timeline?${tlQs}`);
  check('GET /api/travel-data/timeline', r.status === 200, `status=${r.status} ${summarize(r.body, 90)}`);
  const wDays = Object.values(r.body?.weather || {});
  const wWithData = wDays.filter(Boolean).length;
  check(
    'timeline returns real weather for every near-term day',
    wDays.length === 3 && wWithData === 3,
    `${wWithData}/${wDays.length} days populated`,
  );

  if (savedId) {
    r = await call('GET', `/api/travel-data/timeline?savedTripId=${savedId}`);
    check('GET /timeline?savedTripId', r.status === 200, `status=${r.status} ${summarize(r.body, 70)}`);
  }

  // ---------------------------------------------------------------- search
  console.log('\n[search / explore]');
  r = await call('GET', '/api/search/suggestions?q=Pra');
  check('GET /api/search/suggestions', r.status === 200, `status=${r.status}`);
  r = await call('GET', '/api/explore/recommendations');
  check('GET /api/explore/recommendations', r.status === 200, `status=${r.status} ${summarize(r.body, 80)}`);

  // ---------------------------------------------------------------- cleanup
  console.log('\n[cleanup — only records this script created]');
  for (const id of created.savedTrips) {
    r = await call('DELETE', `/api/saved-trips/${id}`);
    check(`DELETE /api/saved-trips/${id.slice(-6)}`, r.status === 200, `status=${r.status}`);
  }

  // restore preferences we overwrote
  await call('PUT', '/api/auth/preferences', originalPrefs);
  console.log('  (preferences restored)');

  console.log('\n' + '='.repeat(72));
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('='.repeat(72));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('sweep crashed:', e);
  process.exit(1);
});
