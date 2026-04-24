import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Hotel, Plane, Star, Check, X } from "lucide-react";

/**
 * Renders the structured BookingOption[] carried on a message's
 * pendingBooking (Phase 8) — the backend already parses free-text replies
 * like "book option 2" / "yes" / "no thanks" (Phase 7's booking-pipeline),
 * so these buttons just send the equivalent canned message through the
 * normal chat path instead of needing a dedicated confirm API.
 */
export function BookingOptionsCard({
  pendingBooking,
  onSelectOption,
  onConfirm,
  onDecline,
}) {
  const options = pendingBooking?.options || [];
  if (options.length === 0) return null;

  const isFlight = pendingBooking.type === "flight";

  return (
    <div className="mt-2 w-full max-w-sm space-y-2">
      {options.slice(0, 5).map((option, index) => (
        <Card
          key={option.id || index}
          className="flex-row items-center gap-3 p-3 border-gray-200"
        >
          <div className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center">
            {option.image ? (
              <img
                src={option.image}
                alt={option.name}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  e.target.style.display = "none";
                }}
              />
            ) : isFlight ? (
              <Plane className="text-white" size={20} />
            ) : (
              <Hotel className="text-white" size={20} />
            )}
          </div>

          {/* Card's bg-card token stays light regardless of the app's OS-level
              dark-mode styling elsewhere (confirmed: no dark: variant here on
              purpose) — text stays fixed dark-on-light to match, same as
              TripCard.jsx's own Card-internal text. */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {option.name}
            </p>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {option.price && (
                <span className="font-medium text-gray-700">
                  {option.price.currency} {option.price.amount}
                </span>
              )}
              {option.rating != null && (
                <span className="flex items-center gap-0.5">
                  <Star size={12} className="fill-yellow-400 text-yellow-400" />
                  {option.rating}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 truncate">
              {option.priceNote}
            </p>
          </div>

          <Button
            size="xs"
            onClick={() => onSelectOption(index)}
            className="flex-shrink-0 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white normal-case tracking-normal"
          >
            Book this
          </Button>
        </Card>
      ))}

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={onConfirm}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white normal-case tracking-normal"
        >
          <Check size={14} />
          Yes, book the first one
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onDecline}
          className="normal-case tracking-normal"
        >
          <X size={14} />
          No thanks
        </Button>
      </div>
    </div>
  );
}
