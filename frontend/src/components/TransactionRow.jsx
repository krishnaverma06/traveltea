import React from "react";
import { Plane, Hotel, Receipt } from "lucide-react";

/**
 * One transaction, shared by the Profile summary and the full Transactions
 * page so the two can't drift on how a payment method or a failure is shown.
 *
 * `formatPaymentMethod` lives here rather than in either page for the same
 * reason: the stored snapshot is a tagged union (card / upi / netbanking) and
 * rendering it correctly is a property of the data, not of the page.
 */
export function formatPaymentMethod(pm) {
  if (!pm) return "Payment";
  if (pm.type === "upi") return `UPI ${pm.upiId || ""}`.trim();
  if (pm.type === "netbanking") return `Netbanking — ${pm.bank || ""}`.trim();
  // Older rows predate the `type` tag and are always cards.
  const brand = (pm.brand || "Card").toUpperCase();
  return pm.last4 ? `${brand} ****${pm.last4}` : brand;
}

export default function TransactionRow({ transaction: t }) {
  const Icon = t.booking?.type === "flight" ? Plane : t.booking?.type === "hotel" ? Hotel : Receipt;
  const succeeded = t.status === "succeeded";

  return (
    <div className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3 min-w-0">
        <span
          className={`hidden sm:flex flex-shrink-0 w-9 h-9 rounded-full items-center justify-center ${
            succeeded ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
          }`}
        >
          <Icon className="w-4 h-4" />
        </span>

        {/* min-w-0 is what lets the long booking name actually truncate
            instead of forcing the row wider than its container. */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-900 truncate">
              {t.booking?.option?.name || t.booking?.request?.destination || "Booking"}
            </p>
            <span
              className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                succeeded ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
              }`}
            >
              {t.status}
            </span>
          </div>

          <p className="text-sm text-gray-600 mt-1">
            {formatPaymentMethod(t.paymentMethod)}
            {" · "}
            {new Date(t.createdAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </p>

          <p className="text-xs text-gray-400 font-mono mt-1 break-all">
            {t.booking?.bookingReference
              ? `${t.booking.bookingReference} · ${t.transactionId}`
              : t.transactionId}
          </p>

          {t.failureReason && <p className="text-xs text-red-600 mt-1">{t.failureReason}</p>}
        </div>
      </div>

      <div className="text-right flex-shrink-0">
        <p className="font-bold text-gray-900">
          {t.amount != null ? `${t.currency || ""} ${t.amount}` : "—"}
        </p>
        {t.booking?.type && <p className="text-xs text-gray-500 capitalize">{t.booking.type}</p>}
      </div>
    </div>
  );
}
