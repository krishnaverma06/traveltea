import { Card } from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";

/**
 * Renders the structured bookingResult carried on a message (Phase 8) —
 * populated once bookingExecuteNode (booking-pipeline.ts) actually
 * persists a real Booking/Transaction, or when the user declines. Purely
 * informational, no buttons — unlike BookingOptionsCard this never goes
 * stale, so it's fine to render on any historical message that has it.
 *
 * No dark: variants anywhere here on purpose — Card's bg-card token stays
 * light regardless of the app's OS-level dark-mode styling elsewhere
 * (confirmed live: a dark: text color here renders invisible-on-white),
 * so text stays fixed dark-on-light to match, same as TripCard.jsx's own
 * Card-internal text.
 */
export function BookingReceipt({ bookingResult }) {
  if (!bookingResult) return null;

  if (bookingResult.declined) {
    return (
      <Card className="mt-2 w-full max-w-sm flex-row items-center gap-3 p-3 border-gray-200 bg-gray-50">
        <XCircle className="text-gray-400 flex-shrink-0" size={20} />
        <p className="text-sm text-gray-600">
          Booking declined — nothing was charged.
        </p>
      </Card>
    );
  }

  const { option, bookingReference, transactionId, note } = bookingResult;

  return (
    <Card className="mt-2 w-full max-w-sm p-0 overflow-hidden border-green-200">
      <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border-b border-green-200">
        <CheckCircle2 className="text-green-600" size={20} />
        <span className="text-sm font-semibold text-green-800">
          Booking Confirmed
        </span>
      </div>

      <div className="p-4 space-y-2">
        {option?.name && (
          <p className="text-sm font-semibold text-gray-900">
            {option.name}
          </p>
        )}
        {option?.price && (
          <p className="text-sm text-gray-600">
            {option.price.currency} {option.price.amount}
          </p>
        )}

        <div className="pt-2 space-y-1 text-xs">
          <div className="flex justify-between gap-2">
            <span className="text-gray-500">Booking Reference</span>
            <span className="font-mono text-gray-800">
              {bookingReference}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-gray-500">Transaction ID</span>
            <span className="font-mono text-gray-800">{transactionId}</span>
          </div>
        </div>

        {note && (
          <p className="pt-2 text-xs text-gray-400 italic">{note}</p>
        )}
      </div>
    </Card>
  );
}
