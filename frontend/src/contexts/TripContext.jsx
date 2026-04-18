import React, { createContext, useContext, useState, useEffect } from 'react';

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
        return JSON.parse(saved);
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
        return { ...prev, ...newData, generatedItinerary: null, itineraryMarkdown: null };
      }
      
      return { ...prev, ...newData };
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