import { Booking, IBooking, BookingType, BookingSource } from '../models/Booking.js';
import { Transaction, ITransaction } from '../models/Transaction.js';
import { generateBookingReference, generateTransactionId } from '../utils/idGenerator.js';
import type { BookingOption, BookingRequest } from '../agents/booking-pipeline.js';

export interface CreateBookingInput {
  type: BookingType;
  option: BookingOption;
  request: BookingRequest;
  source: BookingSource;
  conversationId?: string;
}

export interface DummyCardInput {
  cardholderName: string;
  cardNumber: string;
  expiryMonth: string | number;
  expiryYear: string | number;
  cvv: string;
}

/** Payment methods the simulated checkout accepts. */
export type PaymentMethodType = 'card' | 'upi' | 'netbanking';

export type PaymentInput =
  | { method: 'card'; card: DummyCardInput }
  | { method: 'upi'; upiId: string }
  | { method: 'netbanking'; bank: string };

/**
 * A well-formed card number that always declines.
 *
 * validateCardFormat does format checks only — no Luhn, no issuer rules — so
 * before this the ONLY way to produce a `failed` transaction was malformed
 * input, which the /pay controller rejects with a 400 before the service ever
 * sees it. That left the "payment declined, try another card" branch of a real
 * checkout unreachable and untestable. This is the standard test PAN for the
 * purpose, and the whole payment path is simulated anyway.
 */
export const DECLINE_TEST_CARD = '4000000000000002';

/** Banks offered by the simulated netbanking option. */
export const SUPPORTED_BANKS = [
  'HDFC Bank',
  'ICICI Bank',
  'State Bank of India',
  'Axis Bank',
  'Kotak Mahindra Bank',
  'Punjab National Bank',
] as const;

export interface PaymentResult {
  booking: IBooking;
  transaction: ITransaction;
  alreadyPaid?: boolean;
}

export class BookingNotFoundError extends Error {}
export class PaymentInProgressError extends Error {}
export class BookingNotPayableError extends Error {}

const MAX_ID_RETRIES = 3;

/** A payment takes milliseconds; a claim older than this was stranded by a crash. */
const STALE_CLAIM_MS = 2 * 60 * 1000;

/** Retries on a Mongo duplicate-key error (11000) — reuses the model's own
 * unique-index guarantee instead of a racy pre-check-then-insert. */
async function withUniqueIdRetry<T>(create: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
    try {
      return await create();
    } catch (err: any) {
      if (err?.code === 11000) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export async function createBooking(userId: string, input: CreateBookingInput): Promise<IBooking> {
  return withUniqueIdRetry(() =>
    Booking.create({
      bookingReference: generateBookingReference(),
      user: userId,
      type: input.type,
      status: 'pending_payment',
      option: input.option,
      request: input.request,
      source: input.source,
      conversationId: input.conversationId || null,
    })
  );
}

/** Superficial format checks only — never a real gateway call. */
export function validateCardFormat(card: DummyCardInput): { valid: boolean; reason?: string } {
  const digits = String(card.cardNumber || '').replace(/\s/g, '');
  if (!/^\d{13,19}$/.test(digits)) {
    return { valid: false, reason: 'Card number must be 13-19 digits.' };
  }

  const month = Number(card.expiryMonth);
  const yearInput = Number(card.expiryYear);
  if (!month || month < 1 || month > 12) {
    return { valid: false, reason: 'Invalid expiry month.' };
  }
  const year = yearInput < 100 ? 2000 + yearInput : yearInput;
  const expiry = new Date(year, month); // 1st of the month AFTER expiry — still valid through the expiry month itself
  if (expiry < new Date()) {
    return { valid: false, reason: 'Card has expired.' };
  }

  if (!/^\d{3,4}$/.test(String(card.cvv || ''))) {
    return { valid: false, reason: 'Invalid CVV.' };
  }

  if (!card.cardholderName || card.cardholderName.trim().length < 2) {
    return { valid: false, reason: 'Cardholder name is required.' };
  }

  return { valid: true };
}

function guessBrand(cardNumber: string): string {
  const digits = cardNumber.replace(/\s/g, '');
  if (digits.startsWith('4')) return 'VISA';
  if (digits.startsWith('5')) return 'MASTERCARD';
  if (digits.startsWith('3')) return 'AMEX';
  return 'CARD';
}

/**
 * Validates whichever payment method was chosen. Card keeps the original
 * format-only checks; UPI and netbanking get shape checks appropriate to them.
 * Returns the masked snapshot to persist — never the raw instrument.
 */
export function validatePayment(input: PaymentInput): {
  valid: boolean;
  reason?: string;
  snapshot: Record<string, unknown>;
} {
  if (input.method === 'card') {
    const digits = String(input.card?.cardNumber || '').replace(/\s/g, '');
    const snapshot = {
      type: 'card' as const,
      brand: guessBrand(digits),
      last4: digits.slice(-4) || '0000',
    };

    const format = validateCardFormat(input.card);
    if (!format.valid) return { ...format, snapshot };

    if (digits === DECLINE_TEST_CARD) {
      return { valid: false, reason: 'Card declined by issuer.', snapshot };
    }
    return { valid: true, snapshot };
  }

  if (input.method === 'upi') {
    const upiId = String(input.upiId || '').trim();
    // handle@provider — store the handle only, never a PIN (we never ask for one).
    const snapshot = { type: 'upi' as const, upiId };
    if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upiId)) {
      return { valid: false, reason: 'Enter a valid UPI ID, e.g. name@bank.', snapshot };
    }
    return { valid: true, snapshot };
  }

  if (input.method === 'netbanking') {
    const bank = String(input.bank || '').trim();
    const snapshot = { type: 'netbanking' as const, bank };
    if (!(SUPPORTED_BANKS as readonly string[]).includes(bank)) {
      return { valid: false, reason: 'Select a supported bank.', snapshot };
    }
    return { valid: true, snapshot };
  }

  return {
    valid: false,
    reason: 'Unsupported payment method.',
    snapshot: { type: 'card' as const, brand: 'CARD', last4: '0000' },
  };
}

/** Shared by submitPayment and autoPayDummy — creates the Transaction (masked
 * snapshot only) and updates Booking.status accordingly. Assumes the caller
 * already holds the paymentInFlight claim (see submitPayment). */
async function processPayment(
  booking: IBooking,
  input: PaymentInput,
): Promise<{ booking: IBooking; transaction: ITransaction }> {
  const check = validatePayment(input);
  const amount = booking.option?.price?.amount != null ? Number(booking.option.price.amount) : null;
  const currency = booking.option?.price?.currency ?? null;

  try {
    const transaction = await withUniqueIdRetry(() =>
      Transaction.create({
        transactionId: generateTransactionId(),
        booking: booking._id,
        user: booking.user,
        amount: Number.isFinite(amount) ? amount : null,
        currency,
        status: check.valid ? 'succeeded' : 'failed',
        // Masked snapshot only — never a PAN, CVV or UPI PIN.
        paymentMethod: check.snapshot,
        failureReason: check.valid ? null : check.reason,
      })
    );

    // A declined payment leaves the booking retry-friendly (still
    // pending_payment) rather than terminal — matches real checkout UX where
    // a declined card doesn't cancel the order.
    booking.status = check.valid ? 'confirmed' : 'pending_payment';
    await booking.save();

    return { booking, transaction };
  } finally {
    // Release the claim on EVERY path, including a throw.
    //
    // Previously this only ran on the happy path, so if Transaction.create
    // (after its dup-key retries) or booking.save() threw, paymentInFlight was
    // left true forever — with no TTL and no sweeper, that booking became
    // permanently unpayable and every retry returned 409. Harmless while only
    // autoPayDummy called this; unacceptable once a real user is retrying a
    // card. Best-effort: a failure to release must not mask the original error.
    try {
      if (booking.paymentInFlight) {
        await Booking.updateOne({ _id: booking._id }, { $set: { paymentInFlight: false } });
        booking.paymentInFlight = false;
      }
    } catch {
      /* the stale-claim reclaim in submitPayment is the backstop */
    }
  }
}

/**
 * Real dummy-card-shaped input from the REST /pay route (or autoPayDummy's
 * synthesized card). Format-invalid input still creates a `failed`
 * Transaction rather than being rejected outright — a well-formed-but-
 * declined card is a realistic "payment declined" outcome, not a broken
 * request; gives a future UI a real record to render.
 */
export async function submitPayment(
  bookingId: string,
  userId: string,
  input: PaymentInput,
): Promise<PaymentResult> {
  const booking = await Booking.findOne({ _id: bookingId, user: userId });
  if (!booking) throw new BookingNotFoundError('Booking not found');

  // Idempotent replay: already paid, don't reprocess.
  if (booking.status === 'confirmed') {
    const existing = await Transaction.findOne({ booking: booking._id, status: 'succeeded' }).sort({ createdAt: -1 });
    if (existing) return { booking, transaction: existing, alreadyPaid: true };
  }

  if (booking.status === 'cancelled') {
    throw new BookingNotPayableError('This booking has been cancelled and can no longer be paid.');
  }

  // Atomic claim — closes the double-submit race a plain status check can't.
  let claimed = await Booking.findOneAndUpdate(
    { _id: bookingId, user: userId, status: 'pending_payment', paymentInFlight: { $ne: true } },
    { $set: { paymentInFlight: true } },
    { new: true }
  );

  if (!claimed) {
    // Backstop for a claim stranded by a crash between the claim and the
    // finally-release (a process kill, not an exception). Without this a
    // single hard failure would make the booking unpayable forever. A payment
    // takes milliseconds, so a claim older than this is not in flight.
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
    claimed = await Booking.findOneAndUpdate(
      {
        _id: bookingId,
        user: userId,
        status: 'pending_payment',
        paymentInFlight: true,
        updatedAt: { $lt: staleBefore },
      },
      { $set: { paymentInFlight: true } },
      { new: true }
    );
    if (claimed) {
      console.warn(`[booking] reclaimed stale payment lock on ${claimed.bookingReference}`);
    }
  }

  if (!claimed) {
    throw new PaymentInProgressError('A payment is already being processed for this booking.');
  }

  return processPayment(claimed, input);
}

/**
 * Chat path — synthesizes an internally-generated, obviously-fake, always-
 * valid card snapshot and calls the exact same submitPayment used by the
 * REST route, guaranteeing success. Never real user input.
 */
export async function autoPayDummy(bookingId: string, userId: string): Promise<PaymentResult> {
  const card: DummyCardInput = {
    cardholderName: 'TravelTea AutoPay',
    cardNumber: '4242424242424242',
    expiryMonth: 12,
    expiryYear: new Date().getFullYear() + 3,
    cvv: '123',
  };
  return submitPayment(bookingId, userId, { method: 'card', card });
}

export async function getBooking(bookingId: string, userId: string): Promise<{ booking: IBooking; transactions: ITransaction[] } | null> {
  const booking = await Booking.findOne({ _id: bookingId, user: userId });
  if (!booking) return null;
  const transactions = await Transaction.find({ booking: booking._id }).sort({ createdAt: -1 });
  return { booking, transactions };
}

export async function listBookings(
  userId: string,
  opts: { page?: number; limit?: number } = {}
): Promise<{ bookings: IBooking[]; total: number; page: number; pages: number }> {
  const page = Math.max(opts.page || 1, 1);
  const limit = Math.min(opts.limit || 10, 50);

  const [bookings, total] = await Promise.all([
    Booking.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Booking.countDocuments({ user: userId }),
  ]);

  return { bookings, total, page, pages: Math.max(Math.ceil(total / limit), 1) };
}

/** Only cancellable while pending_payment — a confirmed booking would need a
 * refund-shaped flow, out of scope for this simulated system. */
/**
 * A user's payment attempts across every booking, newest first.
 *
 * `Transaction.user` is denormalised and indexed `{user:1, createdAt:-1}`
 * precisely so this needs no join. The booking is populated only for the few
 * fields the history UI renders.
 */
export async function listTransactions(
  userId: string,
  opts: { page?: number; limit?: number } = {}
): Promise<{ transactions: ITransaction[]; total: number; page: number; pages: number }> {
  const page = Math.max(opts.page || 1, 1);
  const limit = Math.min(Math.max(opts.limit || 20, 1), 100);

  const [transactions, total] = await Promise.all([
    Transaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('booking', 'bookingReference type status option.name request.destination'),
    Transaction.countDocuments({ user: userId }),
  ]);

  return { transactions, total, page, pages: Math.max(Math.ceil(total / limit), 1) };
}

export async function cancelBooking(bookingId: string, userId: string): Promise<IBooking> {
  const booking = await Booking.findOne({ _id: bookingId, user: userId });
  if (!booking) throw new BookingNotFoundError('Booking not found');
  if (booking.status !== 'pending_payment') {
    throw new BookingNotPayableError(`Booking is ${booking.status} and can no longer be cancelled.`);
  }
  booking.status = 'cancelled';
  await booking.save();
  return booking;
}
