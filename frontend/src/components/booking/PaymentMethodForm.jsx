import React, { useState } from "react";
import { CreditCard, Smartphone, Landmark, ShieldCheck } from "lucide-react";

export const BANKS = [
  "HDFC Bank", "ICICI Bank", "State Bank of India",
  "Axis Bank", "Kotak Mahindra Bank", "Punjab National Bank",
];

const METHODS = [
  { id: "card", label: "Card", icon: CreditCard },
  { id: "upi", label: "UPI", icon: Smartphone },
  { id: "netbanking", label: "Netbanking", icon: Landmark },
];

/**
 * Payment method picker + fields, shared by the checkout overlay on the
 * flights/hotels pages and the inline panel the chat agent shows mid-flow.
 *
 * Extracted rather than duplicated so the two surfaces can't drift on the
 * thing that matters most here: the "simulated payment, nothing stored"
 * notice and the exact payload shape POST /api/bookings/:id/pay expects.
 *
 * `usePaymentMethod` owns the state and returns `buildPayload()`, which
 * returns either `{payload}` or `{error}` — validation and shape live
 * together, so a caller can't accidentally post a half-filled card.
 */
export function usePaymentMethod() {
  const [method, setMethod] = useState("card");
  const [card, setCard] = useState({
    cardholderName: "", cardNumber: "", expiryMonth: "", expiryYear: "", cvv: "",
  });
  const [upiId, setUpiId] = useState("");
  const [bank, setBank] = useState(BANKS[0]);

  const buildPayload = () => {
    if (method === "card") {
      const { cardholderName, cardNumber, expiryMonth, expiryYear, cvv } = card;
      if (!cardholderName || !cardNumber || !expiryMonth || !expiryYear || !cvv) {
        return { error: "Please fill in every card field." };
      }
      return { payload: { method: "card", cardholderName, cardNumber, expiryMonth, expiryYear, cvv } };
    }
    if (method === "upi") {
      if (!upiId.trim()) return { error: "Enter your UPI ID." };
      return { payload: { method: "upi", upiId: upiId.trim() } };
    }
    return { payload: { method: "netbanking", bank } };
  };

  return {
    method, setMethod, card, setCard, upiId, setUpiId, bank, setBank, buildPayload,
    formProps: { method, setMethod, card, setCard, upiId, setUpiId, bank, setBank },
  };
}

export default function PaymentMethodForm({
  method, setMethod, card, setCard, upiId, setUpiId, bank, setBank, onMethodChange,
}) {
  return (
    <>
      <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <ShieldCheck className="w-4 h-4 text-amber-600 flex-shrink-0" />
        <p className="text-xs text-amber-900">
          <strong>Simulated payment.</strong> No real charge is made and no card number is stored.
        </p>
      </div>

      <div className="flex gap-2">
        {METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => { setMethod(m.id); onMethodChange?.(); }}
            className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-xl border text-xs font-semibold transition-all ${
              method === m.id
                ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white border-transparent shadow-lg"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            <m.icon className="w-4 h-4" />
            {m.label}
          </button>
        ))}
      </div>

      {method === "card" && (
        <div className="space-y-3">
          <Field label="Cardholder name" value={card.cardholderName}
            onChange={(v) => setCard({ ...card, cardholderName: v })} placeholder="As printed on the card" />
          <Field label="Card number" value={card.cardNumber}
            onChange={(v) => setCard({ ...card, cardNumber: v })} placeholder="4242 4242 4242 4242" inputMode="numeric" />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Month" value={card.expiryMonth} onChange={(v) => setCard({ ...card, expiryMonth: v })} placeholder="12" inputMode="numeric" />
            <Field label="Year" value={card.expiryYear} onChange={(v) => setCard({ ...card, expiryYear: v })} placeholder="2030" inputMode="numeric" />
            <Field label="CVV" value={card.cvv} onChange={(v) => setCard({ ...card, cvv: v })} placeholder="123" inputMode="numeric" />
          </div>
          <p className="text-xs text-gray-500">
            Test cards — <code className="font-mono">4242 4242 4242 4242</code> succeeds,{" "}
            <code className="font-mono">4000 0000 0000 0002</code> is declined.
          </p>
        </div>
      )}

      {method === "upi" && (
        <Field label="UPI ID" value={upiId} onChange={setUpiId} placeholder="yourname@bank" />
      )}

      {method === "netbanking" && (
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">Bank</label>
          <select
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            className="w-full p-3 bg-white border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500"
          >
            {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      )}
    </>
  );
}

function Field({ label, value, onChange, placeholder, inputMode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-3 bg-white border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
      />
    </div>
  );
}
