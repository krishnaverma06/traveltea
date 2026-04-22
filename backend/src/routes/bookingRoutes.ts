import { Router } from 'express';
import auth from '../middleware/auth.js';
import { createBooking, listBookings, getBooking, payBooking, cancelBooking } from '../controllers/bookingController.js';

const router = Router();

// All routes require authentication
router.use(auth);

// Create a new booking
router.post('/', createBooking);

// List the user's bookings
router.get('/', listBookings);

// Get a specific booking (with its transaction history)
router.get('/:id', getBooking);

// Submit a (simulated) payment for a booking
router.post('/:id/pay', payBooking);

// Cancel an unpaid booking
router.post('/:id/cancel', cancelBooking);

export default router;
