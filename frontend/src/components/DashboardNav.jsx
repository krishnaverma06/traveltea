import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { clearToken, getToken, apiGetSearchSuggestions } from "@/lib/api";

/**
 * The signed-in top bar: brand, global search, section tabs, logout, avatar.
 *
 * Previously declared inside TripPlannerPage.jsx and therefore rendered on
 * /plan only — every other page had to invent its own header. Extracted so the
 * Flights and Hotels pages carry the same navigation.
 */
const DashboardNav = ({ updateTripData = () => {} }) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchBoxRef = React.useRef(null);
  const { user, isAuthenticated } = useAuth();

  const handleLogout = () => {
    clearToken();
    window.location.href = "/";
  };

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    const token = getToken();
    if (!token) return;

    const controller = new AbortController();
    setIsSearching(true);

    const timer = setTimeout(() => {
      apiGetSearchSuggestions(query, token, controller.signal)
        .then((res) => setSuggestions(res.suggestions || []))
        .catch((err) => {
          if (err.name !== "AbortError") setSuggestions([]);
        })
        .finally(() => setIsSearching(false));
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSuggestionClick = (suggestion) => {
    setShowDropdown(false);
    setSearchQuery("");
    if (suggestion.type === "trip") {
      navigate("/saved-trips");
    } else {
      updateTripData?.({ cities: [{ name: suggestion.title, days: 1 }] });
      navigate("/plan");
    }
  };

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-pink-500 shadow-lg">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-lg font-bold text-gray-900">TravelTea</span>
              <span className="text-[10px] text-gray-500 -mt-1">
                Plan Smarter
              </span>
            </div>
          </div>

          <div className="flex-1 max-w-2xl mx-8">
            <div className="relative" ref={searchBoxRef}>
              <Input
                type="text"
                placeholder="Search destinations, trips, experiences..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                className="w-full h-11 pl-12 pr-4 text-base bg-gray-50 border-gray-200 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 rounded-full"
              />
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg
                  className="h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>

              {showDropdown && searchQuery.trim() && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden z-50">
                  {isSearching ? (
                    <div className="p-4 text-sm text-gray-500 text-center">
                      Searching...
                    </div>
                  ) : suggestions.length === 0 ? (
                    <div className="p-4 text-sm text-gray-500 text-center">
                      No matches found
                    </div>
                  ) : (
                    <ul>
                      {suggestions.map((s) => (
                        <li key={`${s.type}-${s.id}`}>
                          <button
                            onClick={() => handleSuggestionClick(s)}
                            className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between gap-3 border-b border-gray-100 last:border-b-0"
                          >
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {s.title}
                              </p>
                              {s.subtitle && (
                                <p className="text-xs text-gray-500">{s.subtitle}</p>
                              )}
                            </div>
                            <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded-full bg-blue-50 text-blue-600 flex-shrink-0">
                              {s.type === "trip" ? "Trip" : "Destination"}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="text-gray-600 hover:text-white hover:bg-gradient-to-r hover:from-blue-500/90 hover:to-pink-500/90 hover:backdrop-blur-sm px-4 py-2 transition-all duration-300"
            >
              <Link to="/explore">Explore</Link>
            </Button>
            <Button
              variant="ghost"
              className="text-gray-600 hover:text-white hover:bg-gradient-to-r hover:from-pink-500/90 hover:to-blue-500/90 hover:backdrop-blur-sm px-4 py-2 transition-all duration-300"
            >
              <Link to="/trips">Trips</Link>
            </Button>
            <Button
              variant="ghost"
              className="text-gray-600 hover:text-white hover:bg-gradient-to-r hover:from-pink-500/90 hover:to-blue-500/90 hover:backdrop-blur-sm px-4 py-2 transition-all duration-300"
            >
              <Link to="/saved-trips">Saved Trips</Link>
            </Button>
            <Button
              variant="ghost"
              className="text-gray-600 hover:text-white hover:bg-gradient-to-r hover:from-blue-500/90 hover:to-pink-500/90 hover:backdrop-blur-sm px-4 py-2 transition-all duration-300"
            >
              <Link to="/flights">Flights</Link>
            </Button>
            <Button
              variant="ghost"
              className="text-gray-600 hover:text-white hover:bg-gradient-to-r hover:from-pink-500/90 hover:to-blue-500/90 hover:backdrop-blur-sm px-4 py-2 transition-all duration-300"
            >
              <Link to="/hotels">Hotels</Link>
            </Button>
             {/* Navigation Links */}
            {/* <div className="hidden md:flex items-center gap-6"> */}
            {/* <Link
              to="/plan"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Plan
            </Link> */}

            {/* </div> */}

            {isAuthenticated && (
              <div className="ml-4 flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleLogout}
                  className="px-4 text-black"
                >
                  Logout
                </Button>
                <Link to="/profile" className="ml-2 w-10 h-10 rounded-full overflow-hidden border-2 border-gray-200 hover:border-blue-500 transition-all flex items-center justify-center bg-gray-50 flex-shrink-0" title="Go to Profile">
                  <img 
                    src={user?.avatar ? `https://api.dicebear.com/7.x/adventurer/svg?seed=${user.avatar}` : `https://api.dicebear.com/7.x/adventurer/svg?seed=${user?.name || 'Felix'}`} 
                    alt="Profile" 
                    className="w-full h-full object-cover" 
                  />
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default DashboardNav;
