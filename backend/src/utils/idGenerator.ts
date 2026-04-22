import { randomBytes } from 'crypto';

// Excludes visually-confusable characters (0/O, 1/I) for a human-readable code.
const REF_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += REF_CHARSET[bytes[i] % REF_CHARSET.length];
  }
  return out;
}

/**
 * e.g. "TT-7K4QXPMN" — human-readable booking reference. No collision
 * pre-check (racy anyway); relies on the Booking model's unique index to
 * reject an actual collision, retried by the caller.
 */
export function generateBookingReference(): string {
  return `TT-${randomCode(8)}`;
}

/** e.g. "TXN-Q3F8K2LX9P" — visually distinct prefix from booking references. */
export function generateTransactionId(): string {
  return `TXN-${randomCode(10)}`;
}
