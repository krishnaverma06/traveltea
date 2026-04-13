import jwt from "jsonwebtoken";
import User from "../models/User.js";
import SavedTrip from "../models/SavedTrip.js";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../config/configenv.js";
console.log("✅ authController loaded");

function generateToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function serializeUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    bio: user.bio,
    notifications: user.notifications,
    preferences: user.preferences,
    createdAt: user.createdAt,
  };
}

export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "Name, email and password required" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "Email already in use" });
    }

    const user = await User.create({ name, email, password });
    const token = generateToken(user._id.toString());

    return res.status(201).json({
      user: { id: user._id, name: user.name, email: user.email },
      token,
    });
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Registration failed", error: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const user = await User.findOne({ email }).select("+password name email");
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = generateToken(user._id.toString());
    return res.json({
      user: { id: user._id, name: user.name, email: user.email },
      token,
    });
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Login failed", error: err.message });
  }
};

export const me = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json({ user: serializeUser(user) });
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Failed to fetch user", error: err.message });
  }
};

export const updatePreferences = async (req, res) => {
  try {
    const { budget, travelStyle, interests } = req.body;

    const user = await User.findByIdAndUpdate(
      req.userId,
      {
        preferences: { budget, travelStyle, interests },
      },
      { new: true }
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    return res.json({ user: serializeUser(user) });
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Failed to update preferences", error: err.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { name, bio, notifications } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (bio !== undefined) updates.bio = bio;
    if (notifications !== undefined) updates.notifications = notifications;

    const user = await User.findByIdAndUpdate(req.userId, updates, {
      new: true,
      runValidators: true,
    });

    if (!user) return res.status(404).json({ message: "User not found" });

    return res.json({ user: serializeUser(user) });
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Failed to update profile", error: err.message });
  }
};

export const deleteAccount = async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    await SavedTrip.deleteMany({ user: req.userId });
    await User.findByIdAndDelete(req.userId);

    return res.json({ message: "Account deleted successfully" });
  } catch (err) {
    console.log(err);
    return res
      .status(500)
      .json({ message: "Failed to delete account", error: err.message });
  }
};