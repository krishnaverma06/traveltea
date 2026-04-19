/**
 * Normalized Domain Models for Travel Data
 * The frontend will consume these models regardless of the underlying provider.
 */

export interface NormalizedFlight {
  id: string;
  airline: string;
  departure: {
    iata: string;
    at: string; // ISO DateTime
  };
  arrival: {
    iata: string;
    at: string; // ISO DateTime
  };
  duration: string; // ISO 8601 duration or formatted string
  price: {
    amount: string;
    currency: string;
  };
  stops: number;
  bookingUrl?: string; // Optional booking link
}

export interface NormalizedHotel {
  id: string;
  name: string;
  rating: number; // 0-5
  image: string | null;
  address: string;
  price?: {
    amount: string;
    currency: string;
  };
  amenities: string[];
  distanceFromCenter?: string;
  bookingUrl?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
}

export interface NormalizedEvent {
  id: string;
  name: string;
  startDate: string; // ISO Date
  time?: string;
  venue: string;
  imageUrl: string | null;
  ticketUrl: string;
  category?: string;
}

export interface NormalizedRestaurant {
  id: string;
  name: string;
  rating: number;
  reviewCount: number;
  cuisine: string[];
  priceLevel: string | null; // e.g., "$$", "Moderate"
  distance?: number; // meters
  mapsUrl: string;
  imageUrl: string | null;
  location: {
    latitude: number;
    longitude: number;
  };
}

export interface NormalizedWeatherDay {
  date: string; // YYYY-MM-DD
  temperature: {
    min: number;
    max: number;
    day: number;
  };
  condition: string; // e.g., "Clear", "Rain"
  description: string;
  humidity: number;
  windSpeed: number;
  chanceOfRain: number; // 0-100
  icon: string; // e.g., OpenWeatherMap icon code or normalized generic code
}
