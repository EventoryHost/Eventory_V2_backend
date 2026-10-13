import axios from "axios";
import { closestHubs, closestServed, resolveArea, servedInCity } from "../utils/helpServiceAreas.js";

/**
 * Help panel location step: resolveArea (ncrServiceAreas.csv), plus — for
 * an area we don't serve — the closest areas we do, for the "Closest areas
 * we cover" chips: served localities when it's in a city we're in, else the
 * nearest cities. Places we can't place from the text ("Jaipur") are geocoded
 * once with OpenStreetMap Nominatim (the same free geocoder the site's
 * location picker uses), cached in memory; a failed lookup just means no
 * chips.
 */
const geocodeCache = new Map();

async function geocode(text) {
  const key = text.toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  let point = null;
  try {
    const { data } = await axios.get("https://nominatim.openstreetmap.org/search", {
      params: { format: "json", countrycodes: "in", limit: 1, q: text },
      headers: { "User-Agent": "Eventory help panel (tech@eventory.in)" },
      timeout: 3000,
    });
    if (data?.[0]) point = { lat: Number(data[0].lat), lon: Number(data[0].lon) };
  } catch {
    // Offline or rate-limited: no chips this time, try again next request.
    return null;
  }
  if (geocodeCache.size > 2000) geocodeCache.clear();
  geocodeCache.set(key, point);
  return point;
}

// Within this of a city centre, a geocoded place counts as in that city.
const IN_CITY_KM = 25;

export async function lookupArea(text) {
  const area = resolveArea(text);
  if (area.serviceable || area.ambiguous.length) return { ...area, closest: [] };
  let closest = closestServed(area);
  if (!closest.length) {
    const point = await geocode(area.input);
    if (point) {
      const hubs = closestHubs(point.lat, point.lon);
      closest = hubs[0].km <= IN_CITY_KM
        ? servedInCity(hubs[0].city)
        : hubs.map(({ label, city }) => ({ label, city }));
    }
  }
  return { ...area, closest };
}
