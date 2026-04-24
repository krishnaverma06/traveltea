import React, { createContext, useContext, useEffect, useState } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // One-time cleanup: an older build stored {token, user} under an "auth"
    // key. Nothing has read it since the move to "traveltea_token", so it just
    // sits in every existing user's browser holding a stale JWT — and it is
    // easy to mistake for the live session when debugging.
    if (localStorage.getItem("auth")) {
      localStorage.removeItem("auth");
    }

    const token = localStorage.getItem("traveltea_token");

    if (token) {
      fetchUser();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchUser = async (attempt = 0) => {
    const MAX_RETRIES = 3;
    let retryScheduled = false;

    try {
      const API_URL =
        import.meta.env.VITE_API_URL || "http://localhost:5000";

      const token = localStorage.getItem("traveltea_token");

      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      // Only a 401 means the token is genuinely bad — that's the one case
      // where dropping it is correct.
      if (response.status === 401) {
        localStorage.removeItem("traveltea_token");
        setUser(null);
        return;
      }

      // Any other non-OK status (5xx, 502 from a restarting backend, …) says
      // nothing about the token's validity. Keep it and let the next load
      // retry, rather than silently signing the user out.
      if (!response.ok) {
        console.warn(`/api/auth/me returned ${response.status}; keeping session`);
        setUser(null);
        return;
      }

      const data = await response.json();

      // Backend returns { user: {...} }
      setUser(data.user);
    } catch (error) {
      // Network-level failure (backend down, offline, DNS). Indistinguishable
      // from a blip — must NOT destroy the session, which is what removing
      // the token here used to do on every backend restart.
      if (attempt < MAX_RETRIES) {
        retryScheduled = true;
        const delay = 1000 * 2 ** attempt; // 1s, 2s, 4s
        console.warn(
          `/api/auth/me unreachable, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`,
        );
        setTimeout(() => fetchUser(attempt + 1), delay);
        return; // keep loading=true; the scheduled retry resolves it
      }

      console.error("Failed to fetch user after retries:", error);
      setUser(null);
    } finally {
      // Stay in "loading" only while a retry is genuinely pending — every
      // other path (success, 401, 5xx, exhausted retries) must clear it.
      if (!retryScheduled) setLoading(false);
    }
  };

  const login = async (email, password) => {
    const API_URL =
      import.meta.env.VITE_API_URL || "http://localhost:5000";

    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Login failed");
    }

    localStorage.setItem("traveltea_token", data.token);
    setUser(data.user);
  };

  const signup = async (name, email, password) => {
    const API_URL =
      import.meta.env.VITE_API_URL || "http://localhost:5000";

    const response = await fetch(`${API_URL}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Signup failed");
    }

    localStorage.setItem("traveltea_token", data.token);
    setUser(data.user);
  };

  const logout = () => {
    localStorage.removeItem("traveltea_token");
    // A new login on the same browser shouldn't inherit the previous
    // user's chat thread — Conversation lookups are user-scoped server
    // side, so this is a UX fix, not a security one.
    localStorage.removeItem("traveltea_conversationId");
    setUser(null);
  };

  const updateUser = (updatedFields) => {
    setUser((prev) => (prev ? { ...prev, ...updatedFields } : prev));
  };

  const value = {
    user,
    login,
    signup,
    logout,
    updateUser,
    loading,
    isAuthenticated: !!user,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}