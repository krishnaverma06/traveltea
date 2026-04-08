import { getJson } from "serpapi";

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}



export class WebSearchAPI {
  
  private apiKey: string;

  constructor(apiKey?: string) {
    // Ensure SERPAPI_API_KEY is defined in your .env file
    this.apiKey = apiKey || process.env.SERPAPI_API_KEY || '';
  }
  
  /**
   * Search the web using SerpApi
   */
  async searchWeb(query: string, numResults: number = 5): Promise<SearchResult[]> {
    try {
      console.log(`🔍 [WEB SEARCH] Searching via SerpApi: ${query}`);
      
      const json = await getJson({
        engine: "google", // You can also use "duckduckgo" or "bing"
        q: query,
        api_key: this.apiKey,
        num: numResults,
      });
     

      if (!json.organic_results) {
        console.warn("⚠️ No organic results found.");
        return [];
      }
      
      return json.organic_results.map((item: any) => ({
        title: item.title || 'No Title',
        link: item.link || '',
        snippet: item.snippet || '',
        position: item.position || 0,
      }));
    } catch (error) {
      console.error('SerpApi search error:', error);
      return [];
    }
  }

  async searchTravelInfo(destination: string, topic: string): Promise<SearchResult[]> {
    return this.searchWeb(`${destination} ${topic} travel guide`, 5);
  }

  async getTravelTips(destination: string): Promise<SearchResult[]> {
    return this.searchTravelInfo(destination, 'tips things to know');
  }

  async searchRestaurants(destination: string, cuisine?: string): Promise<SearchResult[]> {
    const query = cuisine ? `best ${cuisine} restaurants in ${destination}` : `best restaurants in ${destination}`;
    return this.searchWeb(query, 5);
  }

  async searchHotelReviews(hotelName: string, destination: string): Promise<SearchResult[]> {
    const query = `${hotelName} ${destination} hotel reviews`;
    return this.searchWeb(query, 5);
  }

  async fetchPageSummary(url: string): Promise<string | null> {
    // Note: SerpApi is primarily for search results. 
    // For specific page content, consider using a specialized scraper or the URL directly.
    return "Summary functionality requires a direct page fetcher.";
  }
}

export const webSearchAPI = new WebSearchAPI();