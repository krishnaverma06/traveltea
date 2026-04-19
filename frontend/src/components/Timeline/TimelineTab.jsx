import React, { useEffect, useState } from 'react';
import { travelDataService } from '../../services/TravelDataService';
import { TimelineDay } from './TimelineDay';
import { FlightCard, HotelCard, EventCard } from './TimelineSections';
import { FlightSkeleton, HotelSkeleton, EventSkeleton, DaySkeleton } from './SkeletonLoaders';
import { Plane, Hotel, CalendarDays, Ticket } from 'lucide-react';

export const TimelineTab = ({ tripData, savedTripId }) => {
  const [data, setData] = useState({
    weather: tripData?.timeline?.weather || null,
    events: tripData?.timeline?.events || [],
    hotels: [],
    flights: []
  });
  
  const hasInitialData = !!tripData?.timeline?.weather || !!(tripData?.timeline?.events && tripData.timeline.events.length > 0);
  const [loading, setLoading] = useState(!hasInitialData);
  const [activeDay, setActiveDay] = useState(1);

  const itinerary = tripData?.generatedItinerary?.itinerary || tripData?.generatedItinerary || null;
  const days = itinerary?.days || [];

  useEffect(() => {
    if (savedTripId || tripData?.cities) {
      loadTimelineData();
    }
  }, [savedTripId, tripData]);

  const loadTimelineData = async () => {
    // Only show loading if we don't already have persisted data
    if (!hasInitialData) setLoading(true);
    
    try {
      const response = await travelDataService.getTimelineData(savedTripId, tripData);
      if (response) {
        setData(prev => ({
          ...prev,
          weather: response.weather || prev.weather,
          events: response.events?.length ? response.events : prev.events,
          hotels: response.hotels || [],
          flights: response.flights || []
        }));
      }
    } catch (error) {
      console.error('Failed to load timeline data:', error);
    } finally {
      setLoading(false);
    }
  };

  const scrollToDay = (dayNumber) => {
    const el = document.getElementById(`day-${dayNumber}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveDay(dayNumber);
    }
  };

  // Scroll spy logic
  useEffect(() => {
    const handleScroll = () => {
      let currentDay = activeDay;
      for (const day of days) {
        const el = document.getElementById(`day-${day.dayNumber}`);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 150 && rect.bottom >= 150) {
            currentDay = day.dayNumber;
            break;
          }
        }
      }
      if (currentDay !== activeDay) {
        setActiveDay(currentDay);
      }
    };

    const scrollContainer = document.querySelector('.timeline-scroll-container');
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }
  }, [days, activeDay]);

  return (
    <div className="flex h-full timeline-scroll-container overflow-y-auto bg-gray-50/50">
      {/* Sticky Left Sidebar (Desktop Only) */}
      <div className="hidden lg:block w-72 shrink-0 border-r border-gray-200/50 bg-white/50 backdrop-blur-md p-6 sticky top-0 h-full overflow-y-auto">
        <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-blue-500" /> Trip Timeline
        </h3>
        
        <div className="space-y-2 relative">
          <div className="absolute left-2.5 top-2 bottom-2 w-0.5 bg-gray-100 -z-10" />
          {days.map((day) => (
            <button
              key={day.dayNumber}
              onClick={() => scrollToDay(day.dayNumber)}
              className={`w-full text-left p-3 rounded-xl transition-all duration-300 flex items-center gap-3 group ${
                activeDay === day.dayNumber
                  ? 'bg-blue-50/80 text-blue-700 shadow-sm border border-blue-100'
                  : 'hover:bg-gray-100/50 text-gray-600'
              }`}
            >
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                activeDay === day.dayNumber ? 'bg-blue-500 text-white shadow-md' : 'bg-white border-2 border-gray-200 text-gray-400 group-hover:border-blue-300'
              }`}>
                {day.dayNumber}
              </div>
              <div className="flex-1 truncate">
                <div className="font-semibold text-sm">Day {day.dayNumber}</div>
                <div className="text-xs truncate opacity-80">{day.title}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main Timeline Content */}
      <div className="flex-1 max-w-4xl mx-auto p-4 sm:p-8">
        
        {/* Flights Section */}
        {loading ? (
          <FlightSkeleton />
        ) : data.flights.length > 0 && (
          <div className="mb-10">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Plane className="w-5 h-5 text-blue-500" /> Outbound Flights
            </h3>
            {data.flights.slice(0, 2).map((flight) => (
              <FlightCard key={flight.id} flight={flight} />
            ))}
          </div>
        )}

        {/* Hotels Section */}
        {loading ? (
          <HotelSkeleton />
        ) : data.hotels.length > 0 && (
          <div className="mb-12">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Hotel className="w-5 h-5 text-purple-500" /> Recommended Stays
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {data.hotels.slice(0, 2).map((hotel) => (
                <HotelCard key={hotel.id} hotel={hotel} />
              ))}
            </div>
          </div>
        )}

        {/* Days Itinerary */}
        <div className="mb-12">
          {days.length === 0 && loading && (
            <>
              <DaySkeleton />
              <DaySkeleton />
            </>
          )}
          {days.map((day, idx) => {
            // Find weather for this day's date
            const tripStartDate = tripData.startDate ? new Date(tripData.startDate) : new Date();
            tripStartDate.setDate(tripStartDate.getDate() + day.dayNumber - 1);
            const dateStr = tripStartDate.toISOString().split('T')[0];
            const weatherForDay = data.weather ? data.weather[dateStr] : null;

            return (
              <TimelineDay 
                key={day.dayNumber} 
                day={day} 
                index={idx}
                weather={weatherForDay}
                tripData={tripData}
              />
            );
          })}
        </div>

        {/* Events Section (Local events during trip) */}
        {loading ? (
          <EventSkeleton />
        ) : data.events.length > 0 && (
          <div className="mt-16 mb-8 p-6 bg-gradient-to-br from-pink-50 to-rose-50 rounded-3xl border border-pink-100/50">
            <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <Ticket className="w-6 h-6 text-pink-500" /> Local Events & Shows
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data.events.slice(0, 4).map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
