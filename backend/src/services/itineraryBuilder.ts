/**
 * Itinerary Builder Service
 * Constructs structured multi-day itineraries from OpenTripMap data
 */

import { v4 as uuidv4 } from 'uuid';
import type { Itinerary, DayPlan, TimeSlot, Activity, TripMetadata } from '../types/itinerary.js';
import type { Destination } from '../mcp-servers/places/types.js';
import { getOpenTripMapAPI } from '../mcp-servers/places/api.js';
import { geocodePlace } from './geocoding.js';

const MAX_IMAGE_ENRICHMENTS_PER_ITINERARY = 12;

export class ItineraryBuilder {
  /** Below this, a destination is treated as under-covered and the radius widens. */
  private static readonly MIN_PLACES_FOR_ITINERARY = 8;

  private openTripMapAPI = getOpenTripMapAPI();

  /**
   * Replace fake generated image URLs with real place photos where
   * available (capped, since each lookup is a separate API call). Activities
   * with no real photo are left with an empty imageUrl for the frontend to
   * show a placeholder instead of a fake/generic stock photo.
   */
  private async enrichItineraryImages(itinerary: Itinerary): Promise<Itinerary> {
    const activities = itinerary.days
      .flatMap((day) => day.timeSlots.flatMap((slot) => slot.activities))
      .filter((activity) => activity.xid)
      .slice(0, MAX_IMAGE_ENRICHMENTS_PER_ITINERARY);

    await Promise.all(
      activities.map(async (activity) => {
        const details = await this.openTripMapAPI.getEnrichedPlaceDetails(activity.xid as string);
        activity.imageUrl = details?.image || '';
      }),
    );

    return itinerary;
  }

  /**
   * Build a complete itinerary for a destination
   */
  async buildItinerary(
    destination: string,
    duration: number,
    preferences?: string[]
  ): Promise<Itinerary | null> {
    try {
      console.log(`🗓️ [ITINERARY] Building ${duration}-day itinerary for ${destination}`);

      // 1. Get coordinates for destination
      const coords = await this.getDestinationCoordsPrivate(destination);
      if (!coords) {
        console.error('Failed to geocode destination');
        return null;
      }

      console.log(`📍 [ITINERARY] Coordinates: ${coords.lat}, ${coords.lon}`);

      // 2. Fetch diverse places, widening the radius for destinations whose
      //    attractions don't sit near their own centroid.
      const places = await this.fetchPlacesWithExpandingRadius(coords.lat, coords.lon, 10000);

      console.log(`✅ [ITINERARY] Found ${places.attractions.length} attractions, ${places.restaurants.length} restaurants`);

      // 3. Build daily plans. The pool is shuffled ONCE here and consumed by
      //    cursor, so no place is scheduled on two different days — see
      //    buildDayPlan for what this replaced.
      const days: DayPlan[] = [];
      const pool = this.buildPlacePool(places);
      for (let dayNum = 1; dayNum <= duration; dayNum++) {
        days.push(this.buildDayPlan(dayNum, places, preferences, pool));
      }

      // 4. Construct itinerary
      const itinerary: Itinerary = {
        id: uuidv4(),
        tripMetadata: {
          destination,
          duration,
          preferences,
        },
        days,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      console.log(`🎉 [ITINERARY] Successfully built ${duration}-day itinerary with ${days.length} days`);
      return await this.enrichItineraryImages(itinerary);
    } catch (error) {
      console.error('Itinerary builder error:', error);
      return null;
    }
  }

  /**
   * Build itinerary with trip context (budget, preferences, travel type)
   */
  async buildItineraryWithContext(
    destination: string,
    duration: number,
    context: {
      dailyBudget: number;
      preferredCategories: string[];
      activityLevel: 'low' | 'medium' | 'high';
      pacing: 'relaxed' | 'moderate' | 'fast';
      numberOfPeople: number;
    }
  ): Promise<Itinerary | null> {
    try {
      console.log(`🎯 [CONTEXT ITINERARY] Building ${duration}-day itinerary for ${destination} with context`);
      console.log(`   Budget: $${context.dailyBudget}/day, Activity Level: ${context.activityLevel}, Pacing: ${context.pacing}`);

      // 1. Get coordinates
      const coords = await this.getDestinationCoordsPrivate(destination);
      if (!coords) {
        console.error('Failed to geocode destination');
        return null;
      }

      // 2. Fetch places filtered by preferred categories
      const places = await this.fetchCategoryFilteredPlaces(
        coords.lat,
        coords.lon,
        context.preferredCategories
      );

      console.log(`✅ [CONTEXT ITINERARY] Found ${places.total} places matching preferences`);

      // 3. Determine activities per day based on pacing and activity level
      const activitiesPerDay = this.calculateActivitiesPerDay(context.pacing, context.activityLevel);

      // 4. Build daily plans with budget awareness. The used-place sets are
      // created once, here, and shared by every day — see
      // buildBudgetAwareDayPlan's parameters for why that matters.
      const days: DayPlan[] = [];
      const usedActivities = new Set<string>();
      const usedRestaurants = new Set<string>();
      for (let dayNum = 1; dayNum <= duration; dayNum++) {
        const dayPlan = this.buildBudgetAwareDayPlan(
          dayNum,
          places,
          context.dailyBudget,
          activitiesPerDay,
          context.numberOfPeople,
          usedActivities,
          usedRestaurants
        );
        days.push(dayPlan);
      }

      // 5. Construct itinerary
      const itinerary: Itinerary = {
        id: uuidv4(),
        tripMetadata: {
          destination,
          duration,
          preferences: context.preferredCategories,
        },
        days,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      console.log(`🎉 [CONTEXT ITINERARY] Successfully built itinerary`);
      return await this.enrichItineraryImages(itinerary);
    } catch (error) {
      console.error('Context itinerary builder error:', error);
      return null;
    }
  }

  /**
   * Build itinerary with trip context and global state tracking (new optimized method)
   */
  async buildItineraryWithContextAndState(
    destination: string,
    duration: number,
    context: {
      dailyBudget: number;
      preferredCategories: string[];
      activityLevel: 'low' | 'medium' | 'high';
      pacing: 'relaxed' | 'moderate' | 'fast';
      numberOfPeople: number;
      places?: any;
      coords?: { lat: number; lon: number };
      globalUsedPlaces: Set<string>;
      startingDayNumber: number;
    }
  ): Promise<Itinerary | null> {
    try {
      console.log(`🎯 [OPTIMIZED ITINERARY] Building ${duration}-day itinerary for ${destination}`);

      let places = context.places;

      // If places not provided, fetch them
      if (!places) {
        const coords = context.coords || await this.getDestinationCoords(destination);
        if (!coords) {
          console.error('Failed to geocode destination');
          return null;
        }

        places = await this.fetchEnhancedPlaces(
          coords.lat,
          coords.lon,
          context.preferredCategories,
          'leisure', // Default to leisure if not specified
          true // Include hotels
        );
      }

      console.log(`✅ [OPTIMIZED ITINERARY] Using ${places.total} places for ${destination}`);

      // Determine activities per day based on pacing and activity level
      const activitiesPerDay = this.calculateActivitiesPerDay(context.pacing, context.activityLevel);

      // Build daily plans with global state tracking
      const days: DayPlan[] = [];
      for (let dayNum = 1; dayNum <= duration; dayNum++) {
        const actualDayNumber = context.startingDayNumber + dayNum - 1;
        const dayPlan = this.buildOptimizedDayPlan(
          actualDayNumber,
          places,
          context.dailyBudget,
          activitiesPerDay,
          context.numberOfPeople,
          context.globalUsedPlaces
        );
        days.push(dayPlan);
      }

      // Construct itinerary
      const itinerary: Itinerary = {
        id: uuidv4(),
        tripMetadata: {
          destination,
          duration,
          preferences: context.preferredCategories,
        },
        days,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      console.log(`🎉 [OPTIMIZED ITINERARY] Successfully built itinerary for ${destination}`);
      return await this.enrichItineraryImages(itinerary);
    } catch (error) {
      console.error('Optimized itinerary builder error:', error);
      return null;
    }
  }

  /**
   * Build optimized day plan with global state tracking and hotel integration
   */
  private buildOptimizedDayPlan(
    dayNumber: number,
    places: any, // Can be old format or new enhanced format
    dailyBudget: number,
    activitiesPerDay: { morning: number; afternoon: number; evening: number },
    numberOfPeople: number,
    globalUsedPlaces: Set<string>
  ): DayPlan {
    let budgetRemaining = dailyBudget * numberOfPeople;

    // Handle both old and new place formats
    let activities: Destination[] = [];
    let restaurants: Destination[] = [];
    let hotels: Destination[] = [];

    if (places.activities && places.restaurants) {
      // New enhanced format
      activities = places.activities || [];
      restaurants = places.restaurants || [];
      hotels = places.hotels || [];
    } else if (places.all) {
      // Old format - separate activities and restaurants
      restaurants = places.all.filter((p: Destination) =>
        p.category.some(c => c.toLowerCase().includes('restaurant') ||
          c.toLowerCase().includes('food') ||
          c.toLowerCase().includes('cafe'))
      );
      activities = places.all.filter((p: Destination) =>
        !p.category.some(c => c.toLowerCase().includes('restaurant') ||
          c.toLowerCase().includes('food') ||
          c.toLowerCase().includes('cafe'))
      );
    }

    // Shuffle arrays for variety but maintain consistency with day number seed
    const shuffledActivities = this.shuffleArrayWithSeed([...activities], dayNumber);
    const shuffledRestaurants = this.shuffleArrayWithSeed([...restaurants], dayNumber * 2);
    const shuffledHotels = this.shuffleArrayWithSeed([...hotels], dayNumber * 3);

    // Helper to select unique places with budget consideration
    const selectPlaces = (
      count: number,
      sourceArray: Destination[],
      placeType: 'activity' | 'restaurant' | 'hotel' = 'activity'
    ): Destination[] => {
      const selected: Destination[] = [];
      let attempts = 0;
      const maxAttempts = sourceArray.length * 2;

      for (let i = 0; i < sourceArray.length && selected.length < count && attempts < maxAttempts; i++) {
        attempts++;
        const place = sourceArray[i];
        const placeId = ItineraryBuilder.placeKey(place);

        // Check if place is already used globally
        if (!globalUsedPlaces.has(placeId)) {
          const estimatedCost = this.parseCost(this.estimateCost(place.category)) * numberOfPeople;

          if (budgetRemaining >= estimatedCost || estimatedCost === 0) {
            selected.push(place);
            globalUsedPlaces.add(placeId); // Add to global tracking
            budgetRemaining -= estimatedCost;
          }
        }
      }

      // If we couldn't find enough unique places, add affordable repeats as fallback
      if (selected.length < Math.max(1, Math.floor(count / 2))) {
        for (let i = 0; i < sourceArray.length && selected.length < count; i++) {
          const place = sourceArray[i];
          const estimatedCost = this.parseCost(this.estimateCost(place.category)) * numberOfPeople;

          if (budgetRemaining >= estimatedCost || estimatedCost === 0) {
            const placeId = ItineraryBuilder.placeKey(place);
            if (!selected.some((p) => ItineraryBuilder.placeKey(p) === placeId)) {
              selected.push(place);
              budgetRemaining -= estimatedCost;
            }
          }
        }
      }

      return selected;
    };

    // Generate meaningful day titles with trip progression
    const dayTitles = [
      'Arrival & First Impressions', 'City Discovery', 'Cultural Journey', 'Local Adventures',
      'Hidden Treasures', 'Art & Heritage', 'Nature & Relaxation', 'Foodie Exploration',
      'Scenic Wonders', 'Local Life', 'Urban Exploration', 'Farewell Adventures'
    ];

    const title = dayTitles[Math.min(dayNumber - 1, dayTitles.length - 1)];

    // Add hotel recommendation for the first day or if it's a longer trip
    const timeSlots = [
      this.buildTimeSlot(
        'morning',
        '09:00',
        '12:00',
        selectPlaces(activitiesPerDay.morning, shuffledActivities, 'activity')
      ),
      this.buildTimeSlot(
        'afternoon',
        '14:00',
        '18:00',
        selectPlaces(activitiesPerDay.afternoon, shuffledActivities, 'activity')
      ),
      this.buildTimeSlot(
        'evening',
        '19:00',
        '22:00',
        selectPlaces(activitiesPerDay.evening, shuffledRestaurants, 'restaurant')
      ),
    ];

    // Add hotel recommendation for multi-day stays (first day or every few days)
    if (dayNumber === 1 || dayNumber % 3 === 1) {
      const hotelRecommendations = selectPlaces(1, shuffledHotels, 'hotel');
      if (hotelRecommendations.length > 0) {
        timeSlots.push(this.buildTimeSlot(
          'night',
          '22:00',
          '23:59',
          hotelRecommendations
        ));
      }
    }

    return {
      dayNumber,
      title,
      timeSlots,
    };
  }

  /**
   * Shuffle array with seed for consistent randomization
   */
  private shuffleArrayWithSeed<T>(array: T[], seed: number): T[] {
    const shuffled = [...array];
    let currentIndex = shuffled.length;
    let temporaryValue, randomIndex;

    // Simple LCG (Linear Congruential Generator)
    const rng = (seed: number) => {
      const a = 1664525;
      const c = 1013904223;
      const m = Math.pow(2, 32);
      return ((a * seed + c) % m) / m;
    };

    while (0 !== currentIndex) {
      randomIndex = Math.floor(rng(seed + currentIndex) * currentIndex);
      currentIndex -= 1;

      temporaryValue = shuffled[currentIndex];
      shuffled[currentIndex] = shuffled[randomIndex];
      shuffled[randomIndex] = temporaryValue;
    }

    return shuffled;
  }

  /**
   * Expose getDestinationCoords as public method
   */
  /**
   * Resolve a destination name to coordinates.
   *
   * Uses the real geocoder (services/geocoding.ts — Nominatim first, then
   * OpenTripMap), NOT a POI search. This used to take the coordinates of the
   * first *point of interest* matching the name, which silently failed for any
   * destination that has no named POI sitting on its own centroid: "Maldives"
   * and "Iceland" both geocode fine (3.720,73.224 and 64.984,-18.106) but
   * return zero POIs, so the itinerary build aborted with "Failed to geocode
   * destination" — after the user had already paid for flights and a hotel.
   *
   * The POI search is kept as a fallback for the opposite case: a landmark or
   * neighbourhood the gazetteer doesn't hold but OpenTripMap does.
   */
  async getDestinationCoords(destination: string): Promise<{ lat: number; lon: number } | null> {
    const geocoded = await geocodePlace(destination);
    if (geocoded) {
      return { lat: geocoded.lat, lon: geocoded.lon };
    }

    const places = await this.openTripMapAPI.searchPlaces(destination, 1);
    if (places.length > 0) {
      return {
        lat: places[0].location.latitude,
        lon: places[0].location.longitude,
      };
    }
    return null;
  }

  /**
   * Fetch places, widening the search radius until enough turn up.
   *
   * A single fixed radius assumes every destination is a city whose
   * attractions cluster around its own centroid. That breaks for anything
   * geographically spread out: "Maldives" geocodes to 3.720,73.224, which is
   * open water between atolls, so a 15km search returned nothing and the user
   * got an itinerary with zero activities — after paying for it. Iceland and
   * other country-sized destinations fail the same way.
   *
   * Widening is lazy: the first radius that yields enough wins, so the common
   * city case still costs exactly one round of requests.
   */
  private async fetchPlacesWithExpandingRadius(
    lat: number,
    lon: number,
    startRadius: number,
  ): Promise<{
    attractions: Destination[];
    restaurants: Destination[];
    nature: Destination[];
    culture: Destination[];
    radiusUsed: number;
  }> {
    const radii = [startRadius, 50_000, 150_000, 400_000].filter(
      (r, i, arr) => i === 0 || r > arr[i - 1],
    );

    let best = { attractions: [], restaurants: [], nature: [], culture: [] } as {
      attractions: Destination[];
      restaurants: Destination[];
      nature: Destination[];
      culture: Destination[];
    };
    let bestCount = -1;
    let radiusUsed = startRadius;

    for (const radius of radii) {
      const places = await this.openTripMapAPI.getItineraryPlaces(lat, lon, radius);
      const count =
        places.attractions.length + places.culture.length + places.nature.length + places.restaurants.length;

      if (count > bestCount) {
        best = places;
        bestCount = count;
        radiusUsed = radius;
      }
      if (count >= ItineraryBuilder.MIN_PLACES_FOR_ITINERARY) break;
    }

    if (radiusUsed !== startRadius) {
      console.log(`🔎 [ITINERARY] Widened search to ${radiusUsed / 1000}km — ${bestCount} places found`);
    }
    return { ...best, radiusUsed };
  }

  /**
   * Enhanced fetch with hotels and trip-type specific places
   */
  async fetchEnhancedPlaces(
    lat: number,
    lon: number,
    preferredCategories: string[],
    travelType: 'leisure' | 'business' | 'adventure' | 'cultural' | 'family' | 'solo',
    includeHotels: boolean = true
  ): Promise<{
    activities: Destination[];
    restaurants: Destination[];
    hotels: Destination[];
    byCategory: Map<string, Destination[]>;
    total: number;
  }> {
    try {
      // Get base places with enhanced categories based on travel type
      const enhancedCategories = this.getEnhancedCategoriesForTravelType(travelType, preferredCategories);

      console.log(`🎯 Enhanced categories for ${travelType}:`, enhancedCategories);

      // Fetch diverse places including hotels, widening if the destination is
      // spread out (a country or island chain rather than a city).
      const basePlaces = await this.fetchPlacesWithExpandingRadius(lat, lon, 15000);

      // Fetch hotels separately if needed
      let hotels: Destination[] = [];
      if (includeHotels) {
        hotels = await this.openTripMapAPI.searchByCategory(
          lat, lon, 'accomodations', Math.max(10000, basePlaces.radiusUsed), 10,
        );
      }

      // Combine and categorize all places
      const activities = [
        ...basePlaces.attractions,
        ...basePlaces.culture,
        ...basePlaces.nature,
      ].filter(p => p.name);

      const restaurants = basePlaces.restaurants.filter(p => p.name);

      // Filter activities by enhanced categories
      const filteredActivities = activities.filter(place => {
        const placeCategories = place.category.map(c => c.toLowerCase());
        return enhancedCategories.some(pref =>
          placeCategories.some(cat => cat.includes(pref.toLowerCase()) || pref.toLowerCase().includes(cat))
        );
      });

      // Use filtered activities if available, otherwise use all
      const finalActivities = filteredActivities.length > 0 ? filteredActivities : activities;

      // Group by category
      const byCategory = new Map<string, Destination[]>();
      [...finalActivities, ...restaurants, ...hotels].forEach(place => {
        place.category.forEach(cat => {
          if (!byCategory.has(cat)) {
            byCategory.set(cat, []);
          }
          byCategory.get(cat)!.push(place);
        });
      });

      return {
        activities: finalActivities,
        restaurants,
        hotels,
        byCategory,
        total: finalActivities.length + restaurants.length + hotels.length
      };
    } catch (error) {
      console.error('Enhanced places fetch error:', error);
      return {
        activities: [],
        restaurants: [],
        hotels: [],
        byCategory: new Map(),
        total: 0
      };
    }
  }

  /**
   * Get enhanced categories based on travel type
   */
  private getEnhancedCategoriesForTravelType(
    travelType: string,
    baseCategories: string[]
  ): string[] {
    const travelTypeCategories: Record<string, string[]> = {
      business: [
        'restaurants', 'cafes', 'hotels', 'cultural', 'museums',
        'architecture', 'historic', 'urban_environment'
      ],
      leisure: [
        'beaches', 'parks', 'museums', 'restaurants', 'shopping',
        'natural', 'amusement_parks', 'recreation'
      ],
      adventure: [
        'natural', 'sport', 'climbing', 'interesting_places',
        'amusement_parks', 'recreation', 'geology'
      ],
      cultural: [
        'museums', 'historic', 'architecture', 'theatres_and_entertainments',
        'cultural', 'religion', 'archaeology'
      ],
      family: [
        'amusement_parks', 'parks', 'museums', 'restaurants',
        'interesting_places', 'natural', 'recreation'
      ],
      solo: [
        'museums', 'cafes', 'parks', 'interesting_places',
        'cultural', 'restaurants', 'galleries'
      ]
    };

    const typeSpecific = travelTypeCategories[travelType] || [];
    return [...new Set([...baseCategories, ...typeSpecific])];
  }

  /**
   * Calculate activities per day based on pacing and activity level
   */
  private calculateActivitiesPerDay(
    pacing: 'relaxed' | 'moderate' | 'fast',
    activityLevel: 'low' | 'medium' | 'high'
  ): { morning: number; afternoon: number; evening: number } {
    const pacingMap = {
      relaxed: { morning: 1, afternoon: 1, evening: 1 },
      moderate: { morning: 2, afternoon: 2, evening: 1 },
      fast: { morning: 2, afternoon: 3, evening: 2 },
    };

    const activityMap = {
      low: 0.8,
      medium: 1.0,
      high: 1.2,
    };

    const base = pacingMap[pacing];
    const multiplier = activityMap[activityLevel];

    return {
      morning: Math.max(1, Math.round(base.morning * multiplier)),
      afternoon: Math.max(1, Math.round(base.afternoon * multiplier)),
      evening: Math.max(1, Math.round(base.evening * multiplier)),
    };
  }

  /**
   * Build a day plan with budget awareness and proper activity distribution
   */
  private buildBudgetAwareDayPlan(
    dayNumber: number,
    places: { all: Destination[]; byCategory: Map<string, Destination[]>; total: number },
    dailyBudget: number,
    activitiesPerDay: { morning: number; afternoon: number; evening: number },
    numberOfPeople: number,
    // Owned by the caller and shared across every day of the trip. They used
    // to be declared inside this function despite the comment below claiming
    // they were global, so they reset on every day and the same attraction
    // could be scheduled on day 1 and again on day 2 — which is exactly what
    // happened once the agent-driven flow started generating short
    // itineraries in places with a small pool of named attractions.
    usedActivities: Set<string> = new Set<string>(),
    usedRestaurants: Set<string> = new Set<string>()
  ): DayPlan {
    let budgetRemaining = dailyBudget * numberOfPeople;

    // Separate restaurants from other activities
    const restaurants = places.all.filter(p =>
      p.category.some(c => c.toLowerCase().includes('restaurant') || c.toLowerCase().includes('food'))
    );
    const activities = places.all.filter(p =>
      !p.category.some(c => c.toLowerCase().includes('restaurant') || c.toLowerCase().includes('food'))
    );

    // Shuffle arrays for variety
    const shuffledActivities = this.shuffleArray([...activities]);
    const shuffledRestaurants = this.shuffleArray([...restaurants]);

    // Used places are tracked globally, across every day of the trip — the
    // sets are parameters, not locals, so day 2 never re-serves day 1.

    // Helper to select unique places with budget consideration
    const selectPlaces = (
      count: number,
      sourceArray: Destination[],
      usedSet: Set<string>
    ): Destination[] => {
      const selected: Destination[] = [];
      let attempts = 0;
      const maxAttempts = sourceArray.length * 2; // Prevent infinite loops

      for (let i = 0; i < sourceArray.length && selected.length < count && attempts < maxAttempts; i++) {
        attempts++;
        const place = sourceArray[i];
        const placeId = ItineraryBuilder.placeKey(place);

        if (!usedSet.has(placeId)) {
          // Estimate cost for this activity
          const estimatedCost = this.parseCost(this.estimateCost(place.category)) * numberOfPeople;

          // Check if we can afford this activity (or if it's free)
          if (budgetRemaining >= estimatedCost || estimatedCost === 0) {
            selected.push(place);
            usedSet.add(placeId);
            budgetRemaining -= estimatedCost;
          }
        }
      }

      // Last resort: the first pass came up short. It can come up short for
      // two different reasons, and only one of them is worth relaxing.
      //
      // Relax the BUDGET — take a place we can't strictly afford and report
      // its real cost, so a tight budget produces an honest, slightly
      // over-budget day rather than an empty one.
      //
      // Never relax UNIQUENESS. This branch used to drop the usedSet check
      // instead, which is how a destination with a small pool of named
      // attractions ended up with the same wildlife sanctuary scheduled in
      // both the morning and the afternoon of the same day. A thinner day is
      // better than a schedule that tells the user to visit one place twice.
      if (selected.length < count && selected.length < Math.max(1, Math.floor(count / 2))) {
        for (let i = 0; i < sourceArray.length && selected.length < count; i++) {
          const place = sourceArray[i];
          const placeId = ItineraryBuilder.placeKey(place);
          if (usedSet.has(placeId)) continue;

          selected.push(place);
          usedSet.add(placeId);
          budgetRemaining -= this.parseCost(this.estimateCost(place.category)) * numberOfPeople;
        }
      }

      return selected;
    };

    // Generate meaningful day titles
    const dayTitles = [
      'City Discovery', 'Cultural Journey', 'Local Adventures', 'Hidden Treasures',
      'Art & Heritage', 'Nature & Relaxation', 'Foodie Exploration', 'Scenic Wonders',
      'Local Life', 'Final Adventures'
    ];

    const title = dayTitles[(dayNumber - 1) % dayTitles.length];

    return {
      dayNumber,
      title,
      timeSlots: [
        this.buildTimeSlot(
          'morning',
          '09:00',
          '12:00',
          selectPlaces(activitiesPerDay.morning, shuffledActivities, usedActivities)
        ),
        this.buildTimeSlot(
          'afternoon',
          '14:00',
          '18:00',
          selectPlaces(activitiesPerDay.afternoon, shuffledActivities, usedActivities)
        ),
        this.buildTimeSlot(
          'evening',
          '19:00',
          '22:00',
          selectPlaces(activitiesPerDay.evening, shuffledRestaurants, usedRestaurants)
        ),
      ],
    };
  }

  /**
   * Parse cost string to average number
   */
  private parseCost(costString: string): number {
    if (costString.toLowerCase().includes('free')) return 0;

    const numbers = costString.match(/\d+/g);
    if (!numbers || numbers.length === 0) return 20; // default

    if (numbers.length === 1) return parseInt(numbers[0]);

    // Average of range
    const sum = numbers.reduce((a, b) => a + parseInt(b), 0);
    return Math.round(sum / numbers.length);
  }

  /**
   * Get coordinates for a destination name (kept for backward compatibility)
   */
  private async getDestinationCoordsPrivate(destination: string): Promise<{ lat: number; lon: number } | null> {
    return this.getDestinationCoords(destination);
  }

  /**
   * Build a single day plan with morning/afternoon/evening activities
   * Ensures diverse activities across all days by proper distribution
   */
  /**
   * Build one day from shared, already-shuffled pools.
   *
   * This used to re-shuffle `places` on every call and then index into it with
   * `(baseIndex + i) % length`. Both halves of that were broken:
   *
   *  - The modulo wrapped as soon as the pool was smaller than the itinerary's
   *    demand (3 days x 4 activities = 12 slots against Rome's 10 attractions),
   *    so places repeated.
   *  - Re-shuffling per day meant `baseIndex` indexed into a DIFFERENT random
   *    order each day, so the "unique distribution across days" the old comment
   *    promised never actually held — the same place could land on day 1 and
   *    day 3 at unrelated indices.
   *
   * Now the caller shuffles once and passes cursors, so each day consumes the
   * next unused places. When the pool runs out the day is simply shorter,
   * which is honest — repeating an attraction is worse than a thinner day.
   */
  private buildDayPlan(
    dayNumber: number,
    places: {
      attractions: Destination[];
      restaurants: Destination[];
      nature: Destination[];
      culture: Destination[];
    },
    preferences?: string[],
    pool?: { activities: Destination[]; restaurants: Destination[]; activityCursor: number; restaurantCursor: number },
  ): DayPlan {
    // Standalone call (no shared pool): build a private one so this method
    // still works on its own, just without cross-day continuity.
    const shared = pool ?? this.buildPlacePool(places);

    const ACTIVITIES_PER_SLOT = 2;
    const RESTAURANTS_PER_SLOT = 2;

    /** Take the next n unused entries, or fewer if the pool is exhausted. */
    const take = (list: Destination[], cursorKey: 'activityCursor' | 'restaurantCursor', n: number) => {
      const out = list.slice(shared[cursorKey], shared[cursorKey] + n);
      shared[cursorKey] += out.length;
      return out;
    };

    const dayTitles = [
      'Explore the City', 'Cultural Immersion', 'Natural Wonders', 'Local Experiences',
      'Hidden Gems', 'Art & History', 'Adventure Day', 'Relaxation & Fun',
      'Local Flavors', 'Scenic Discoveries'
    ];

    return {
      dayNumber,
      title: dayTitles[(dayNumber - 1) % dayTitles.length],
      timeSlots: [
        this.buildTimeSlot('morning', '09:00', '12:00', take(shared.activities, 'activityCursor', ACTIVITIES_PER_SLOT)),
        this.buildTimeSlot('afternoon', '14:00', '18:00', take(shared.activities, 'activityCursor', ACTIVITIES_PER_SLOT)),
        this.buildTimeSlot('evening', '19:00', '22:00', take(shared.restaurants, 'restaurantCursor', RESTAURANTS_PER_SLOT)),
      ],
    };
  }

  /**
   * Shuffled, duplicate-free activity and restaurant pools for one itinerary.
   *
   * The two pools are deduped against EACH OTHER, not just internally: a
   * place can be returned by OpenTripMap as both an attraction and a
   * restaurant, and deduping them separately still let it be scheduled twice
   * in the same trip — once as a sight, once as a meal.
   */
  private buildPlacePool(places: {
    attractions: Destination[];
    restaurants: Destination[];
    nature: Destination[];
    culture: Destination[];
  }) {
    const activities = this.dedupePlaces([
      ...places.attractions,
      ...places.culture,
      ...places.nature,
    ]);
    const restaurants = this.dedupePlaces([...activities, ...places.restaurants]).slice(
      activities.length,
    );

    return {
      activities: this.shuffleArray(activities),
      restaurants: this.shuffleArray(restaurants),
      activityCursor: 0,
      restaurantCursor: 0,
    };
  }

  /**
   * Identity key for "is this the same place we already scheduled?".
   *
   * Normalised NAME only — deliberately not name+coordinates, which is what
   * these call sites used to do. OpenTripMap returns the same landmark under
   * several records with slightly different casing and coordinates tens of
   * metres apart, so a coordinate-sensitive key let "Bikini Beach" and
   * "Bikini beach" both land in one itinerary. Matches dedupePlaces, so the
   * two scheduling paths agree on what counts as a duplicate.
   */
  private static placeKey(place: { name?: string }): string {
    return (place?.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Collapse the same physical place appearing more than once.
   *
   * Two independent sources of duplication, both real:
   *
   *  - OpenTripMap returns overlapping category results, so a cathedral comes
   *    back under both `attractions` and `culture` and concatenating those
   *    pools duplicates it before any scheduling happens.
   *  - The same landmark can carry several xids — a Wikidata id and one or
   *    more OSM ids for the same building — with coordinates tens of metres
   *    apart. Observed: Hanoi's Hoa Phong Tower (N3226400740 / Q10825843, 28m
   *    apart) and Lisbon's Praca do Comercio (R9423812 / R9218842, 120m).
   *
   * Keyed on the normalised NAME, not on coordinates. Coordinate bucketing was
   * tried and is the wrong tool: any rounding wide enough to merge those two
   * records also merges genuinely separate neighbours, and points a metre
   * apart can still fall either side of a bucket boundary. Within a single
   * destination's 10km radius two distinct places sharing an exact name is
   * vanishingly rare, and losing one option costs far less than scheduling
   * somebody to visit the same square twice in one trip.
   */
  private dedupePlaces(places: Destination[]): Destination[] {
    const seen = new Set<string>();
    const out: Destination[] = [];

    for (const place of places) {
      const name = place?.name?.trim();
      if (!name) continue;

      const key = name.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) continue;

      seen.add(key);
      out.push(place);
    }
    return out;
  }

  /**
   * Shuffle array using Fisher-Yates algorithm
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Build a time slot with activities
   */
  private buildTimeSlot(
    period: 'morning' | 'afternoon' | 'evening' | 'night',
    startTime: string,
    endTime: string,
    places: Destination[]
  ): TimeSlot {
    const activities: Activity[] = places.map(place => this.destinationToActivity(place));

    return {
      period,
      startTime,
      endTime,
      activities,
    };
  }

  /**
   * Convert Destination to Activity with enhanced image and details
   */
  private destinationToActivity(destination: Destination): Activity {
    // Estimate duration based on category
    const duration = this.estimateDuration(destination.category);
    const cost = this.estimateCost(destination.category);

    // Generate better image URL based on category and name
    const imageUrl = this.generateImageUrl(destination);

    const activity = {
      id: uuidv4(),
      name: destination.name,
      location: {
        lat: destination.location.latitude,
        lon: destination.location.longitude,
        address: destination.address || undefined,
      },
      duration,
      estimatedCost: cost,
      category: destination.category[0] || 'attraction',
      description: destination.description || this.generateDescription(destination),
      rating: destination.rating,
      imageUrl,
      kinds: destination.category,
      xid: destination.id,
    };

    console.log('🎯 [ACTIVITY] Created activity:', activity.name, 'with imageUrl:', activity.imageUrl);

    return activity;
  }

  /**
   * Use a real photo if OpenTripMap already gave us one on the destination;
   * otherwise leave empty so the frontend shows a placeholder instead of a
   * generic/fake stock photo. Real per-place enrichment happens afterwards
   * in enrichItineraryImages (capped, since it's a separate API call).
   */
  private generateImageUrl(destination: Destination): string {
    return destination.image || '';
  }

  /**
   * Generate description for places without descriptions
   */
  private generateDescription(destination: Destination): string {
    const category = destination.category[0]?.toLowerCase() || 'attraction';
    const name = destination.name;

    const descriptions: Record<string, string> = {
      'restaurant': `Experience authentic local cuisine at ${name}, offering a delightful dining experience.`,
      'cafe': `Relax and enjoy quality coffee and light meals at ${name}, perfect for a break.`,
      'museum': `Discover fascinating exhibits and cultural treasures at ${name}.`,
      'park': `Enjoy nature and outdoor activities at ${name}, a beautiful green space.`,
      'church': `Visit the historic and architecturally significant ${name}.`,
      'monument': `Explore the historic significance and beauty of ${name}.`,
      'beach': `Relax and enjoy the sun, sand, and sea at the beautiful ${name}.`,
      'hotel': `Comfortable accommodation with excellent amenities at ${name}.`,
      'theatre': `Experience world-class entertainment and performances at ${name}.`,
      'shopping': `Discover unique items and local products at ${name}.`,
    };

    return descriptions[category] || `Visit the interesting ${name}, a notable local attraction.`;
  }

  /**
   * Estimate visit duration based on category
   */
  private estimateDuration(categories: string[]): string {
    const categoryStr = categories.join(',').toLowerCase();

    if (categoryStr.includes('museum') || categoryStr.includes('galleries')) {
      return '2-3h';
    }
    if (categoryStr.includes('restaurant') || categoryStr.includes('food')) {
      return '1-1.5h';
    }
    if (categoryStr.includes('park') || categoryStr.includes('natural')) {
      return '1-2h';
    }
    if (categoryStr.includes('monument') || categoryStr.includes('architecture')) {
      return '30min-1h';
    }

    return '1-2h'; // default
  }

  /**
   * Estimate cost based on category
   */
  private estimateCost(categories: string[]): string {
    const categoryStr = categories.join(',').toLowerCase();

    if (categoryStr.includes('museum')) {
      return '$15-25';
    }
    if (categoryStr.includes('restaurant')) {
      return '$20-40';
    }
    if (categoryStr.includes('park') || categoryStr.includes('natural')) {
      return 'Free';
    }
    if (categoryStr.includes('monument')) {
      return '$10-20';
    }

    return '$10-30'; // default
  }

  /**
   * Expose fetchCategoryFilteredPlaces as public method (backward compatibility)
   */
  async fetchCategoryFilteredPlaces(
    lat: number,
    lon: number,
    preferredCategories: string[]
  ): Promise<{
    all: Destination[];
    byCategory: Map<string, Destination[]>;
    total: number;
  }> {
    const enhanced = await this.fetchEnhancedPlaces(lat, lon, preferredCategories, 'leisure', false);
    return {
      all: [...enhanced.activities, ...enhanced.restaurants],
      byCategory: enhanced.byCategory,
      total: enhanced.activities.length + enhanced.restaurants.length
    };
  }
}

// Singleton instance
export const itineraryBuilder = new ItineraryBuilder();