import axios from "axios";
import { closestByPincode, closestHubs, resolveArea } from "../utils/serviceability.js";

/**
 * Help panel location step: resolveArea (dataset only), plus — for an area
 * we don't serve — the closest areas we do, for the "Closest areas we
 * cover" chips. Places with no pincode in the text ("Jaipur") are geocoded
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

export async function lookupArea(text) {
  const area = resolveArea(text);
  if (area.serviceable || area.ambiguous.length) return { ...area, closest: [] };
  let closest = area.pincode ? closestByPincode(area.pincode) : [];
  if (!closest.length) {
    const point = await geocode(area.input);
    if (point) closest = closestHubs(point.lat, point.lon);
  }
  return { ...area, closest };
}
