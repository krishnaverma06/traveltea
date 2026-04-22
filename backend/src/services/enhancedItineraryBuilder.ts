import { v4 as uuidv4 } from 'uuid';
import { geminiWebSearch, type Attraction } from './geminiWebSearch.js';
import { googlePlacesAPI, type PlaceDetails } from './googlePlacesAPI.js';
import type { Itinerary, DayPlan, TimeSlot, Activity } from '../types/itinerary.js';

/**
 * Enhanced Itinerary Builder
 * Uses Gemini web search (via SerpAPI + Gemini structured output) + Google Places API
 */

export class EnhancedItineraryBuilder {

    /**
     * Build complete itinerary using Gemini web search + Google Places API
     */
    async buildItineraryWithWebSearch(
        city: string,
        days: number,
        context: {
            travelType: string;
            preferences: string[];
            dailyBudget: number;
            activityLevel: 'low' | 'medium' | 'high';
            pacing: 'relaxed' | 'moderate' | 'fast';
            numberOfPeople: number;
        }
    ): Promise<Itinerary | null> {
        console.log(`🎯 [ENHANCED] Building ${days}-day itinerary for ${city}`);
        console.log(`   Travel type: ${context.travelType}, Pacing: ${context.pacing}`);

        try {
            // STEP 1: Use Gemini web search service to find top attractions.
            // Scaled to trip length instead of a flat 30 — a fully-detailed
            // 30-attraction structured response doesn't reliably fit even an
            // 8192-token completion (was truncating mid-JSON and silently
            // discarding the whole response). ~5-6 candidates/day, filtered
            // down afterward, is still plenty of headroom for a short trip.
            const attractionsToRequest = Math.min(30, Math.max(12, days * 6));
            const webSearchResults = await geminiWebSearch.findTopAttractions(
                city,
                context.travelType,
                context.preferences,
                attractionsToRequest
            );

            if (!webSearchResults || !webSearchResults.attractions || webSearchResults.attractions.length === 0) {
                console.warn('⚠️ No attractions generated from Gemini, proceeding with empty attractions to allow fallback.');
            }

            const rawAttractions = webSearchResults?.attractions || [];

            // STEP 2: Filter by alignment and popularity
            const filteredAttractions = geminiWebSearch.filterByAlignment(
                rawAttractions,
                context.travelType,
                context.preferences
            );

            console.log(`✅ [GEMINI SEARCH] ${rawAttractions.length} total, ${filteredAttractions.length} after filtering`);

            // [OPTIMIZATION] Pre-filter exact count required before expensive API enrichment
            const activitiesPerDay = this.calculateActivitiesPerDay(context.pacing, context.activityLevel);
            const requiredAttractions = days * (activitiesPerDay.morning + activitiesPerDay.afternoon);
            const requiredRestaurants = days * activitiesPerDay.evening;

            const attractionsOnly = filteredAttractions.filter(a => a.category !== 'restaurant' && a.category !== 'cafe');
            const restaurantsOnly = filteredAttractions.filter(a => a.category === 'restaurant' || a.category === 'cafe');

            const selectedPlaces = [
                ...attractionsOnly.slice(0, requiredAttractions),
                ...restaurantsOnly.slice(0, requiredRestaurants)
            ];

            // STEP 3: Enrich ONLY the selectively chosen top attractions with Google Places API
            const enrichedPlaces = await this.enrichWithGooglePlaces(
                selectedPlaces,
                city
            );

            console.log(`📍 [GOOGLE PLACES] Enriched ${enrichedPlaces.length} places with photos, hours, prices`);

            // STEP 4: Calculate distances between consecutive places
            const placesWithDistances = await this.calculateDistances(enrichedPlaces);

            // STEP 5: Build daily plans
            const dayPlans = await this.buildDailyPlans(
                days,
                placesWithDistances,
                context,
                webSearchResults.localTips
            );

            // STEP 6: Construct complete itinerary
            const itinerary: Itinerary = {
                id: uuidv4(),
                tripMetadata: {
                    destination: city,
                    duration: days,
                    travelType: context.travelType,
                    preferences: context.preferences,
                    localTips: webSearchResults.localTips,
                    bestSeason: webSearchResults.bestSeason
                },
                days: dayPlans,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            console.log(`🎉 [ENHANCED] Itinerary complete with ${dayPlans.length} days`);
            return itinerary;

        } catch (error) {
            console.error('❌ [ENHANCED] Error building itinerary:', error);
            return null;
        }
    }

    /**
     * Enrich attractions from Gemini web search with Google Places API data
     */
    private async enrichWithGooglePlaces(
        attractions: Attraction[],
        city: string
    ): Promise<EnrichedPlace[]> {
        const enrichedPlaces: EnrichedPlace[] = [];
        const batchSize = 3; // Capped at 3 to respect Google Places burst limits

        for (let i = 0; i < attractions.length; i += batchSize) {
            const batch = attractions.slice(i, i + batchSize);
            
            const batchResults = await Promise.all(batch.map(async (attraction) => {
                try {
                    const searchQuery = `${attraction.name} ${city}`;
                    console.log(`🔍 Searching Google Places: "${searchQuery}"`);

                    const places = await googlePlacesAPI.searchPlaces(searchQuery);

                    if (places.length === 0) {
                        console.log(`⚠️  No Google Places result for: ${attraction.name}`);
                        const fallbackImg = await geminiWebSearch.findImageForAttraction(`${attraction.name} ${city}`);
                        return {
                            webSearchData: attraction,
                            googlePlaceData: null,
                            photoUrl: fallbackImg || null,
                            openingHours: null,
                            ticketPrice: 'Check website',
                            distance: null
                        };
                    }

                    const place = places[0]; 

                    let photoUrl: string | null = null;
                    if (place.photos && place.photos.length > 0) {
                        const photoName = place.photos[0].name;
                        photoUrl = googlePlacesAPI.getPhotoUrl(photoName, 1200, 800);
                        console.log(`📸 Photo URL generated: ${photoUrl}`);
                    } else {
                        console.log(`⚠️  No photos from Places for ${attraction.name}, attempting SerpApi image fallback...`);
                        const fallbackImg = await geminiWebSearch.findImageForAttraction(`${attraction.name} ${city}`);
                        if (fallbackImg) {
                            photoUrl = fallbackImg;
                            console.log(`📸 Fallback photo URL found: ${photoUrl}`);
                        } else {
                            console.log(`⚠️  No photos available at all for ${attraction.name}`);
                        }
                    }

                    const openingHours = place.openingHours
                        ? {
                            isOpen: place.openingHours.openNow,
                            schedule: place.openingHours.weekdayDescriptions
                        }
                        : null;

                    const ticketPrice = googlePlacesAPI.estimateTicketPrice(place);

                    console.log(`✅ Enriched: ${attraction.name}`);
                    return {
                        webSearchData: attraction,
                        googlePlaceData: place,
                        photoUrl,
                        openingHours,
                        ticketPrice,
                        distance: null
                    };

                } catch (error) {
                    console.error(`❌ Error enriching ${attraction.name}:`, error);
                    return {
                        webSearchData: attraction,
                        googlePlaceData: null,
                        photoUrl: null,
                        openingHours: null,
                        ticketPrice: 'Check website',
                        distance: null
                    };
                }
            }));
            
            enrichedPlaces.push(...batchResults);
        }

        return enrichedPlaces;
    }

    /**
     * Calculate walking distances between consecutive places
     */
    private async calculateDistances(places: EnrichedPlace[]): Promise<EnrichedPlace[]> {
        for (let i = 0; i < places.length - 1; i++) {
            const current = places[i];
            const next = places[i + 1];

            if (!current.googlePlaceData || !next.googlePlaceData) continue;

            try {
                const distanceInfo = await googlePlacesAPI.calculateDistance(
                    {
                        lat: current.googlePlaceData.location.latitude,
                        lng: current.googlePlaceData.location.longitude
                    },
                    {
                        lat: next.googlePlaceData.location.latitude,
                        lng: next.googlePlaceData.location.longitude
                    }
                );

                if (distanceInfo) {
                    current.distance = distanceInfo;
                }
            } catch (error) {
                console.error('Distance calculation error:', error);
            }
        }

        return places;
    }

    /**
     * Build daily plans from enriched places
     */
    private async buildDailyPlans(
        days: number,
        places: EnrichedPlace[],
        context: { pacing: string; activityLevel: string },
        localTips: string[]
    ): Promise<DayPlan[]> {
        const activitiesPerDay = this.calculateActivitiesPerDay(context.pacing, context.activityLevel);
        const dayPlans: DayPlan[] = [];

        // Separate attractions and restaurants
        const attractions = places.filter(p =>
            p.webSearchData.category !== 'restaurant' && p.webSearchData.category !== 'cafe'
        );
        const restaurants = places.filter(p =>
            p.webSearchData.category === 'restaurant' || p.webSearchData.category === 'cafe'
        );

        let placeIndex = 0;
        let restaurantIndex = 0;

        for (let dayNum = 1; dayNum <= days; dayNum++) {
            const timeSlots: TimeSlot[] = [];

            // Morning activities
            const morningActivities = this.selectPlacesForSlot(
                attractions,
                placeIndex,
                activitiesPerDay.morning
            );
            placeIndex += morningActivities.length;

            if (morningActivities.length > 0) {
                timeSlots.push({
                    period: 'morning',
                    startTime: '09:00',
                    endTime: '12:00',
                    activities: morningActivities.map(p => this.convertToActivity(p))
                });
            }

            // Afternoon activities
            const afternoonActivities = this.selectPlacesForSlot(
                attractions,
                placeIndex,
                activitiesPerDay.afternoon
            );
            placeIndex += afternoonActivities.length;

            if (afternoonActivities.length > 0) {
                timeSlots.push({
                    period: 'afternoon',
                    startTime: '14:00',
                    endTime: '18:00',
                    activities: afternoonActivities.map(p => this.convertToActivity(p))
                });
            }

            // Evening dining
            const eveningDining = this.selectPlacesForSlot(
                restaurants,
                restaurantIndex,
                activitiesPerDay.evening
            );
            restaurantIndex += eveningDining.length;

            if (eveningDining.length > 0) {
                timeSlots.push({
                    period: 'evening',
                    startTime: '19:00',
                    endTime: '22:00',
                    activities: eveningDining.map(p => this.convertToActivity(p))
                });
            }

            dayPlans.push({
                dayNumber: dayNum,
                title: this.generateDayTitle(dayNum),
                timeSlots,
                localTip: localTips[dayNum - 1] || undefined
            });
        }

        return dayPlans;
    }

    /**
     * Select places for a time slot
     */
    private selectPlacesForSlot(
        places: EnrichedPlace[],
        startIndex: number,
        count: number
    ): EnrichedPlace[] {
        return places.slice(startIndex, startIndex + count);
    }

    /**
     * Convert enriched place to Activity format
     */
    private convertToActivity(place: EnrichedPlace): Activity {
        const imageUrl = place.photoUrl || place.webSearchData.imageUrl || undefined;

        console.log(`🖼️  Activity "${place.webSearchData.name}" image: ${imageUrl ? 'HAS PHOTO' : 'NO PHOTO'}`);

        return {
            id: uuidv4(),
            name: place.webSearchData.name,
            description: place.webSearchData.description,
            location: place.googlePlaceData ? {
                latitude: place.googlePlaceData.location.latitude,
                longitude: place.googlePlaceData.location.longitude,
                address: place.googlePlaceData.formattedAddress
            } : undefined,
            duration: place.webSearchData.estimatedDuration,
            estimatedCost: place.ticketPrice,
            category: place.webSearchData.category,
            rating: place.googlePlaceData?.rating,
            imageUrl: imageUrl,
            openingHours: place.openingHours?.schedule,
            isOpen: place.openingHours?.isOpen,
            websiteUrl: place.googlePlaceData?.websiteUri,
            phoneNumber: place.googlePlaceData?.internationalPhoneNumber,
            distanceToNext: place.distance ? `${place.distance.distance} (${place.distance.duration} walk)` : undefined,
            tags: place.webSearchData.tags,
            mustVisit: place.webSearchData.mustVisit,
            bestTimeToVisit: place.webSearchData.bestTimeToVisit
        };
    }

    /**
     * Calculate activities per day based on pacing
     */
    private calculateActivitiesPerDay(pacing: string, activityLevel: string) {
        const pacingMap: Record<string, { morning: number; afternoon: number; evening: number }> = {
            relaxed: { morning: 1, afternoon: 1, evening: 1 },
            moderate: { morning: 2, afternoon: 2, evening: 1 },
            fast: { morning: 2, afternoon: 3, evening: 1 }
        };

        const levelMultiplier: Record<string, number> = {
            low: 0.7,
            medium: 1.0,
            high: 1.3
        };

        const base = pacingMap[pacing] || pacingMap.moderate;
        const multiplier = levelMultiplier[activityLevel] || 1.0;

        return {
            morning: Math.max(1, Math.round(base.morning * multiplier)),
            afternoon: Math.max(1, Math.round(base.afternoon * multiplier)),
            evening: base.evening
        };
    }

    /**
     * Generate day title
     */
    private generateDayTitle(dayNum: number): string {
        const titles = [
            'Arrival & First Impressions',
            'City Discovery',
            'Cultural Journey',
            'Local Adventures',
            'Hidden Treasures',
            'Art & Heritage',
            'Nature & Relaxation'
        ];
        return titles[Math.min(dayNum - 1, titles.length - 1)];
    }
}

/**
 * Enriched place combining web search + Google Places data
 */
interface EnrichedPlace {
    webSearchData: Attraction;
    googlePlaceData: PlaceDetails | null;
    photoUrl: string | null;
    openingHours: {
        isOpen: boolean;
        schedule: string[];
    } | null;
    ticketPrice: string;
    distance: {
        distance: string;
        duration: string;
    } | null;
}

// Export singleton instance
export const enhancedItineraryBuilder = new EnhancedItineraryBuilder();