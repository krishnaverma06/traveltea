import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { toast } from "react-toastify";
import {
  ArrowLeft, Hotel, Calendar as CalendarIcon, Users, Search,
  Loader2, Star, MapPin, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import DashboardNav from "@/components/DashboardNav";
import BookingCheckout from "@/components/booking/BookingCheckout";
import { getToken, apiSearchHotels } from "@/lib/api";

const isoDate = (d) => format(d, "yyyy-MM-dd");
const today = new Date();
const plusDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

export default function HotelsPage() {
  const navigate = useNavigate();

  const [destination, setDestination] = useState("");
  const [checkIn, setCheckIn] = useState(isoDate(plusDays(7)));
  const [checkOut, setCheckOut] = useState(isoDate(plusDays(9)));
  const [guests, setGuests] = useState(2);

  const [hotels, setHotels] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [checkout, setCheckout] = useState(null);

  // The "number of days" the user is booking for, derived from the dates.
  const nights = Math.max(
    Math.round((new Date(checkOut) - new Date(checkIn)) / 86_400_000),
    0,
  );
  const canSearch = destination.trim() && nights > 0;

  const search = async () => {
    try {
      setLoading(true);
      setError(null);
      setHotels(null);
      const res = await apiSearchHotels(
        { destination: destination.trim(), checkIn, checkOut, adults: guests },
        getToken(),
      );
      setHotels(res.hotels || []);
      setMeta(res);
      if (!res.configured) {
        setError("Hotel search isn't configured on the server (missing SerpAPI key).");
      }
    } catch (err) {
      setError(err.message || "Hotel search failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30">
      <DashboardNav />

      <div className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-6">
          <Button variant="ghost" size="sm" onClick={() => navigate("/plan")}
            className="text-gray-600 hover:text-gray-900 hover:bg-white/50 group normal-case tracking-normal">
            <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
            Back to Planning
          </Button>
          <div className="h-6 w-px bg-gradient-to-b from-transparent via-gray-300 to-transparent" />
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
            Hotels
          </h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Search */}
        <Card className="p-6 bg-white border border-gray-200 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="space-y-2 lg:col-span-1">
              <label className="text-base font-semibold flex items-center gap-2 text-gray-800">
                <MapPin className="w-4 h-4 text-blue-500" /> Destination
              </label>
              <input
                type="text"
                value={destination}
                placeholder="Lisbon"
                onChange={(e) => setDestination(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSearch && search()}
                className="w-full p-3 bg-white border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="space-y-2">
              <label className="text-base font-semibold flex items-center gap-2 text-gray-800">
                <CalendarIcon className="w-4 h-4 text-blue-500" /> Check-in
              </label>
              <input type="date" value={checkIn} min={isoDate(today)}
                onChange={(e) => setCheckIn(e.target.value)}
                className="w-full p-3 bg-white border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="space-y-2">
              <label className="text-base font-semibold flex items-center gap-2 text-gray-800">
                <CalendarIcon className="w-4 h-4 text-pink-500" /> Check-out
              </label>
              <input type="date" value={checkOut} min={checkIn}
                onChange={(e) => setCheckOut(e.target.value)}
                className="w-full p-3 bg-white border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="space-y-2">
              <label className="text-base font-semibold flex items-center gap-2 text-gray-800">
                <Users className="w-4 h-4 text-purple-500" /> Guests
              </label>
              <input type="number" min={1} max={9} value={guests}
                onChange={(e) => setGuests(Math.min(Math.max(Number(e.target.value) || 1, 1), 9))}
                className="w-full p-3 bg-white border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-6">
            <p className="text-sm text-gray-600">
              {nights > 0
                ? <>Staying <span className="font-semibold text-gray-900">{nights} night{nights === 1 ? "" : "s"}</span> · {guests} guest{guests === 1 ? "" : "s"}</>
                : <span className="text-red-600">Check-out must be after check-in.</span>}
            </p>
            <Button onClick={search} disabled={!canSearch || loading}
              className={`h-12 px-8 border-0 font-semibold normal-case tracking-normal text-base ${
                canSearch ? "bg-gradient-to-r from-blue-500 to-pink-500 hover:from-blue-600 hover:to-pink-600 text-white"
                          : "bg-gray-300 text-gray-500 cursor-not-allowed"}`}>
              {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Search className="w-5 h-5 mr-2" />}
              Search hotels
            </Button>
          </div>
        </Card>

        {error && (
          <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            <p className="text-gray-600">Searching hotels in {destination}…</p>
          </div>
        )}

        {!loading && hotels?.length === 0 && !error && (
          <Card className="p-12 text-center bg-white border border-gray-200">
            <Hotel className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600">No hotels found for those dates. Try a different city or date range.</p>
          </Card>
        )}

        {!loading && hotels?.length > 0 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{hotels.length}</span> hotels in{" "}
              <span className="font-semibold text-gray-900">{meta?.query?.destination}</span> · {nights} night{nights === 1 ? "" : "s"}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {hotels.map((h) => (
                <Card key={h.id} className="p-0 overflow-hidden bg-white border border-gray-200 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
                  <div className="h-40 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 relative">
                    {h.image && (
                      <img src={h.image} alt={h.name} loading="lazy"
                        className="w-full h-full object-cover"
                        onError={(e) => { e.target.style.display = "none"; }} />
                    )}
                    {h.rating > 0 && (
                      <span className="absolute top-3 right-3 flex items-center gap-1 bg-white/95 px-2 py-1 rounded-full text-xs font-bold text-gray-900">
                        <Star size={12} className="fill-yellow-400 text-yellow-400" />
                        {Number(h.rating).toFixed(1)}
                      </span>
                    )}
                  </div>

                  <div className="p-5 space-y-3">
                    <div>
                      <h3 className="font-bold text-gray-900 leading-snug line-clamp-2">{h.name}</h3>
                      {h.address && <p className="text-xs text-gray-500 mt-1 line-clamp-1">{h.address}</p>}
                    </div>

                    <div className="flex items-end justify-between gap-3">
                      <div>
                        {h.price?.amount ? (
                          <>
                            <p className="text-xl font-bold text-gray-900">
                              {h.price.currency} {h.price.amount}
                            </p>
                            <p className="text-xs text-gray-500">per night</p>
                          </>
                        ) : (
                          <p className="text-sm text-gray-500">Price on request</p>
                        )}
                      </div>
                      <Button
                        onClick={() => setCheckout({
                          type: "hotel",
                          option: h,
                          request: {
                            type: "hotel", destination: destination.trim(),
                            checkIn, checkOut, guests, confirmed: true,
                          },
                          summary: [
                            { label: "Destination", value: destination.trim() },
                            { label: "Check-in", value: checkIn },
                            { label: "Check-out", value: checkOut },
                            { label: "Nights", value: String(nights) },
                            { label: "Guests", value: String(guests) },
                          ],
                        })}
                        className="bg-gradient-to-r from-blue-500 to-pink-500 hover:from-blue-600 hover:to-pink-600 text-white border-0 font-semibold normal-case tracking-normal rounded-lg px-5">
                        Book
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {checkout && (
        <BookingCheckout
          {...checkout}
          onClose={() => setCheckout(null)}
          onBooked={() => toast.info("View it any time in your profile.")}
        />
      )}
    </div>
  );
}
