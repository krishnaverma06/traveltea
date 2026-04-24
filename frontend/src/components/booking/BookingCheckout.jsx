import React, { useState } from "react";
import { toast } from "react-toastify";
import { X, Loader2, Check, AlertCircle, Hotel, Plane } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BookingReceipt } from "@/components/Chat/BookingReceipt";
import PaymentMethodForm, { usePaymentMethod } from "@/components/booking/PaymentMethodForm";
import { getToken, apiCreateBooking, apiPayBooking } from "@/lib/api";

const STEPS = ["Review", "Payment", "Receipt"];

/**
 * Three-step simulated checkout: review → payment → receipt.
 *
 * Rendered as an inline overlay rather than a dialog primitive — components/ui
 * has no dialog, and the codebase's convention is a conditional panel.
 *
 * NOTE on the payment contract: a declined payment returns HTTP 200 with
 * `status: 'payment_failed'`, so success is decided from the body, never the
 * status code. A 409 means a payment is already in flight, which is a
 * "refetch", not a hard failure.
 */
export default function BookingCheckout({ type, option, request, summary, onClose, onBooked }) {
  const [step, setStep] = useState(0);
  const [booking, setBooking] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const payment = usePaymentMethod();

  const TypeIcon = type === "flight" ? Plane : Hotel;
  const price = option?.price?.amount ? `${option.price.currency || ""} ${option.price.amount}` : "—";

  const createBooking = async () => {
    try {
      setBusy(true);
      setError(null);
      const res = await apiCreateBooking(
        {
          type,
          option: {
            ...option,
            type,
            // The transaction amount is parsed from this, and the schema types
            // it as a String — a number here silently yields a null amount.
            price: option.price
              ? { amount: String(option.price.amount ?? ""), currency: option.price.currency || "USD" }
              : undefined,
            priceNote: option.priceNote || (type === "hotel" ? "per night" : "total"),
          },
          request,
        },
        getToken(),
      );
      setBooking(res.booking);
      setStep(1);
    } catch (err) {
      setError(err.message || "Could not start this booking.");
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    const { payload, error: invalid } = payment.buildPayload();
    if (invalid) {
      setError(invalid);
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const res = await apiPayBooking(booking._id, payload, getToken());

      // Declines arrive as 200 — branch on the body.
      if (res.status === "payment_failed") {
        setError(res.transaction?.failureReason || "Payment was declined. Try another method.");
        return;
      }

      setResult({
        bookingReference: res.booking?.bookingReference,
        transactionId: res.transaction?.transactionId,
        option: res.booking?.option,
        status: res.booking?.status,
      });
      setStep(2);
      toast.success("Booking confirmed! 🎉");
      onBooked?.(res.booking);
    } catch (err) {
      if (err.status === 409) {
        setError("A payment is already being processed for this booking. Give it a moment and try again.");
      } else {
        setError(err.message || "Payment failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 backdrop-blur-sm p-4 py-10">
      <Card className="w-full max-w-lg p-0 overflow-hidden bg-white border border-gray-200 shadow-2xl">
        {/* Header + stepper */}
        <div className="bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 px-6 py-4 text-white">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <TypeIcon className="w-5 h-5" />
              {type === "flight" ? "Book your flight" : "Book your stay"}
            </h2>
            <button onClick={onClose} className="p-1 rounded-full hover:bg-white/20 transition-colors" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-2 mt-4">
            {STEPS.map((label, i) => (
              <React.Fragment key={label}>
                <div className="flex items-center gap-1.5">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    i < step ? "bg-white text-purple-600" : i === step ? "bg-white/90 text-purple-600" : "bg-white/25 text-white/80"
                  }`}>
                    {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
                  </div>
                  <span className={`text-xs font-medium ${i <= step ? "text-white" : "text-white/60"}`}>{label}</span>
                </div>
                {i < STEPS.length - 1 && <div className={`h-px flex-1 ${i < step ? "bg-white" : "bg-white/30"}`} />}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* ---- Step 1: Review ---- */}
          {step === 0 && (
            <>
              <div>
                <p className="text-lg font-bold text-gray-900">{option?.name}</p>
                {option?.address && <p className="text-sm text-gray-600 mt-0.5">{option.address}</p>}
              </div>

              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                {summary.map((row) => (
                  <div key={row.label} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-gray-600">{row.label}</span>
                    <span className="text-sm font-semibold text-gray-900">{row.value}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                  <span className="text-sm font-semibold text-gray-700">Price</span>
                  <span className="text-base font-bold text-gray-900">
                    {price}
                    <span className="text-xs font-normal text-gray-500 ml-1">
                      {option?.priceNote || (type === "hotel" ? "per night" : "")}
                    </span>
                  </span>
                </div>
              </div>

              <Button
                onClick={createBooking}
                disabled={busy}
                className="w-full h-12 bg-gradient-to-r from-blue-500 to-pink-500 hover:from-blue-600 hover:to-pink-600 text-white border-0 font-semibold normal-case tracking-normal text-base"
              >
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Continue to payment
              </Button>
            </>
          )}

          {/* ---- Step 2: Payment ---- */}
          {step === 1 && (
            <>
              <PaymentMethodForm {...payment.formProps} onMethodChange={() => setError(null)} />

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => { setStep(0); setError(null); }} disabled={busy}
                  className="flex-1 h-12 normal-case tracking-normal text-base text-gray-700">
                  Back
                </Button>
                <Button onClick={pay} disabled={busy}
                  className="flex-[2] h-12 bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 text-white border-0 font-semibold normal-case tracking-normal text-base">
                  {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Pay {price}
                </Button>
              </div>
            </>
          )}

          {/* ---- Step 3: Receipt ---- */}
          {step === 2 && result && (
            <div className="space-y-4">
              <BookingReceipt bookingResult={result} />
              <Button onClick={onClose}
                className="w-full h-12 bg-gradient-to-r from-blue-500 to-pink-500 hover:from-blue-600 hover:to-pink-600 text-white border-0 font-semibold normal-case tracking-normal text-base">
                Done
              </Button>
              <p className="text-xs text-center text-gray-500">
                This booking is now in your profile under Transaction History.
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
