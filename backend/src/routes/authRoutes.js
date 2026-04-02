import { Router } from "express";
import { login, me, register } from "../controllers/authcontroller.js";
import auth from "../middleware/auth.js";
console.log("✅ authRoutes loaded");

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", auth, me);

export default router;