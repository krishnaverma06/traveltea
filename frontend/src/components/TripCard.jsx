import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sparkles, MapPin, Calendar, ArrowRight, Loader2, Trash2, Eye } from "lucide-react";

const getTotalActivities = (trip) => {
  if (!trip.generatedItinerary?.days) return 0;
  return trip.generatedItinerary.days.reduce(
    (sum, day) =>
      sum + day.timeSlots.reduce((s, slot) => s + slot.activities.length, 0),
    0
  );
};

const getTotalDays = (trip) => {
  return trip.cities?.reduce((sum, city) => sum + city.days, 0) || 0;
};

const getCityNames = (trip) => {
  return trip.cities?.map((c) => c.name).join(" → ") || "";
};

const formatDate = (dateString) => {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const getTripBannerImage = (trip) => {
  for (const day of trip.generatedItinerary?.days || []) {
    for (const slot of day.timeSlots || []) {
      for (const activity of slot.activities || []) {
        if (activity.imageUrl) return activity.imageUrl;
      }
    }
  }
  return null;
};

const TripCard = ({ trip, badge, onView, onDelete, isDeleting }) => {
  const bannerImage = getTripBannerImage(trip);
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <Card className="group relative overflow-hidden bg-white border border-gray-200 shadow-lg hover:shadow-2xl transition-all duration-500 cursor-pointer transform hover:-translate-y-2 hover:scale-[1.02]">
      <div className="h-48 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 relative">
        {bannerImage && !imageFailed && (
          <img
            src={bannerImage}
            alt={trip.title}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        )}
        <div className="absolute inset-0 bg-black/20" />
        <div className="absolute bottom-4 left-6 right-6">
          <div className="flex items-center gap-2 mb-2">
            {badge && (
              <span className="px-3 py-1 text-xs font-bold rounded-full bg-white/90 text-blue-600">
                {badge}
              </span>
            )}
            <span className="px-3 py-1 text-xs font-bold rounded-full bg-white/90 text-purple-600 capitalize">
              {trip.travelType} Travel
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">{trip.title}</h2>
          <p className="text-white/90 text-sm">{formatDate(trip.startDate)}</p>
        </div>

        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(trip._id);
            }}
            disabled={isDeleting}
            title="Remove this trip"
            aria-label="Remove this trip"
            className="absolute top-3 right-3 p-2 bg-red-500/90 hover:bg-red-600 text-white rounded-full transition-all duration-300 shadow-lg"
          >
            {isDeleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      <div className="p-6">
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <Calendar className="w-5 h-5 text-blue-600 mx-auto mb-1" />
            <div className="text-lg font-bold text-blue-900">{getTotalDays(trip)}</div>
            <div className="text-xs text-blue-700">Days</div>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <Sparkles className="w-5 h-5 text-green-600 mx-auto mb-1" />
            <div className="text-lg font-bold text-green-900">
              {getTotalActivities(trip)}
            </div>
            <div className="text-xs text-green-700">Activities</div>
          </div>
        </div>

        {trip.description && (
          <p className="text-sm text-gray-600 mb-4 line-clamp-2">{trip.description}</p>
        )}

        <div className="mb-4">
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <MapPin className="w-4 h-4 text-pink-600" />
            <span className="font-medium">Destinations</span>
          </div>
          <div className="text-sm text-gray-800 font-medium">{getCityNames(trip)}</div>
        </div>

        {trip.tags && trip.tags.length > 0 && (
          <div className="mb-4">
            <div className="flex flex-wrap gap-1">
              {trip.tags.slice(0, 3).map((tag, index) => (
                <span
                  key={index}
                  className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-full"
                >
                  {tag}
                </span>
              ))}
              {trip.tags.length > 3 && (
                <span className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-full">
                  +{trip.tags.length - 3}
                </span>
              )}
            </div>
          </div>
        )}

        <Button
          onClick={() => onView(trip)}
          className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white"
        >
          <Eye className="w-4 h-4 mr-2" />
          View Itinerary
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </Card>
  );
};

export default TripCard;
export { getTotalActivities, getTotalDays, getCityNames, formatDate };
