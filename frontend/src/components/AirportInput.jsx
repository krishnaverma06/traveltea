import React, { useState, useEffect, useRef } from "react";
import { Plane, Loader2 } from "lucide-react";
import { getToken, apiSearchAirports } from "@/lib/api";

/**
 * Airport type-ahead for flight origin/destination.
 *
 * Flights need an IATA code — SerpAPI's google_flights ignores free-text city
 * names — so picking from a real list is what stops a search silently
 * returning nothing. The backend resolver also accepts a bare city name, but
 * choosing here means the user sees exactly which airport they're flying from.
 *
 * Debounce + AbortController follow the existing suggestion pattern in
 * TripPlannerPage.jsx.
 */
export default function AirportInput({ label, value, onChange, placeholder, icon: Icon = Plane }) {
  const [query, setQuery] = useState(value?.label || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  // Close on outside click.
  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q || q === value?.label) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        const token = getToken();
        const res = await apiSearchAirports(q, token, controller.signal);
        setResults(res.airports || []);
        setOpen(true);
      } catch (err) {
        if (err.name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, value?.label]);

  const select = (airport) => {
    const label = `${airport.city} (${airport.iata})`;
    setQuery(label);
    setOpen(false);
    setResults([]);
    onChange({ iata: airport.iata, label, airport });
  };

  return (
    <div className="space-y-2" ref={boxRef}>
      <label className="text-base font-semibold flex items-center gap-2 text-gray-800">
        <Icon className="w-4 h-4 text-blue-500" />
        {label}
      </label>

      <div className="relative">
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            // Typing invalidates a previous pick until a new one is chosen.
            if (value?.iata) onChange(null);
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="w-full p-3 bg-white border border-gray-200 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
        />
        {loading && (
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
        )}

        {open && results.length > 0 && (
          <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-64 overflow-y-auto">
            {results.map((a) => (
              <button
                key={a.iata}
                type="button"
                onClick={() => select(a)}
                className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {a.city}
                      <span className="text-gray-500 font-normal"> — {a.name}</span>
                    </p>
                    <p className="text-xs text-gray-500">{a.country}</p>
                  </div>
                  <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded flex-shrink-0">
                    {a.iata}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
