import { isAfter, startOfDay } from "date-fns";

/**
 * Single source of truth for saved-trip statistics.
 *
 * These numbers used to be computed independently in ProfilePage,
 * TripPlannerPage and TripsPage, and the three disagreed: /profile counted only
 * completed trips ("3 cities / 9 days") while /plan and /trips counted every
 * saved trip including ones that hadn't happened yet ("6 / 18"). Same labels,
 * different numbers, depending on which page you were looking at.
 *
 * Resolved in favour of the profile semantics: "visited" means visited.
 * A trip you haven't taken yet cannot have added cities or days to your travel
 * history.
 */

/**
 * The moment a trip is over — the midnight *after* its final day.
 *
 * Note this is an exclusive end, deliberately: a 3-day trip starting Aug 5
 * covers Aug 5-7 and is complete at Aug 8 00:00, which is exactly when
 * `end < now` should start being true. It is NOT the same as the inclusive
 * "End Date" the planning sidebar displays (which uses totalDays - 1, i.e.
 * Aug 7) — both are correct for their own purpose.
 */
export function getTripEndDate(trip) {
  const start = new Date(trip.startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + (tripDays(trip) || 0));
  return end;
}

/**
 * A trip's length in days. Prefers the stored totalDays but falls back to
 * summing the per-city day counts, since older saved trips can be missing it.
 */
export function tripDays(trip) {
  return trip?.totalDays || trip?.cities?.reduce((sum, c) => sum + (c?.days || 0), 0) || 0;
}

/** Trips that have already finished. */
export function getCompletedTrips(savedTrips = [], now = new Date()) {
  return savedTrips.filter((t) => t.startDate && getTripEndDate(t) < now);
}

/** Trips that start after today. */
export function getUpcomingTrips(savedTrips = [], now = new Date()) {
  const today = startOfDay(now);
  return savedTrips
    .filter((t) => t.startDate && isAfter(new Date(t.startDate), today))
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
}

/**
 * Every headline statistic, computed once.
 *
 * `citiesVisited` / `daysTraveled` / `countriesVisited` count COMPLETED trips
 * only. `totalTrips` counts everything saved, and `upcomingCount` counts what's
 * still ahead.
 */
export function getTripStats(savedTrips = [], now = new Date()) {
  const completed = getCompletedTrips(savedTrips, now);
  const upcoming = getUpcomingTrips(savedTrips, now);

  return {
    completedTrips: completed,
    upcomingTrips: upcoming,

    totalTrips: savedTrips.length,
    completedCount: completed.length,
    upcomingCount: upcoming.length,

    daysTraveled: completed.reduce((sum, t) => sum + tripDays(t), 0),
    citiesVisited: new Set(completed.flatMap((t) => t.cities?.map((c) => c.name) || [])).size,
    countriesVisited: new Set(
      completed.flatMap((t) => t.cities?.map((c) => c.country).filter(Boolean) || []),
    ).size,
  };
}
