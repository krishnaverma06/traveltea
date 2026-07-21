import { Router } from "express";
import auth from "../middleware/auth.js";
import { getSearchSuggestions } from "../controllers/searchController.js";

const router = Router();

router.use(auth);

router.get("/suggestions", getSearchSuggestions);

export default router;
