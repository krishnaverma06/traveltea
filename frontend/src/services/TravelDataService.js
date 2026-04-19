import { getToken } from '../lib/api';

class TravelDataService {
  constructor() {
    this.cache = new Map();
    this.pendingPromises = new Map();
  }

  async _fetchOrCache(key, url) {
    if (this.cache.has(key)) {
      console.log(`[TravelDataService] Cache HIT: ${key}`);
      return this.cache.get(key);
    }

    if (this.pendingPromises.has(key)) {
      console.log(`[TravelDataService] Deduplicating request: ${key}`);
      return this.pendingPromises.get(key);
    }

    const promise = (async () => {
      try {
        const token = getToken();
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        this.cache.set(key, data);
        return data;
      } catch (error) {
        console.error(`[TravelDataService] Fetch failed for ${key}:`, error);
        throw error;
      } finally {
        this.pendingPromises.delete(key);
      }
    })();

    this.pendingPromises.set(key, promise);
    return promise;
  }

  /**
   * Fetches the unified timeline data (Weather, Hotels, Events, Flights)
   * @param {string|null} savedTripId 
   * @param {Object} tripData - Fallback data if trip is unsaved
   */
  async getTimelineData(savedTripId, tripData = null) {
    if (!savedTripId && !tripData) return null;
    
    let url = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/travel-data/timeline?`;
    let key = 'timeline:';
    
    if (savedTripId) {
      url += `savedTripId=${savedTripId}`;
      key += savedTripId;
    } else {
      const city = tripData.cities?.[0]?.name || '';
      const lat = tripData.cities?.[0]?.coordinates?.lat || 0;
      const lon = tripData.cities?.[0]?.coordinates?.lng || 0;
      const startDate = tripData.startDate instanceof Date ? tripData.startDate.toISOString().split('T')[0] : (tripData.startDate || '');
      const totalDays = tripData.cities?.reduce((sum, c) => sum + (c.days || 0), 0) || 1;
      
      const params = new URLSearchParams({
        city,
        lat: lat.toString(),
        lon: lon.toString(),
        startDate,
        totalDays: totalDays.toString()
      });
      url += params.toString();
      key += `${city}-${startDate}-${totalDays}`;
    }

    return this._fetchOrCache(key, url);
  }

  /**
   * Fetches restaurants for a specific coordinate.
   * Typically lazy-loaded per day via IntersectionObserver.
   */
  async getRestaurants(lat, lon) {
    if (!lat || !lon) return [];
    
    // Round coords to avoid cache misses on tiny floating point differences
    const roundedLat = Math.round(lat * 100) / 100;
    const roundedLon = Math.round(lon * 100) / 100;
    const key = `restaurants:${roundedLat},${roundedLon}`;
    
    const url = `${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/travel-data/restaurants?lat=${lat}&lon=${lon}`;
    return this._fetchOrCache(key, url);
  }

  async saveRestaurants(savedTripId, restaurants) {
    if (!savedTripId || !restaurants || restaurants.length === 0) return;
    try {
      const token = getToken();
      await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/saved-trips/${savedTripId}/timeline/restaurants`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ restaurants: { "default": restaurants } }) // Simple structure, could be keyed by coords in future
      });
    } catch (error) {
      console.error('[TravelDataService] Failed to save timeline restaurants:', error);
    }
  }

  clearCache() {
    this.cache.clear();
  }
}

export const travelDataService = new TravelDataService();
