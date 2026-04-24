/**
 * Coordinate normalisation for the Leaflet <Map /> component.
 *
 * Activity coordinates arrive in two shapes depending on which builder
 * produced the itinerary:
 *
 *   enhancedItineraryBuilder / googlePlacesAPI -> { latitude, longitude }
 *   itineraryBuilder / OpenTripMap places      -> { lat, lon }
 *
 * Chat.jsx and ItinearyPage.jsx both filtered on `lat`/`lon` only, so every
 * Google-Places-backed itinerary produced an empty location list and the map
 * fell back to its hardcoded Paris centre — the "No Locations Yet" empty state
 * on a 29-activity itinerary. Accept either shape here so neither caller has
 * to care which builder ran.
 */

/** Pull a {lat, lon} pair out of an activity, or null if it has no usable one. */
export function activityCoords(activity) {
  const loc = activity?.location;
  if (!loc) return null;

  const lat = typeof loc.lat === "number" ? loc.lat : loc.latitude;
  const lon =
    typeof loc.lon === "number"
      ? loc.lon
      : typeof loc.lng === "number"
        ? loc.lng
        : loc.longitude;

  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  // (0,0) is in the Gulf of Guinea — always a missing-data sentinel here.
  if (lat === 0 && lon === 0) return null;

  return { lat, lon };
}

/** Flatten an itinerary's days into the {lat, lon, name, description} list <Map /> wants. */
export function toMapLocations(days) {
  return (days || [])
    .flatMap((day) => day?.timeSlots || [])
    .flatMap((slot) => slot?.activities || [])
    .map((activity) => {
      const coords = activityCoords(activity);
      if (!coords) return null;
      return {
        ...coords,
        name: activity.name,
        description: activity.category,
      };
    })
    .filter(Boolean);
}
