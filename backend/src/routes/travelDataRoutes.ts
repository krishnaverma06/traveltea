import express from 'express';
import { getTimelineData, getRestaurants } from '../controllers/travelDataController.js';
import auth from '../middleware/auth.js';

const router = express.Router();

// Get aggregated timeline data (Weather, Events, Hotels, Flights)
router.get('/timeline', auth, getTimelineData);

// Get restaurants (Lazy loaded per day)
router.get('/restaurants', auth, getRestaurants);

export default router;
