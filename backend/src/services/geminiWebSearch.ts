import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { getJson } from 'serpapi';
import { z } from 'zod';

const AttractionSchema = z.object({
    name: z.string().describe('Name of the attraction'),
    description: z.string().describe('Brief description of what makes it special'),
    category: z.string().describe('Type: museum, landmark, park, restaurant, etc.'),
    popularity: z.enum(['very_high', 'high', 'medium']).describe('Popularity level'),
    mustVisit: z.boolean().describe('Is this a must-visit attraction?'),
    estimatedDuration: z.string().describe('Typical visit duration (e.g., "2-3 hours")'),
    bestTimeToVisit: z.string().optional().describe('Best time of day or season'),
    tags: z.array(z.string()).describe('Tags like cultural, family-friendly, instagram-worthy'),
    imageUrl: z.string().optional().describe('High quality image URL if available in search context')
});

const DestinationSearchResultSchema = z.object({
    city: z.string(),
    country: z.string(),
    attractions: z.array(AttractionSchema),
    localTips: z.array(z.string()).describe('Local tips and recommendations'),
    bestSeason: z.string().optional().describe('Best time to visit this destination')
});

export type Attraction = z.infer<typeof AttractionSchema>;
export type DestinationSearchResult = z.infer<typeof DestinationSearchResultSchema>;

export class GeminiWebSearchService {
    private _structuredModel: any;

    private get structuredModel() {
        if (!this._structuredModel) {
            const baseModel = new ChatGoogleGenerativeAI({
                model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
                temperature: 0.3,
                apiKey: process.env.GEMINI_API_KEY
            });
            this._structuredModel = baseModel.withStructuredOutput(DestinationSearchResultSchema);
        }
        return this._structuredModel;
    }

    async findTopAttractions(
        city: string,
        travelType: string,
        preferences: string[],
        numberOfAttractions: number = 20
    ): Promise<DestinationSearchResult> {
        console.log(`🌐 [GEMINI + SERPAPI] Searching web for ${city}...`);

        try {
            // 1. Bump num to 30 to ensure enough data for 3+ full days
            const searchResponse = await getJson({
                engine: 'google',
                q: `must visit attractions itineraries travel guide in ${city} ${travelType} ${preferences.join(' ')}`,
                api_key: process.env.SERPAPI_API_KEY,
                num: 30
            });

            const searchSnippets = (searchResponse.organic_results || [])
                .map((res: any, idx: number) => `[${idx + 1}] ${res.title}\nSnippet: ${res.snippet}\nImage URL: ${res.thumbnail || res.pagemap?.cse_image?.[0]?.src || ''}`)
                .join('\n\n');

            // 2. Strict prompt ensuring comprehensive coverage
            const prompt = `You are an expert travel planner crafting a full multi-day itinerary context.

**Context:**
- Destination: ${city}
- Travel Style: ${travelType}
- Preferences: ${preferences.join(', ')}

**Instructions:**
1. Extract at least ${numberOfAttractions} distinct attractions and activities from the search snippets below.
2. Ensure you extract enough varied activities (morning spots, afternoon highlights, evening dinner/nightlife options) to fully populate every single day of a 3+ day trip without empty days.
3. Mark high-priority landmarks as 'mustVisit: true'.

**Search Results:**
${searchSnippets}`;

            const result = await this.structuredModel.invoke(prompt);
            console.log(`✅ [GEMINI SEARCH] Successfully parsed ${result.attractions.length} attractions in ${city}`);

            return result;

        } catch (error) {
            console.error('❌ [GEMINI/SERPAPI SEARCH] Error:', error);
            return {
                city,
                country: '',
                attractions: [],
                localTips: []
            };
        }
    }

    async findImageForAttraction(query: string): Promise<string | null> {
        try {
            const searchResponse = await getJson({
                engine: 'google_images',
                q: query,
                api_key: process.env.SERPAPI_API_KEY,
                num: 1
            });
            if (searchResponse.images_results && searchResponse.images_results.length > 0) {
                return searchResponse.images_results[0].original;
            }
            return null;
        } catch (error) {
            console.error(`❌ [SERPAPI IMAGE SEARCH] Error for ${query}:`, error);
            return null;
        }
    }

    filterByAlignment(
        attractions: Attraction[],
        travelType: string,
        preferences: string[]
    ): Attraction[] {
        return attractions
            .filter(attr => {
                if (attr.mustVisit) return true;

                const hasMatchingTag = attr.tags.some(tag =>
                    preferences.some(pref =>
                        tag.toLowerCase().includes(pref.toLowerCase()) ||
                        pref.toLowerCase().includes(tag.toLowerCase())
                    )
                );

                const categoryMatch = this.doesCategoryMatchTravelType(attr.category, travelType);
                return hasMatchingTag || categoryMatch;
            })
            .sort((a, b) => {
                if (a.mustVisit !== b.mustVisit) return a.mustVisit ? -1 : 1;
                const popOrder = { very_high: 3, high: 2, medium: 1 };
                return popOrder[b.popularity] - popOrder[a.popularity];
            });
    }

    private doesCategoryMatchTravelType(category: string, travelType: string): boolean {
        const categoryMap: Record<string, string[]> = {
            cultural: ['museum', 'gallery', 'historic', 'monument', 'temple', 'church', 'palace'],
            adventure: ['park', 'hiking', 'mountain', 'outdoor', 'sport'],
            leisure: ['beach', 'spa', 'park', 'garden', 'shopping'],
            business: ['restaurant', 'cafe', 'conference', 'hotel'],
            family: ['zoo', 'aquarium', 'park', 'amusement_park', 'playground'],
            solo: ['cafe', 'museum', 'market', 'walking_tour']
        };

        const relevantCategories = categoryMap[travelType.toLowerCase()] || [];
        return relevantCategories.some(cat =>
            category.toLowerCase().includes(cat) || cat.includes(category.toLowerCase())
        );
    }
}

export const geminiWebSearch = new GeminiWebSearchService();