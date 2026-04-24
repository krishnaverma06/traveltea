import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTrip } from "@/contexts/TripContext";
import { apiGetSavedTrips, apiDeleteSavedTrip, apiSearchSavedTrips, getToken } from "@/lib/api";
import { toast } from "react-toastify";
import TripCard from "@/components/TripCard";
import {
  Sparkles,
  Calendar,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Search,
  Heart,
  X,
} from "lucide-react";

const SavedTripsPage = () => {
  const navigate = useNavigate();
  const { updateTripData } = useTrip();

  const [savedTrips, setSavedTrips] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredTrips, setFilteredTrips] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    fetchSavedTrips();
  }, []);

  // Search.
  //
  // `cancelled` is the fix for the bug where clearing the search box left the
  // page showing "0 saved trips": clearTimeout only stops a request that
  // hasn't been sent yet. A request already in flight still resolved
  // afterwards and overwrote the full list with its own (often empty) results.
  // Every exit path from this effect now marks itself cancelled, so a late
  // response from a superseded query can no longer write to state.
  useEffect(() => {
    let cancelled = false;

    if (!searchTerm.trim()) {
      setFilteredTrips(savedTrips);
      setIsSearching(false);
      return () => {
        cancelled = true;
      };
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      const term = searchTerm.trim();
      try {
        const token = getToken();
        if (!token) return;

        const response = await apiSearchSavedTrips(term, token);
        if (cancelled) return;
        // An empty result set is a real answer ("nothing matched"), so it must
        // be applied — but only when the response actually carries the array.
        setFilteredTrips(Array.isArray(response?.savedTrips) ? response.savedTrips : []);
      } catch (err) {
        if (cancelled) return;
        console.error("Trip search failed, falling back to local filtering", err);
        const lower = term.toLowerCase();
        setFilteredTrips(
          savedTrips.filter(
            (trip) =>
              (trip.title || "").toLowerCase().includes(lower) ||
              (trip.description || "").toLowerCase().includes(lower) ||
              (trip.cities || []).some((c) => (c?.name || "").toLowerCase().includes(lower)) ||
              (trip.tags || []).some(
                (tag) => typeof tag === "string" && tag.toLowerCase().includes(lower),
              ),
          ),
        );
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchTerm, savedTrips]);

  const fetchSavedTrips = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const token = getToken();
      if (!token) {
        setError("Please log in to view saved trips");
        return;
      }

      const response = await apiGetSavedTrips(token);
      console.log(
        "📊 SavedTripsPage - Fetched saved trips:",
        response.savedTrips
      );
      console.log(
        "📊 SavedTripsPage - First trip itinerary data:",
        response.savedTrips?.[0]?.generatedItinerary
      );
      setSavedTrips(response.savedTrips || []);
    } catch (err) {
      console.error("Error fetching saved trips:", err);
      const errorMessage = err.message || "Failed to fetch saved trips";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTrip = async (tripId) => {
    if (!window.confirm("Are you sure you want to delete this trip?")) {
      return;
    }

    try {
      setDeletingId(tripId);
      const token = getToken();
      await apiDeleteSavedTrip(tripId, token);

      // Remove from local state
      setSavedTrips((prev) => prev.filter((trip) => trip._id !== tripId));
      toast.success("Trip deleted successfully");
    } catch (err) {
      console.error("Error deleting trip:", err);
      toast.error("Failed to delete trip");
    } finally {
      setDeletingId(null);
    }
  };

  const handleViewTrip = async (savedTrip) => {
    try {
      console.log(
        "📊 SavedTripsPage - Loading trip with full itinerary:",
        savedTrip
      );
      console.log(
        "📊 SavedTripsPage - Generated itinerary:",
        savedTrip.generatedItinerary
      );
      console.log(
        "📊 SavedTripsPage - Days in itinerary:",
        savedTrip.generatedItinerary?.days?.length
      );

      // Update trip context with saved trip data
      updateTripData({
        startDate: new Date(savedTrip.startDate),
        cities: savedTrip.cities,
        people: savedTrip.people,
        travelType: savedTrip.travelType,
        budget: savedTrip.budget,
        budgetMode: savedTrip.budgetMode,
        generatedItinerary: savedTrip.generatedItinerary,
        itineraryMarkdown: savedTrip.generatedItinerary?.markdown,
      });

      // Navigate to itinerary page
      navigate("/itinerary");
      toast.success("Trip loaded successfully");
    } catch (error) {
      console.error("Error loading trip:", error);
      toast.error("Failed to load trip");
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30 flex items-center justify-center">
        <Card className="p-12 bg-white/80 backdrop-blur-sm border border-white/20 shadow-2xl rounded-3xl">
          <div className="flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            <div className="text-center">
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Loading Your Saved Trips...
              </h3>
              <p className="text-gray-600">Fetching your travel memories</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30 flex items-center justify-center">
        <Card className="p-8 bg-red-50 border border-red-200 max-w-md">
          <div className="flex items-start gap-4">
            <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-1" />
            <div>
              <h3 className="text-lg font-semibold text-red-900 mb-2">
                Error Loading Trips
              </h3>
              <p className="text-red-700 mb-4">{error}</p>
              <Button
                onClick={fetchSavedTrips}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Try Again
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 sticky top-0 z-50 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/plan")}
                className="text-gray-600 hover:text-gray-900 hover:bg-white/50 backdrop-blur-sm transition-all duration-300 group"
              >
                <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform duration-300" />
                Back to Planning
              </Button>
              <div className="h-6 w-px bg-gradient-to-b from-transparent via-gray-300 to-transparent" />
              <div className="space-y-1">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                  My Saved Trips
                </h1>
                <p className="text-sm text-gray-600">
                  {savedTrips.length}{" "}
                  {savedTrips.length === 1 ? "trip" : "trips"} saved
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => navigate("/upcoming-trips")}
                className="border-gray-200 text-gray-700 hover:bg-white/50 backdrop-blur-sm transition-all duration-300"
              >
                <Calendar className="w-4 h-4 mr-2" />
                Upcoming Trips
              </Button>
              <Button
                onClick={() => navigate("/plan")}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Plan New Trip
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Search and Filter */}
        <div className="mb-8">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by name, place, or vibe..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-10 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white/50 backdrop-blur-sm"
            />
            {isSearching ? (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 animate-spin" />
            ) : (
              searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )
            )}
          </div>
          {searchTerm && !isSearching && (
            <p className="mt-2 text-sm text-gray-500">
              {filteredTrips.length === 0
                ? "No matches."
                : `${filteredTrips.length} match${filteredTrips.length === 1 ? "" : "es"}`}{" "}
              for "{searchTerm}"
            </p>
          )}
        </div>

        {/* Trips Grid */}
        {filteredTrips.length === 0 ? (
          <Card className="p-12 text-center bg-white/80 backdrop-blur-sm border border-white/20 shadow-2xl rounded-3xl">
            <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Heart className="w-10 h-10 text-white" />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-4">
              {searchTerm ? "No trips found" : "No saved trips yet"}
            </h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              {searchTerm
                ? "Try adjusting your search terms"
                : "Start planning your first trip and save it for future reference!"}
            </p>
            {!searchTerm && (
              <Button
                onClick={() => navigate("/plan")}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
              >
                Plan Your First Trip
              </Button>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredTrips.map((trip) => (
              <TripCard
                key={trip._id}
                trip={trip}
                badge="Saved Trip"
                onView={handleViewTrip}
                onDelete={handleDeleteTrip}
                isDeleting={deletingId === trip._id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SavedTripsPage;