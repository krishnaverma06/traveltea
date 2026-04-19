import axios from 'axios';
import { logger } from '../utils/logger';
import { sharedCache } from '../utils/cache';
import { NormalizedWeatherDay } from '../models/travelData';

export class WeatherService {
  private get apiKey(): string {
    return process.env.OPENWEATHER_API_KEY || '';
  }

  /**
   * Exponential backoff retry wrapper
   */
  private async fetchWithRetry<T>(fn: () => Promise<T>, retries = 2, delay = 1000): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      if (retries === 0 || (error.response && error.response.status >= 400 && error.response.status < 500 && error.response.status !== 429)) {
        throw error; // Do not retry client errors except 429 Too Many Requests
      }
      logger.warn(`Retrying OpenWeatherMap API. Retries left: ${retries - 1}`);
      await new Promise((res) => setTimeout(res, delay));
      return this.fetchWithRetry(fn, retries - 1, delay * 2);
    }
  }

  /**
   * Normalizes raw OpenWeatherMap 5-day / 3-hour forecast data into daily aggregates
   */
  private normalizeForecast(list: any[]): NormalizedWeatherDay[] {
    const dailyMap = new Map<string, any>();

    for (const item of list) {
      // item.dt_txt is "YYYY-MM-DD HH:mm:ss"
      const date = item.dt_txt.split(' ')[0];
      if (!dailyMap.has(date)) {
        dailyMap.set(date, {
          date,
          temps: [],
          conditions: [],
          humidities: [],
          windSpeeds: [],
          pops: [], // probability of precipitation
          icons: []
        });
      }

      const dayData = dailyMap.get(date);
      dayData.temps.push(item.main.temp);
      dayData.humidities.push(item.main.humidity);
      dayData.windSpeeds.push(item.wind.speed);
      dayData.pops.push(item.pop * 100); // 0 to 1 -> 0 to 100%
      dayData.conditions.push(item.weather[0].main);
      dayData.icons.push(item.weather[0].icon);
    }

    const normalizedDays: NormalizedWeatherDay[] = [];

    // Helper to get most frequent item in array
    const mode = (arr: any[]) => arr.sort((a,b) =>
          arr.filter(v => v===a).length - arr.filter(v => v===b).length
    ).pop();

    for (const [date, data] of dailyMap.entries()) {
      const minTemp = Math.min(...data.temps);
      const maxTemp = Math.max(...data.temps);
      // Approximate day temp as average
      const dayTemp = data.temps.reduce((a: number, b: number) => a + b, 0) / data.temps.length;
      
      const maxPop = Math.max(...data.pops);
      const avgHumidity = data.humidities.reduce((a: number, b: number) => a + b, 0) / data.humidities.length;
      const avgWindSpeed = data.windSpeeds.reduce((a: number, b: number) => a + b, 0) / data.windSpeeds.length;

      const primaryCondition = mode(data.conditions);
      const primaryIcon = mode(data.icons);

      normalizedDays.push({
        date,
        temperature: {
          min: Math.round(minTemp),
          max: Math.round(maxTemp),
          day: Math.round(dayTemp)
        },
        condition: primaryCondition,
        description: primaryCondition, // In future could use weather[0].description
        humidity: Math.round(avgHumidity),
        windSpeed: Math.round(avgWindSpeed),
        chanceOfRain: Math.round(maxPop),
        icon: primaryIcon
      });
    }

    return normalizedDays;
  }

  /**
   * Fetches weather forecast for a specific coordinate
   */
  async getForecast(lat: number, lon: number): Promise<NormalizedWeatherDay[]> {
    if (!this.apiKey) {
      logger.warn('OpenWeatherMap API Key is missing. Returning empty weather data.');
      return [];
    }

    const cacheKey = sharedCache.generateKey('openweathermap', { lat, lon });
    
    return sharedCache.fetchOrCache<NormalizedWeatherDay[]>(
      cacheKey,
      async () => {
        const fetcher = async () => {
          const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${this.apiKey}`;
          const response = await axios.get(url, { timeout: 8000 });
          return this.normalizeForecast(response.data.list);
        };
        return this.fetchWithRetry(fetcher);
      },
      7200, // cache for 2 hours
      { provider: 'OpenWeatherMap' }
    );
  }

  /**
   * Maps an itinerary date array to the available forecast
   */
  async getMappedForecast(lat: number, lon: number, tripDates: string[]): Promise<Record<string, NormalizedWeatherDay | null>> {
    const forecast = await this.getForecast(lat, lon);
    const result: Record<string, NormalizedWeatherDay | null> = {};

    for (const date of tripDates) {
      // Find the forecast for this exact date
      const dayForecast = forecast.find(f => f.date === date);
      result[date] = dayForecast || null;
    }

    return result;
  }
}

export const weatherService = new WeatherService();
