import React, { useState } from "react";
import { Loader2, AlertCircle, Plane, Hotel, Check } from "lucide-react";
import PaymentMethodForm, { usePaymentMethod } from "@/components/booking/PaymentMethodForm";
import { getToken, apiPayBooking } from "@/lib/api";

/**
 * The interactive half of the agent-driven trip-planning flow.
 *
 * The agent's markdown already spells out each step in prose; this adds the
 * controls, dispatching on the same `kind` the backend's interrupt payload
 * carries (see trip-planning-pipeline.ts). Option steps just send the
 * equivalent text back through the normal chat path, so clicking a button and
 * typing "2" are the same thing to the agent.
 *
 * Payment is the exception and the reason this component exists: card / UPI
 * details post **directly** to POST /api/bookings/:id/pay. They must never
 * travel as a chat message — chat messages are persisted verbatim to Mongo
 * and replayed to the model. Once every held booking is paid, it sends a
 * plain, detail-free message to resume the paused graph, which then re-reads
 * the bookings from the database rather than trusting that message.
 */
export function TripStepCard({ pendingTrip, onReply }) {
  const kind = pendingTrip?.kind;

  if (kind === "trip_flight_options" || kind === "trip_hotel_options") {
    return <OptionButtons pendingTrip={pendingTrip} onReply={onReply} kind={kind} />;
  }
  if (kind === "trip_payment") {
    return <TripPaymentPanel pendingTrip={pendingTrip} onReply={onReply} />;
  }
  return null;
}

function OptionButtons({ pendingTrip, onReply, kind }) {
  const options = pendingTrip?.options || [];
  if (options.length === 0) return null;

  const isFlight = kind === "trip_flight_options";
  const Icon = isFlight ? Plane : Hotel;

  return (
    <div className="mt-2 w-full space-y-2">
      {options.map((o, i) => (
        <button
          key={o.id || i}
          onClick={() => onReply(`option ${i + 1}`)}
          className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50/50 transition-all text-left"
        >
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-pink-500 text-white text-xs font-bold flex items-center justify-center">
            {i + 1}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-gray-900 truncate">{o.name}</span>
            <span className="block text-xs text-gray-500 truncate">{o.priceNote}</span>
          </span>
          {o.price && (
            <span className="flex-shrink-0 text-sm font-bold text-gray-900">
              {o.price.currency} {o.price.amount}
            </span>
          )}
        </button>
      ))}

      <button
        onClick={() => onReply(isFlight ? "skip flights" : "skip the hotel")}
        className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-dashed border-gray-300 text-xs font-medium text-gray-500 hover:text-gray-700 hover:border-gray-400 transition-colors"
      >
        <Icon className="w-3.5 h-3.5" />
        Skip {isFlight ? "flights" : "the hotel"} — I'll sort that myself
      </button>
    </div>
  );
}

function TripPaymentPanel({ pendingTrip, onReply }) {
  const bookings = pendingTrip?.bookings || [];
  const payment = usePaymentMethod();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [paidIds, setPaidIds] = useState([]);

  const outstanding = bookings.filter((b) => !paidIds.includes(b.id));
  const total = bookings.reduce((sum, b) => sum + (Number(b.price?.amount) || 0), 0);
  const currency = bookings.find((b) => b.price?.currency)?.price?.currency || "USD";

  const pay = async () => {
    const { payload, error: invalid } = payment.buildPayload();
    if (invalid) {
      setError(invalid);
      return;
    }

    setBusy(true);
    setError(null);
    const token = getToken();
    const settled = [...paidIds];

    try {
      // Sequential, not Promise.all: a decline on the second booking should
      // leave the first one paid and reported as such, not race alongside it.
      for (const booking of outstanding) {
        const res = await apiPayBooking(booking.id, payload, token);

        // Declines arrive as HTTP 200 — branch on the body, never the status.
        if (res.status === "payment_failed") {
          setPaidIds(settled);
          setError(
            res.transaction?.failureReason ||
              `Payment for ${booking.name} was declined. Try another method.`,
          );
          return;
        }
        settled.push(booking.id);
      }

      setPaidIds(settled);
      // Detail-free by design — the agent verifies against the database.
      onReply("payment done");
    } catch (err) {
      setPaidIds(settled);
      if (err.status === 409) {
        setError("A payment is already going through for one of these. Give it a moment and try again.");
      } else {
        setError(err.message || "Payment failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 w-full rounded-2xl border border-gray-200 bg-white p-4 space-y-4 shadow-sm">
      <div className="space-y-2">
        {bookings.map((b) => {
          const done = paidIds.includes(b.id);
          return (
            <div key={b.id} className="flex items-center gap-2.5">
              <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
                done ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
              }`}>
                {done ? <Check className="w-3.5 h-3.5" />
                      : b.type === "flight" ? <Plane className="w-3.5 h-3.5" /> : <Hotel className="w-3.5 h-3.5" />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-gray-900 truncate">{b.name}</span>
                <span className="block text-xs text-gray-400 font-mono">{b.reference}</span>
              </span>
              {b.price && (
                <span className="text-sm font-semibold text-gray-900 flex-shrink-0">
                  {b.price.currency} {b.price.amount}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <PaymentMethodForm {...payment.formProps} onMethodChange={() => setError(null)} />

      <button
        onClick={pay}
        disabled={busy || outstanding.length === 0}
        className="w-full h-11 flex items-center justify-center rounded-lg bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 disabled:opacity-60 text-white font-semibold text-sm transition-all"
      >
        {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        Pay {currency} {total || ""}
      </button>
    </div>
  );
}
