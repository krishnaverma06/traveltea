const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

async function request(path, options = {}) {
  const { headers, ...restOptions } = options;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...restOptions,
    headers: {
      "Content-Type": "application/json",
      ...(headers || {}),
    },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.message || data?.error || "Request failed";
    const error = new Error(message);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function apiRegister({ name, email, password }) {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
}

export async function apiLogin({ email, password }) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function apiMe(token) {
  return request("/api/auth/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiUpdateProfile(payload, token) {
  return request("/api/auth/profile", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function apiUpdatePreferences(payload, token) {
  return request("/api/auth/preferences", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function apiDeleteAccount(token) {
  return request("/api/auth/account", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function saveToken(token) {
  localStorage.setItem("traveltea_token", token);
}

export function getToken() {
  return localStorage.getItem("traveltea_token");
}

export function clearToken() {
  localStorage.removeItem("traveltea_token");
}


// Trip APIs
export async function apiCreateTrip(payload, token) {
  return request("/api/trips", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function apiListTrips(token) {
  return request("/api/trips", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Saved Trips APIs
export async function apiSaveTrip(payload, token) {
  return request("/api/saved-trips", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function apiGetSavedTrips(token, params = {}) {
  const queryParams = new URLSearchParams(params).toString();
  const url = queryParams
    ? `/api/saved-trips?${queryParams}`
    : "/api/saved-trips";

  return request(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiSearchSavedTrips(query, token) {
  const queryParams = new URLSearchParams({ q: query }).toString();
  return request(`/api/saved-trips/search?${queryParams}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Save an itinerary the agent generated in chat.
 *
 * A dedicated endpoint rather than POST /api/saved-trips because the chat
 * itinerary shape doesn't match the SavedTrip schema — the server does the
 * mapping (and the embedding + vector ingestion) so the client doesn't have to
 * reconstruct budget splits it never had.
 */
export async function apiSaveItineraryFromChat(payload, token) {
  return request("/api/saved-trips/from-itinerary", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function apiGetSavedTrip(id, token) {
  return request(`/api/saved-trips/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiUpdateSavedTrip(id, payload, token) {
  return request(`/api/saved-trips/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function apiDeleteSavedTrip(id, token) {
  return request(`/api/saved-trips/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiGetSearchSuggestions(q, token, signal) {
  const queryParams = new URLSearchParams({ q }).toString();
  return request(`/api/search/suggestions?${queryParams}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
}

export async function apiGetExploreDestinations(params = {}) {
  const queryParams = new URLSearchParams(params).toString();
  const url = queryParams
    ? `/api/explore/destinations?${queryParams}`
    : "/api/explore/destinations";
  return request(url);
}

export async function apiGetExploreTrending() {
  return request("/api/explore/trending");
}

export async function apiGetExploreRecommendations(token) {
  return request("/api/explore/recommendations", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiCheckTripSaved(params, token) {
  const queryParams = new URLSearchParams(params).toString();
  return request(`/api/saved-trips/check?${queryParams}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiMarkTripAsUpcoming(id, payload, token) {
  return request(`/api/saved-trips/${id}/upcoming`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}
// ---------------------------------------------------------------------------
// Flights & Hotels search + booking
// ---------------------------------------------------------------------------

export async function apiSearchFlights(params, token) {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/travel-search/flights?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiSearchHotels(params, token) {
  const qs = new URLSearchParams(params).toString();
  return request(`/api/travel-search/hotels?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiSearchAirports(q, token, signal) {
  const qs = new URLSearchParams({ q }).toString();
  return request(`/api/travel-search/airports?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
}

export async function apiCreateBooking(payload, token) {
  return request("/api/bookings", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

/**
 * Submit a (simulated) payment.
 *
 * NOTE: a declined payment comes back as HTTP 200 with `status:
 * 'payment_failed'`, not a 4xx — callers must branch on the body, never on the
 * status code.
 */
export async function apiPayBooking(bookingId, payment, token) {
  return request(`/api/bookings/${bookingId}/pay`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payment),
  });
}

export async function apiListBookings(token, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(qs ? `/api/bookings?${qs}` : "/api/bookings", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiListTransactions(token, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return request(qs ? `/api/transactions?${qs}` : "/api/transactions", {
    headers: { Authorization: `Bearer ${token}` },
  });
}
