import { Router } from "express";
import { login, me, register, updatePreferences } from "../controllers/authcontroller.js";
import auth from "../middleware/auth.js";
console.log("✅ authRoutes loaded");

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", auth, me);
router.put("/preferences",auth,updatePreferences)

export default router;