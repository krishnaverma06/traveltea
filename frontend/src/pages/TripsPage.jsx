import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isAfter, startOfDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTrip } from "@/contexts/TripContext";
import { apiGetSavedTrips, apiDeleteSavedTrip, getToken } from "@/lib/api";
import TripCard from "@/components/TripCard";
import { toast } from "react-toastify";
import {
  Sparkles,
  MapPin,
  CalendarIcon,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Heart,
} from "lucide-react";

const TripsPage = () => {
  const navigate = useNavigate();
  const { updateTripData } = useTrip();

  const [savedTrips, setSavedTrips] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [activeTab, setActiveTab] = useState("upcoming");

  useEffect(() => {
    fetchSavedTrips();
  }, []);

  const fetchSavedTrips = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const token = getToken();
      if (!token) {
        setError("Please log in to view your trips");
        return;
      }

      const response = await apiGetSavedTrips(token, { limit: 1000 });
      setSavedTrips(response.savedTrips || []);
    } catch (err) {
      console.error("Error fetching trips:", err);
      const errorMessage = err.message || "Failed to fetch trips";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTrip = async (tripId) => {
    if (!window.confirm("Are you sure you want to delete this trip?")) return;

    try {
      setDeletingId(tripId);
      const token = getToken();
      await apiDeleteSavedTrip(tripId, token);
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
      navigate("/itinerary");
      toast.success("Trip loaded successfully");
    } catch (error) {
      console.error("Error loading trip:", error);
      toast.error("Failed to load trip");
    }
  };

  const today = startOfDay(new Date());
  const upcomingTrips = savedTrips
    .filter((t) => t.startDate && isAfter(new Date(t.startDate), today))
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  const upcomingCount = upcomingTrips.length;
  const citiesVisited = new Set(
    savedTrips.flatMap((t) => t.cities?.map((c) => c.name) || [])
  ).size;
  const daysTraveled = savedTrips.reduce(
    (sum, t) =>
      sum + (t.totalDays || t.cities?.reduce((s, c) => s + c.days, 0) || 0),
    0
  );

  const tripsToShow = activeTab === "upcoming" ? upcomingTrips : savedTrips;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30 flex items-center justify-center">
        <Card className="p-12 bg-white/80 backdrop-blur-sm border border-white/20 shadow-2xl rounded-3xl">
          <div className="flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            <h3 className="text-xl font-semibold text-gray-900">
              Loading Your Trips...
            </h3>
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
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                My Trips
              </h1>
            </div>

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

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="p-6 bg-white border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Upcoming Trips</p>
                <p className="text-3xl font-bold text-gray-900">{upcomingCount}</p>
              </div>
              <div className="p-3 rounded-xl bg-blue-100">
                <CalendarIcon className="w-5 h-5 text-blue-600" />
              </div>
            </div>
          </Card>
          <Card className="p-6 bg-white border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Cities Visited</p>
                <p className="text-3xl font-bold text-gray-900">{citiesVisited}</p>
              </div>
              <div className="p-3 rounded-xl bg-pink-100">
                <MapPin className="w-5 h-5 text-pink-600" />
              </div>
            </div>
          </Card>
          <Card className="p-6 bg-white border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 font-medium">Days Traveled</p>
                <p className="text-3xl font-bold text-gray-900">{daysTraveled}</p>
              </div>
              <div className="p-3 rounded-xl bg-purple-100">
                <Sparkles className="w-5 h-5 text-purple-600" />
              </div>
            </div>
          </Card>
        </div>

        <div className="flex gap-2 mb-8">
          <button
            onClick={() => setActiveTab("upcoming")}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300 ${
              activeTab === "upcoming"
                ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            Upcoming ({upcomingCount})
          </button>
          <button
            onClick={() => setActiveTab("saved")}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300 ${
              activeTab === "saved"
                ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            All Saved ({savedTrips.length})
          </button>
        </div>

        {tripsToShow.length === 0 ? (
          <Card className="p-12 text-center bg-white/80 backdrop-blur-sm border border-white/20 shadow-2xl rounded-3xl">
            <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Heart className="w-10 h-10 text-white" />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-4">
              {activeTab === "upcoming" ? "No upcoming trips" : "No saved trips yet"}
            </h3>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              Start planning your next adventure!
            </p>
            <Button
              onClick={() => navigate("/plan")}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
            >
              Plan a Trip
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {tripsToShow.map((trip) => (
              <TripCard
                key={trip._id}
                trip={trip}
                badge={activeTab === "upcoming" ? "Upcoming" : "Saved Trip"}
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

export default TripsPage;
