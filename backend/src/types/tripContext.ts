/**
 * Trip context from frontend planning flow
 */
export interface TripContext {
  // Destinations
  cities: CityDestination[];
  startDate: string; // ISO date string
  totalDays?: number;
  
  // Budget
  budget: Budget;
  budgetMode: 'capped' | 'flexible';
  
  // Preferences
  people: number;
  travelType: TravelType;
}

export interface CityDestination {
  id: string;
  name: string;
  days: number;
  order: number;
}

export interface Budget {
  total: number;
  travel: number; // Either % (capped) or $ (flexible)
  accommodation: number;
  food: number;
  events: number;
}

export type TravelType = 
  | 'leisure'
  | 'business'
  | 'adventure'
  | 'cultural'
  | 'family'
  | 'solo';

/**
 * Mapping of travel types to activity preferences
 */
export const TRAVEL_TYPE_PREFERENCES: Record<TravelType, {
  categories: string[];
  pacing: 'relaxed' | 'moderate' | 'fast';
  activityLevel: 'low' | 'medium' | 'high';
  description: string;
}> = {
  leisure: {
    categories: ['beaches', 'parks', 'museums', 'restaurants', 'shopping', 'natural'],
    pacing: 'relaxed',
    activityLevel: 'low',
    description: 'Focus on relaxation, sightseeing, and enjoyment'
  },
  business: {
    categories: ['restaurants', 'cultural', 'museums', 'cafes', 'hotels'],
    pacing: 'fast',
    activityLevel: 'low',
    description: 'Efficient schedule with quality dining and minimal leisure'
  },
  adventure: {
    categories: ['natural', 'sport', 'climbing', 'interesting_places', 'amusement_parks'],
    pacing: 'fast',
    activityLevel: 'high',
    description: 'Active experiences, outdoor activities, and exploration'
  },
  cultural: {
    categories: ['museums', 'historic', 'architecture', 'theatres_and_entertainments', 'cultural'],
    pacing: 'moderate',
    activityLevel: 'medium',
    description: 'Deep cultural immersion, history, and local experiences'
  },
  family: {
    categories: ['amusement_parks', 'parks', 'museums', 'restaurants', 'interesting_places', 'natural'],
    pacing: 'moderate',
    activityLevel: 'medium',
    description: 'Kid-friendly activities with balanced pacing'
  },
  solo: {
    categories: ['museums', 'cafes', 'parks', 'interesting_places', 'cultural', 'restaurants'],
    pacing: 'moderate',
    activityLevel: 'medium',
    description: 'Flexible schedule for independent exploration'
  }
};

/**
 * Budget allocation per day based on budget mode
 */
export function calculateDailyBudget(budget: Budget, budgetMode: 'capped' | 'flexible', days: number): {
  totalPerDay: number;
  accommodation: number;
  food: number;
  activities: number;
  transport: number;
} {
  // Guard against missing sub-fields (e.g. a caller that only sends `total`)
  // producing NaN through the arithmetic below.
  const totalBudget = budget.total ?? 0;
  const accommodation = budget.accommodation ?? 0;
  const food = budget.food ?? 0;
  const events = budget.events ?? 0;
  const travel = budget.travel ?? 0;
  const safeDays = days > 0 ? days : 1;

  if (budgetMode === 'capped') {
    // Budget is in percentages
    return {
      totalPerDay: totalBudget / safeDays,
      accommodation: (totalBudget * (accommodation / 100)) / safeDays,
      food: (totalBudget * (food / 100)) / safeDays,
      activities: (totalBudget * (events / 100)) / safeDays,
      transport: (totalBudget * (travel / 100)) / safeDays,
    };
  } else {
    // Budget is in dollar amounts
    return {
      totalPerDay: totalBudget / safeDays,
      accommodation: accommodation / safeDays,
      food: food / safeDays,
      activities: events / safeDays,
      transport: travel / safeDays,
    };
  }
}