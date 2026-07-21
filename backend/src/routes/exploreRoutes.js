import { Router } from "express";
import auth from "../middleware/auth.js";
import {
  getDestinations,
  getTrending,
  getRecommendations,
} from "../controllers/exploreController.js";

const router = Router();

router.get("/destinations", getDestinations);
router.get("/trending", getTrending);
router.get("/recommendations", auth, getRecommendations);

export default router;
