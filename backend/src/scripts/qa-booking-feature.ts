import 'dotenv/config';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

/**
 * Covers the Flights & Hotels feature: search endpoints, the airport
 * autocomplete, all three payment methods, the declined-card retry path, the
 * paymentInFlight lock release, and transaction history.
 *
 * Run: npm run qa:booking
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

async function call(method: string, path: string, body?: any) {
  const res = await fetch(BASE + path, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

const iso = (d: Date) => d.toISOString().split('T')[0];
const soon = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return iso(d);
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);

  console.log('='.repeat(72));
  console.log('Flights & Hotels feature');
  console.log('='.repeat(72));

  // ── airports ──────────────────────────────────────────────────────────────
  console.log('\n[airports]');
  let r = await call('GET', '/api/travel-search/airports?q=del');
  check('airport lookup', r.status === 200 && r.body.airports?.length > 0,
    `${r.body.airports?.[0]?.iata} ${r.body.airports?.[0]?.city}`);
  check('DEL ranks first for "del"', r.body.airports?.[0]?.iata === 'DEL');

  r = await call('GET', '/api/travel-search/airports?q=goa');
  check('Goa found', !!r.body.airports?.some((a: any) => a.city === 'Goa'),
    r.body.airports?.map((a: any) => a.iata).join(','));

  // ── flights, by CITY NAME (the IATA resolver test) ────────────────────────
  console.log('\n[flight search — city names, the IATA-resolver test]');
  r = await call('GET', `/api/travel-search/flights?origin=Delhi&destination=Mumbai&departDate=${soon(21)}`);
  check('flights by city name -> 200', r.status === 200,
    `count=${r.body.count} configured=${r.body.configured}`);
  check('resolver produced results', (r.body.count ?? 0) > 0,
    r.body.count === 0
      ? 'ZERO — resolver or SerpAPI issue'
      : `${r.body.flights?.[0]?.airline} ${r.body.flights?.[0]?.departure?.iata}->${r.body.flights?.[0]?.arrival?.iata}`);
  check('reports configured flag', typeof r.body.configured === 'boolean');

  r = await call('GET', '/api/travel-search/flights?origin=Delhi');
  check('missing params -> 400', r.status === 400, r.body.error);

  // ── hotels ────────────────────────────────────────────────────────────────
  console.log('\n[hotel search]');
  r = await call('GET', `/api/travel-search/hotels?destination=Lisbon&checkIn=${soon(21)}&checkOut=${soon(23)}`);
  check('hotels -> 200', r.status === 200, `count=${r.body.count} nights=${r.body.query?.nights}`);
  check('nights derived from dates', r.body.query?.nights === 2, `nights=${r.body.query?.nights}`);
  check('hotels returned', (r.body.count ?? 0) > 0);
  const hotel = r.body.hotels?.[0];

  // ── booking + three payment methods ───────────────────────────────────────
  console.log('\n[booking + all three payment methods]');
  const mkBooking = async (): Promise<string | undefined> => {
    const res = await call('POST', '/api/bookings', {
      type: 'hotel',
      option: {
        id: hotel?.id || 'qa-hotel',
        type: 'hotel',
        name: hotel?.name || 'QA Hotel',
        priceNote: 'per night',
        price: {
          amount: String(hotel?.price?.amount || '99'),
          currency: hotel?.price?.currency || 'USD',
        },
      },
      request: {
        type: 'hotel',
        destination: 'Lisbon',
        checkIn: soon(21),
        checkOut: soon(23),
        guests: 2,
        confirmed: true,
      },
    });
    return res.body?.booking?._id;
  };

  const methods: Array<[string, any]> = [
    ['card', { method: 'card', cardholderName: 'QA Tester', cardNumber: '4242424242424242', expiryMonth: '12', expiryYear: '2030', cvv: '123' }],
    ['upi', { method: 'upi', upiId: 'qatester@hdfc' }],
    ['netbanking', { method: 'netbanking', bank: 'HDFC Bank' }],
  ];

  for (const [label, payload] of methods) {
    const id = await mkBooking();
    const pay = await call('POST', `/api/bookings/${id}/pay`, payload);
    check(`pay with ${label}`, pay.status === 200 && pay.body.status === 'confirmed',
      `status=${pay.body.status} type=${pay.body.transaction?.paymentMethod?.type}`);
    check(`  ${label} snapshot typed correctly`,
      pay.body.transaction?.paymentMethod?.type === label,
      JSON.stringify(pay.body.transaction?.paymentMethod));
  }

  // ── decline → retry (proves the lock is released) ─────────────────────────
  console.log('\n[declined card leaves the booking retryable]');
  const declineId = await mkBooking();
  const declined = await call('POST', `/api/bookings/${declineId}/pay`, {
    method: 'card', cardholderName: 'QA', cardNumber: '4000000000000002',
    expiryMonth: '12', expiryYear: '2030', cvv: '123',
  });
  check('decline -> HTTP 200 with payment_failed',
    declined.status === 200 && declined.body.status === 'payment_failed',
    `status=${declined.body.status} reason=${declined.body.transaction?.failureReason}`);
  check('booking stays pending_payment', declined.body.booking?.status === 'pending_payment',
    declined.body.booking?.status);

  const retry = await call('POST', `/api/bookings/${declineId}/pay`, {
    method: 'card', cardholderName: 'QA', cardNumber: '4242424242424242',
    expiryMonth: '12', expiryYear: '2030', cvv: '123',
  });
  check('retry after decline succeeds (lock was released)',
    retry.status === 200 && retry.body.status === 'confirmed', `status=${retry.body.status}`);

  const again = await call('POST', `/api/bookings/${declineId}/pay`, { method: 'upi', upiId: 'x@ybank' });
  check('repeat pay is idempotent', again.body?.message === 'Booking already paid', again.body?.message);

  // ── validation ────────────────────────────────────────────────────────────
  console.log('\n[validation]');
  const badMethodId = await mkBooking();
  const bad = await call('POST', `/api/bookings/${badMethodId}/pay`, { method: 'crypto' });
  check('unknown payment method -> 400', bad.status === 400, bad.body.error);

  const badUpiId = await mkBooking();
  const badUpi = await call('POST', `/api/bookings/${badUpiId}/pay`, { method: 'upi', upiId: 'nonsense' });
  check('malformed UPI id -> declined, not crash',
    badUpi.status === 200 && badUpi.body.status === 'payment_failed',
    `status=${badUpi.body.status} reason=${badUpi.body.transaction?.failureReason}`);

  r = await call('GET', '/api/bookings/not-a-real-id');
  check('bad booking id -> 400 not 500', r.status === 400, `status=${r.status} ${r.body.error}`);

  // ── transaction history ───────────────────────────────────────────────────
  console.log('\n[transaction history]');
  r = await call('GET', '/api/transactions?limit=10');
  check('GET /api/transactions', r.status === 200 && Array.isArray(r.body.transactions),
    `total=${r.body.pagination?.total}`);
  const t0 = r.body.transactions?.[0];
  check('newest-first with populated booking', !!t0?.booking?.bookingReference,
    t0 ? `${t0.transactionId} ${t0.paymentMethod?.type} ${t0.booking?.bookingReference}` : '');

  const serialized = JSON.stringify(r.body.transactions || []);
  check('no card number ever stored',
    !/4242424242424242|4000000000000002/.test(serialized),
    'a PAN must never appear in a transaction');

  console.log('\n' + '='.repeat(72));
  console.log(`RESULT: ${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('='.repeat(72));

  await mongoose.disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('qa-booking-feature crashed:', e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
