import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTrip } from "@/contexts/TripContext";
import {
  apiGetExploreDestinations,
  apiGetExploreTrending,
  apiGetExploreRecommendations,
  getToken,
} from "@/lib/api";
import { toast } from "react-toastify";
import {
  ArrowLeft,
  Search,
  MapPin,
  Star,
  Loader2,
  Flame,
  Sparkles,
  Compass,
} from "lucide-react";

const CATEGORIES = [
  { label: "All", value: "" },
  { label: "Historic", value: "historic" },
  { label: "Nature", value: "natural" },
  { label: "Museums", value: "museums" },
  { label: "Religion", value: "religion" },
  { label: "Architecture", value: "architecture" },
];

const DestinationCard = ({ destination, onStartTrip }) => {
  const [imageFailed, setImageFailed] = useState(false);

  return (
  <Card className="group overflow-hidden bg-white border border-gray-200 shadow-lg hover:shadow-2xl transition-all duration-500 transform hover:-translate-y-2">
    <div className="h-40 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 relative overflow-hidden">
      {destination.image && !imageFailed ? (
        <img
          src={destination.image}
          alt={destination.name}
          className="w-full h-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <MapPin className="w-10 h-10 text-white/80" />
        </div>
      )}
    </div>
    <div className="p-4">
      <h3 className="text-lg font-bold text-gray-900 mb-1 truncate">
        {destination.name}
      </h3>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {destination.rating > 0 && (
          <span className="flex items-center gap-1 text-xs text-amber-600 font-semibold">
            <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
            {destination.rating}
          </span>
        )}
        {destination.category?.slice(0, 2).map((c) => (
          <span
            key={c}
            className="px-2 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded-full capitalize"
          >
            {c.replace(/_/g, " ")}
          </span>
        ))}
      </div>
      <Button
        onClick={() => onStartTrip(destination)}
        className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white"
        size="sm"
      >
        Start a trip here
      </Button>
    </div>
  </Card>
  );
};

const ExplorePage = () => {
  const navigate = useNavigate();
  const { updateTripData } = useTrip();

  const [trending, setTrending] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [isLoadingTrending, setIsLoadingTrending] = useState(true);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(true);
  const [isLoadingDestinations, setIsLoadingDestinations] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    apiGetExploreTrending()
      .then((res) => setTrending(res.trending || []))
      .catch(() => setTrending([]))
      .finally(() => setIsLoadingTrending(false));

    const token = getToken();
    if (token) {
      apiGetExploreRecommendations(token)
        .then((res) => setRecommendations(res.recommendations || []))
        .catch(() => setRecommendations([]))
        .finally(() => setIsLoadingRecommendations(false));
    } else {
      setIsLoadingRecommendations(false);
    }
  }, []);

  useEffect(() => {
    setIsLoadingDestinations(true);
    apiGetExploreDestinations({ q: searchTerm, category })
      .then((res) => setDestinations(res.destinations || []))
      .catch((err) => {
        toast.error(err.message || "Failed to load destinations");
        setDestinations([]);
      })
      .finally(() => setIsLoadingDestinations(false));
  }, [searchTerm, category]);

  const handleStartTrip = (destination) => {
    updateTripData({ cities: [{ name: destination.name, days: 1 }] });
    navigate("/plan");
    toast.success(`Let's plan a trip to ${destination.name}!`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30">
      <div className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 sticky top-0 z-50 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4">
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
              Explore Destinations
            </h1>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-12">
        {/* Trending */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Flame className="w-5 h-5 text-orange-500" />
            <h2 className="text-xl font-bold text-gray-900">Trending Now</h2>
          </div>
          {isLoadingTrending ? (
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          ) : trending.length === 0 ? (
            <p className="text-sm text-gray-500">
              No trending destinations yet — be the first to save a trip!
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {trending.map((d) => (
                <DestinationCard key={d.id} destination={d} onStartTrip={handleStartTrip} />
              ))}
            </div>
          )}
        </section>

        {/* Recommendations */}
        {getToken() && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-purple-500" />
              <h2 className="text-xl font-bold text-gray-900">Recommended for You</h2>
            </div>
            {isLoadingRecommendations ? (
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            ) : recommendations.length === 0 ? (
              <p className="text-sm text-gray-500">
                Save a trip to get personalized recommendations based on your travel style.
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {recommendations.map((d) => (
                  <DestinationCard key={d.id} destination={d} onStartTrip={handleStartTrip} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Main grid */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Compass className="w-5 h-5 text-blue-500" />
            <h2 className="text-xl font-bold text-gray-900">Explore Destinations</h2>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search a city..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white/50 backdrop-blur-sm"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCategory(c.value)}
                  className={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-300 ${
                    category === c.value
                      ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg"
                      : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {isLoadingDestinations ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          ) : destinations.length === 0 ? (
            <Card className="p-12 text-center bg-white/80 backdrop-blur-sm border border-white/20 shadow-2xl rounded-3xl">
              <p className="text-gray-600">
                No destinations found. Try a different search or category.
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {destinations.map((d) => (
                <DestinationCard key={d.id} destination={d} onStartTrip={handleStartTrip} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ExplorePage;
