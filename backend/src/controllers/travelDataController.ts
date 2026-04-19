import { Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { weatherService } from '../services/weatherService.js';
import { ticketmasterService } from '../services/ticketmasterService.js';
import { amadeusService } from '../services/amadeusService.js';
import { googlePlacesAPI } from '../services/googlePlacesAPI.js';
import Trip from '../models/Trip.js';
import SavedTrip from '../models/SavedTrip.js';

export const getTimelineData = async (req: Request, res: Response) => {
  try {
    const { savedTripId, city: queryCity, lat: queryLat, lon: queryLon, startDate: queryStartDate, totalDays: queryTotalDays } = req.query;

    let city = '';
    let lat = 0;
    let lon = 0;
    let startDate = '';
    let totalDays = 1;
    let trip: any = null;

    if (savedTripId) {
      trip = await SavedTrip.findById(savedTripId);
      if (!trip) return res.status(404).json({ error: 'Trip not found' });
      const mainCity = trip.cities?.[0];
      if (!mainCity) return res.status(400).json({ error: 'Trip has no destination cities' });
      
      city = mainCity.name;
      lat = mainCity.coordinates?.lat || 0;
      lon = mainCity.coordinates?.lng || 0;
      startDate = new Date(trip.startDate).toISOString().split('T')[0];
      totalDays = trip.totalDays || 1;
    } else {
      city = queryCity as string;
      lat = Number(queryLat);
      lon = Number(queryLon);
      startDate = queryStartDate as string;
      totalDays = Number(queryTotalDays) || 1;
    }

    if (!city || !startDate) {
      return res.status(400).json({ error: 'Missing required trip parameters' });
    }

    const endDateObj = new Date(startDate);
    endDateObj.setDate(endDateObj.getDate() + totalDays - 1);
    const endDate = endDateObj.toISOString().split('T')[0];

    const dates = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }

    const destIata = ''; // Mock IATA

    // Refresh Strategy Check
    let weatherData = trip?.timeline?.weather;
    let eventsData = trip?.timeline?.events;
    let hotelsData = [];
    let shouldUpdateMongo = false;
    let refreshWeather = false;
    let refreshEvents = false;
    let refreshHotels = true; // Always fetch hotels dynamically since we don't persist them yet

    if (trip?.timeline) {
      const lastUpdated = trip.timeline.lastUpdated ? new Date(trip.timeline.lastUpdated).getTime() : 0;
      const now = Date.now();
      const hoursSinceUpdate = (now - lastUpdated) / (1000 * 60 * 60);

      if (hoursSinceUpdate > 6 || !weatherData) refreshWeather = true;
      if (hoursSinceUpdate > 24 || !eventsData) refreshEvents = true;
    } else {
      refreshWeather = true;
      refreshEvents = true;
    }

    const startTime = Date.now();
    logger.info(`Fetching timeline data`, { savedTripId, refreshWeather, refreshEvents });

    const promises: Promise<any>[] = [];
    if (refreshWeather) promises.push(weatherService.getMappedForecast(lat, lon, dates).then(d => ({ type: 'weather', data: d })).catch(e => ({ type: 'weather', error: e })));
    if (refreshEvents) promises.push(ticketmasterService.getEvents(city, startDate, endDate).then(d => ({ type: 'events', data: d })).catch(e => ({ type: 'events', error: e })));
    if (refreshHotels) promises.push(amadeusService.getHotels(destIata || city.substring(0,3).toUpperCase()).then(d => ({ type: 'hotels', data: d })).catch(e => ({ type: 'hotels', error: e })));

    if (promises.length > 0) {
      const results = await Promise.all(promises);
      
      results.forEach(res => {
        if (res.error) {
          logger.error(`${res.type} fetch failed`, { error: res.error });
        } else {
          if (res.type === 'weather') { weatherData = res.data; shouldUpdateMongo = true; }
          if (res.type === 'events') { eventsData = res.data; shouldUpdateMongo = true; }
          if (res.type === 'hotels') hotelsData = res.data;
        }
      });
    }

    // Persist refresh if it's a saved trip
    if (trip && shouldUpdateMongo) {
      await SavedTrip.updateOne(
        { _id: trip._id },
        { 
          $set: { 
            "timeline.weather": weatherData,
            "timeline.events": eventsData,
            "timeline.lastUpdated": new Date(),
            "timeline.providerStatus.weather": weatherData ? 'success' : 'unavailable',
            "timeline.providerStatus.events": eventsData && eventsData.length > 0 ? 'success' : 'unavailable'
          } 
        }
      );
    }

    res.json({
      weather: weatherData || null,
      events: eventsData || [],
      hotels: hotelsData || [],
      flights: [], // Fallback empty
      latency: Date.now() - startTime
    });
  } catch (error: any) {
    logger.error('Error in getTimelineData', { error: error.message });
    res.status(500).json({ error: 'Failed to aggregate timeline data' });
  }
};

export const getRestaurants = async (req: Request, res: Response) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ error: 'lat and lon are required' });
    }

    const restaurants = await googlePlacesAPI.getNearbyRestaurants(Number(lat), Number(lon));
    res.json(restaurants);
  } catch (error: any) {
    logger.error('Error fetching restaurants', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch restaurants' });
  }
};
