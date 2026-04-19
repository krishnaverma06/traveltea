import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { MapPin, Navigation, Clock, Sun, Sunset, Moon } from 'lucide-react';
import { travelDataService } from '../../services/TravelDataService';
import { RestaurantCard } from './TimelineSections';

export const TimelineDay = ({ day, weather, tripData, index }) => {
  const [restaurants, setRestaurants] = useState([]);
  const [loadingRestaurants, setLoadingRestaurants] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const dayRef = useRef(null);

  const getPeriodIcon = (period) => {
    const icons = {
      morning: <Sun className="w-5 h-5 text-amber-500" />,
      afternoon: <Sun className="w-5 h-5 text-orange-500" />,
      evening: <Sunset className="w-5 h-5 text-purple-500" />,
      night: <Moon className="w-5 h-5 text-indigo-500" />,
    };
    return icons[period?.toLowerCase()] || <Clock className="w-5 h-5 text-gray-500" />;
  };

  useEffect(() => {
    // If restaurants exist in the timeline data, use them directly
    if (tripData?.timeline?.restaurants?.default?.length > 0) {
      setRestaurants(tripData.timeline.restaurants.default);
      setHasLoaded(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasLoaded) {
          fetchRestaurants();
        }
      },
      { threshold: 0.1 }
    );

    if (dayRef.current) {
      observer.observe(dayRef.current);
    }

    return () => {
      if (dayRef.current) observer.unobserve(dayRef.current);
    };
  }, [hasLoaded, tripData]);

  const fetchRestaurants = async () => {
    try {
      setHasLoaded(true); // Prevent multiple triggers
      setLoadingRestaurants(true);
      
      const city = tripData.cities?.[0];
      if (!city || !city.coordinates) return;

      const results = await travelDataService.getRestaurants(city.coordinates.lat, city.coordinates.lng);
      setRestaurants(results);
      
      // Persist lazily loaded restaurants if it's a saved trip
      if (tripData._id) {
        await travelDataService.saveRestaurants(tripData._id, results);
      }
    } catch (error) {
      console.error('Failed to load restaurants for day', day.dayNumber, error);
    } finally {
      setLoadingRestaurants(false);
    }
  };

  return (
    <div id={`day-${day.dayNumber}`} ref={dayRef} className="mb-12 relative">
      {/* Timeline Line */}
      <div className="absolute left-6 top-10 bottom-[-3rem] w-0.5 bg-gray-200 z-0"></div>

      <div className="relative z-10 pl-16">
        {/* Day Header with Weather */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 relative">
          <div className="absolute -left-16 w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold shadow-lg border-4 border-white">
            {day.dayNumber}
          </div>
          <div>
            <h3 className="text-2xl font-bold text-gray-900">Day {day.dayNumber}</h3>
            <p className="text-gray-500">{day.title}</p>
          </div>
          
          {weather && (
            <div className="mt-2 sm:mt-0 flex items-center gap-3 bg-white/60 backdrop-blur-sm px-4 py-2 rounded-2xl border border-gray-100 shadow-sm">
              <img src={`https://openweathermap.org/img/wn/${weather.icon}.png`} alt={weather.condition} className="w-10 h-10 -ml-2" />
              <div>
                <div className="font-bold text-gray-900">{weather.temperature.day}°C</div>
                <div className="text-xs text-gray-500">{weather.condition} • {weather.chanceOfRain}% rain</div>
              </div>
            </div>
          )}
          {weather === null && (
            <div className="mt-2 sm:mt-0 px-4 py-2 bg-gray-50 rounded-xl text-sm text-gray-500 border border-gray-200">
              Forecast unavailable
            </div>
          )}
        </div>

        {/* Activities */}
        <div className="space-y-6">
          {day.timeSlots?.map((slot, sIdx) => (
            <div key={sIdx} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-all">
              <div className="flex items-center gap-2 mb-4">
                {getPeriodIcon(slot.period)}
                <h4 className="font-semibold text-gray-900 capitalize text-lg">{slot.period}</h4>
              </div>
              
              <div className="space-y-4">
                {slot.activities?.map((activity, aIdx) => (
                  <div key={aIdx} className="flex gap-4 border-b border-gray-50 pb-4 last:border-0 last:pb-0">
                    <div className="flex-1">
                      <div className="flex items-start justify-between">
                        <h5 className="font-medium text-gray-900">{activity.name}</h5>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{activity.description}</p>
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {activity.duration}</span>
                        {activity.cost && <span className="px-2 py-0.5 bg-gray-100 rounded-full">{activity.cost}</span>}
                      </div>
                    </div>
                    {/* Maps Link */}
                    <a 
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.name)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="w-10 h-10 rounded-full bg-blue-50 hover:bg-blue-100 flex items-center justify-center text-blue-600 transition-colors shrink-0"
                    >
                      <Navigation className="w-4 h-4" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Restaurants Lazy Loaded Section */}
        <div className="mt-6 bg-orange-50/50 rounded-2xl border border-orange-100/50 p-5">
          <h4 className="font-semibold text-orange-900 mb-4 flex items-center gap-2">
            <span className="text-xl">🍽️</span> Nearby Dining Suggestions
          </h4>
          
          {loadingRestaurants ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <RestaurantSkeleton />
              <RestaurantSkeleton />
            </div>
          ) : restaurants.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {restaurants.map(r => (
                <RestaurantCard key={r.id} restaurant={r} />
              ))}
            </div>
          ) : hasLoaded ? (
            <p className="text-sm text-orange-700/70 italic">No restaurants found nearby.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
};
