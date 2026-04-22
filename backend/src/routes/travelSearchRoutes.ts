import { Router } from 'express';
import auth from '../middleware/auth.js';
import { searchFlights, searchHotels, airportLookup } from '../controllers/travelSearchController.js';

const router = Router();

// Blanket auth, same convention as bookingRoutes.ts.
router.use(auth);

router.get('/flights', searchFlights);
router.get('/hotels', searchHotels);
router.get('/airports', airportLookup);

export default router;
