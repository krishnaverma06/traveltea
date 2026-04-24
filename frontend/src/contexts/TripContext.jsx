import React, { createContext, useContext, useState, useEffect } from 'react';


/**
 * totalDays is a pure function of the per-city day counts, but it was also
 * stored — so the two could drift apart. Observed live: cities [Pune 3, Goa 3]
 * with a stored totalDays of 3, which made the sidebar show "Duration: 3 days"
 * and an End Date three days too early while the itinerary itself correctly
 * showed 6. Deriving it on every read makes that drift unrepresentable and
 * self-heals state already persisted in localStorage.
 */
const withDerivedTotalDays = (data) => {
  if (!data || !Array.isArray(data.cities) || data.cities.length === 0) return data;
  const derived = data.cities.reduce((sum, c) => sum + (Number(c?.days) || 0), 0);
  return derived === data.totalDays ? data : { ...data, totalDays: derived };
};

const TripContext = createContext();

export const useTrip = () => {
  const context = useContext(TripContext);
  if (!context) {
    throw new Error('useTrip must be used within a TripProvider');
  }
  return context;
};

export const TripProvider = ({ children }) => {
  const [tripData, setTripData] = useState(() => {
    try {
      const saved = localStorage.getItem('tripData');
      if (saved) {
        return withDerivedTotalDays(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to parse tripData from localStorage', e);
    }
    
    return {
      cities: [],
      startDate: null,
      totalDays: null,
      budget: null,
      budgetMode: 'capped',
      people: null,
      travelType: null,
      selectedTrip: null,
    };
  });

  useEffect(() => {
    localStorage.setItem('tripData', JSON.stringify(tripData));
  }, [tripData]);

  useEffect(() => {
    const handleTripMutated = (event) => {
      const { tripData: updatedTrip } = event.detail;
      if (updatedTrip) {
        // If the updated trip matches the current trip, update it
        setTripData(prev => {
          // In some cases we might only have generatedItinerary or similar in state
          // For now, if an update comes in, we assume it's for the currently active trip
          return withDerivedTotalDays({
            ...prev,
            ...updatedTrip,
            generatedItinerary: updatedTrip.generatedItinerary || prev.generatedItinerary,
            timeline: updatedTrip.timeline || prev.timeline
          });
        });
      }
    };

    window.addEventListener('trip_mutated', handleTripMutated);
    return () => window.removeEventListener('trip_mutated', handleTripMutated);
  }, []);

  const updateTripData = (newData) => {
    setTripData(prev => {
      // If the user is modifying trip parameters (cities, dates, budget, etc.)
      // we must invalidate the previously generated itinerary so a new one can be generated.
      const isModifyingParameters = 
        ('cities' in newData) || 
        ('startDate' in newData) || 
        ('budget' in newData) || 
        ('people' in newData) || 
        ('travelType' in newData);
        
      if (isModifyingParameters && !('generatedItinerary' in newData)) {
        return withDerivedTotalDays({
          ...prev,
          ...newData,
          generatedItinerary: null,
          itineraryMarkdown: null,
        });
      }

      return withDerivedTotalDays({ ...prev, ...newData });
    });
  };

  const resetTripData = () => {
    setTripData({
      cities: [],
      startDate: null,
      totalDays: 0,
      budget: {
        total: 5000,
        travel: 40,
        accommodation: 30,
        food: 20,
        events: 10,
      },
      people: 1,
      travelType: '',
      selectedTrip: null,
    });
  };

  return (
    <TripContext.Provider value={{
      tripData,
      updateTripData,
      resetTripData,
    }}>
      {children}
    </TripContext.Provider>
  );
};