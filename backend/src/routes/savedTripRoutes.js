import { Router } from "express";
import auth from "../middleware/auth.js";
import {
  saveTrip,
  getSavedTrips,
  getSavedTrip,
  updateSavedTrip,
  deleteSavedTrip,
  checkTripSaved,
  semanticSearchTrips,
  saveItineraryFromChat,
  updateTimelineRestaurants,
  markTripUpcoming,
} from "../controllers/savedTripController.js";

const router = Router();

// All routes require authentication
router.use(auth);

// Save a new trip
router.post("/", saveTrip);

// Get all saved trips for the user
router.get("/", getSavedTrips);

// Check if a trip is already saved
router.get("/check", checkTripSaved);

// Semantic search across saved trips (must be before /:id)
router.get("/search", semanticSearchTrips);

// Save an itinerary the agent generated in chat (must be before /:id)
router.post("/from-itinerary", saveItineraryFromChat);

// Get a specific saved trip
router.get("/:id", getSavedTrip);

// Update a saved trip
router.put("/:id", updateSavedTrip);

// Update timeline restaurants
router.put("/:id/timeline/restaurants", updateTimelineRestaurants);

// Mark a saved trip as upcoming (confirms/sets its start date)
router.put("/:id/upcoming", markTripUpcoming);

// Delete a saved trip
router.delete("/:id", deleteSavedTrip);

export default router;