import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { toast } from "react-toastify";
import {
  ArrowLeft, Plane, PlaneLanding, Calendar as CalendarIcon, Users,
  Search, Loader2, Clock, AlertCircle, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import DashboardNav from "@/components/DashboardNav";
import AirportInput from "@/components/AirportInput";
import BookingCheckout from "@/components/booking/BookingCheckout";
import { getToken, apiSearchFlights } from "@/lib/api";

const isoDate = (d) => format(d, "yyyy-MM-dd");
const today = new Date();
const plusDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

const when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export default function FlightsPage() {
  const navigate = useNavigate();

  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [departDate, setDepartDate] = useState(isoDate(plusDays(14)));
  const [returnDate, setReturnDate] = useState("");
  const [passengers, setPassengers] = useState(1);

  const [flights, setFlights] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [checkout, setCheckout] = useState(null);

  const canSearch = from?.iata && to?.iata && departDate;

  const search = async () => {
    try {
      setLoading(true);
      setError(null);
      setFlights(null);
      const res = await apiSearchFlights(
        {
          origin: from.iata,
          destination: to.iata,
          departDate,
          ...(returnDate ? { returnDate } : {}),
          adults: passengers,
        },
        getToken(),
      );
      setFlights(res.flights || []);
      if (!res.configured) {
        setError("Flight search isn't configured on the server (missing SerpAPI key).");
      }
    } catch (err) {
      setError(err.message || "Flight search failed.");
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
            Flights
          </h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <Card className="p-6 bg-white border border-gray-200 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <AirportInput label="From" value={from} onChange={setFrom}
              placeholder="Delhi, or DEL" icon={Plane} />
            <AirportInput label="To" value={to} onChange={setTo}
              placeholder="Mumbai, or BOM" icon={PlaneLanding} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-5">
            <div className="space-y-2">
              <label className="text-base font-semibold flex items-center gap-2 text-gray-800">
                <CalendarIcon className="w-4 h-4 text-blue-500" /> Departure
              </label>
              <input type="date" value={departDate} min={isoDate(today)}
                onChange={(e) => setDepartDate(e.target.value)}
                className="w-full p-3 bg-white border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="space-y-2">
              <label className="text-base font-semibold flex items-center gap-2 text-gray-800">
                <CalendarIcon className="w-4 h-4 text-pink-500" /> Return
                <span className="text-xs font-normal text-gray-500">(optional)</span>
              </label>
              <input type="date" value={returnDate} min={departDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="w-full p-3 bg-white border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500" />
            </div>

            <div className="space-y-2">
              <label className="text-base font-semibold flex items-center gap-2 text-gray-800">
                <Users className="w-4 h-4 text-purple-500" /> Passengers
              </label>
              <input type="number" min={1} max={9} value={passengers}
                onChange={(e) => setPassengers(Math.min(Math.max(Number(e.target.value) || 1, 1), 9))}
                className="w-full p-3 bg-white border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-6">
            <p className="text-sm text-gray-600">
              {canSearch
                ? <>{from.label} <ArrowRight className="w-3 h-3 inline mx-1" /> {to.label} · {returnDate ? "round trip" : "one way"}</>
                : "Pick an origin and destination airport to search."}
            </p>
            <Button onClick={search} disabled={!canSearch || loading}
              className={`h-12 px-8 border-0 font-semibold normal-case tracking-normal text-base ${
                canSearch ? "bg-gradient-to-r from-blue-500 to-pink-500 hover:from-blue-600 hover:to-pink-600 text-white"
                          : "bg-gray-300 text-gray-500 cursor-not-allowed"}`}>
              {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Search className="w-5 h-5 mr-2" />}
              Search flights
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
            <p className="text-gray-600">Searching flights…</p>
          </div>
        )}

        {!loading && flights?.length === 0 && !error && (
          <Card className="p-12 text-center bg-white border border-gray-200">
            <Plane className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600">No flights found for that route and date. Try a nearby date.</p>
          </Card>
        )}

        {!loading && flights?.length > 0 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{flights.length}</span> flights ·{" "}
              {from.label} <ArrowRight className="w-3 h-3 inline" /> {to.label}
            </p>

            <div className="space-y-3">
              {flights.slice(0, 30).map((f) => (
                <Card key={f.id} className="p-5 bg-white border border-gray-200 shadow-sm hover:shadow-lg transition-all">
                  <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
                    <div className="flex items-center gap-3 md:w-48 flex-shrink-0">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                        <Plane className="w-5 h-5 text-white" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-gray-900 truncate">{f.airline}</p>
                        <p className="text-xs text-gray-500">
                          {f.stops === 0 ? "Non-stop" : `${f.stops} stop${f.stops === 1 ? "" : "s"}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 flex-1">
                      <div>
                        <p className="text-lg font-bold text-gray-900">{f.departure?.iata}</p>
                        <p className="text-xs text-gray-500">{when(f.departure?.at)}</p>
                      </div>
                      <div className="flex-1 flex flex-col items-center min-w-[80px]">
                        <div className="w-full h-px bg-gray-300 relative">
                          <ArrowRight className="w-3 h-3 text-gray-400 absolute -right-1 -top-1.5" />
                        </div>
                        {f.duration && (
                          <span className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                            <Clock className="w-3 h-3" />{f.duration}
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="text-lg font-bold text-gray-900">{f.arrival?.iata}</p>
                        <p className="text-xs text-gray-500">{when(f.arrival?.at)}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-4 md:w-56 flex-shrink-0">
                      <div className="text-right">
                        {f.price?.amount ? (
                          <p className="text-xl font-bold text-gray-900">
                            {f.price.currency} {f.price.amount}
                          </p>
                        ) : (
                          <p className="text-sm text-gray-500">Price on request</p>
                        )}
                      </div>
                      <Button
                        onClick={() => setCheckout({
                          type: "flight",
                          option: {
                            ...f,
                            name: `${f.airline} — ${f.departure?.iata} → ${f.arrival?.iata}`,
                            priceNote: "total",
                          },
                          request: {
                            type: "flight",
                            destination: to.label,
                            origin: from.label,
                            departDate,
                            ...(returnDate ? { returnDate } : {}),
                            guests: passengers,
                            confirmed: true,
                          },
                          summary: [
                            { label: "Route", value: `${from.label} → ${to.label}` },
                            { label: "Airline", value: f.airline },
                            { label: "Departure", value: when(f.departure?.at) || departDate },
                            ...(returnDate ? [{ label: "Return", value: returnDate }] : []),
                            { label: "Passengers", value: String(passengers) },
                          ],
                        })}
                        className="bg-gradient-to-r from-blue-500 to-pink-500 hover:from-blue-600 hover:to-pink-600 text-white border-0 font-semibold normal-case tracking-normal rounded-lg px-6">
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
