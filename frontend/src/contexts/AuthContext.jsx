import React, { createContext, useContext, useEffect, useState } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("traveltea_token");

    if (token) {
      fetchUser();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchUser = async () => {
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

      if (!response.ok) {
        localStorage.removeItem("traveltea_token");
        setUser(null);
        return;
      }

      const data = await response.json();

      // Backend returns { user: {...} }
      setUser(data.user);
    } catch (error) {
      console.error("Failed to fetch user:", error);
      localStorage.removeItem("traveltea_token");
      setUser(null);
    } finally {
      setLoading(false);
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
    setUser(null);
  };

  const value = {
    user,
    login,
    signup,
    logout,
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