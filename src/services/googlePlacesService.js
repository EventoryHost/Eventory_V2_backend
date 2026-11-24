import axios from "axios";

const PLACES_BASE = "https://places.googleapis.com/v1";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_LINK_REDIRECTS = 5;

const SUMMARY_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "rating",
  "userRatingCount",
  "googleMapsUri",
];

const SHARE_LINK_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "g.page",
  "g.co",
  "share.google",
  "maps.google.com",
  "maps.google.co.in",
  "google.com",
  "www.google.com",
  "google.co.in",
  "www.google.co.in",
  "consent.google.com",
]);

export class GooglePlacesError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const apiKey = () => {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new GooglePlacesError("Google reviews are not configured", 503);
  return key;
};

const call = async (config, fields) => {
  try {
    const response = await axios({
      timeout: REQUEST_TIMEOUT_MS,
      ...config,
      headers: {
        "X-Goog-Api-Key": apiKey(),
        ...(fields ? { "X-Goog-FieldMask": fields.join(",") } : {}),
        ...config.headers,
      },
    });
    return response.data;
  } catch (error) {
    if (error instanceof GooglePlacesError) throw error;
    const status = error.response?.status;
    if (status === 400 || status === 404) {
      throw new GooglePlacesError("Business not found on Google", 404);
    }
    console.error("[google-places]", status ?? error.code, error.response?.data?.error?.message ?? error.message);
    throw new GooglePlacesError("Could not reach Google. Please try again.", 502);
  }
};

const isPlaceId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{10,300}$/.test(value);

export const assertPlaceId = (value) => {
  if (!isPlaceId(value)) throw new GooglePlacesError("Invalid Google place id", 400);
  return value;
};

export const searchBusinesses = async (input, sessionToken) => {
  const data = await call({
    method: "post",
    url: `${PLACES_BASE}/places:autocomplete`,
    data: {
      input,
      includedRegionCodes: ["in"],
      languageCode: "en",
      ...(sessionToken ? { sessionToken } : {}),
    },
  });
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({
      placeId: p.placeId,
      name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      address: p.structuredFormat?.secondaryText?.text ?? "",
    }));
};

const placeUrl = (placeId, sessionToken) => {
  const params = new URLSearchParams({ languageCode: "en" });
  if (sessionToken) params.set("sessionToken", sessionToken);
  return `${PLACES_BASE}/places/${encodeURIComponent(assertPlaceId(placeId))}?${params}`;
};

export const getPlaceSummary = async (placeId, sessionToken) => {
  const place = await call({ method: "get", url: placeUrl(placeId, sessionToken) }, SUMMARY_FIELDS);
  return {
    placeId: place.id,
    name: place.displayName?.text ?? "",
    address: place.formattedAddress ?? "",
    phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
    rating: place.rating ?? null,
    userRatingCount: place.userRatingCount ?? 0,
    googleMapsUri: place.googleMapsUri ?? null,
  };
};

export const placeEmbedUrl = (placeId) => {
  const key = process.env.GOOGLE_MAPS_EMBED_API_KEY;
  if (!key || !isPlaceId(placeId)) return null;
  const params = new URLSearchParams({ key, q: `place_id:${placeId}` });
  return `https://www.google.com/maps/embed/v1/place?${params}`;
};

export const placeMapsUrl = (placeId) =>
  isPlaceId(placeId)
    ? `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: "Google", query_place_id: placeId })}`
    : null;

const parseShareUrl = (raw) => {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  if (!SHARE_LINK_HOSTS.has(url.hostname.toLowerCase())) return null;
  return url;
};

const followShareLink = async (start) => {
  let url = start;
  for (let hop = 0; hop < MAX_LINK_REDIRECTS; hop += 1) {
    if (url.hostname === "consent.google.com" && url.searchParams.get("continue")) {
      const next = parseShareUrl(url.searchParams.get("continue"));
      if (!next) return url;
      url = next;
      continue;
    }
    let response;
    try {
      response = await axios.get(url.toString(), {
        maxRedirects: 0,
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: (s) => s < 400,
        responseType: "stream",
      });
    } catch {
      throw new GooglePlacesError("Could not open that link. Please search for your business instead.", 422);
    }
    response.data?.destroy?.();
    const location = response.headers?.location;
    if (!location || response.status < 300) return url;
    const next = parseShareUrl(new URL(location, url).toString());
    if (!next) throw new GooglePlacesError("That doesn't look like a Google Maps link", 422);
    url = next;
  }
  return url;
};

const placeHintsFromUrl = (url) => {
  const directId = url.searchParams.get("query_place_id") ?? url.searchParams.get("place_id");
  if (isPlaceId(directId)) return { placeId: directId };

  const placeMatch = url.pathname.match(/\/maps\/place\/([^/]+)/);
  const coordMatch = url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const name = placeMatch
    ? decodeURIComponent(placeMatch[1].replace(/\+/g, " "))
    : url.searchParams.get("q") ?? url.searchParams.get("query");
  if (!name) return null;
  return {
    name,
    ...(coordMatch ? { latitude: Number(coordMatch[1]), longitude: Number(coordMatch[2]) } : {}),
  };
};

const findPlaceId = async ({ name, latitude, longitude }) => {
  const data = await call(
    {
      method: "post",
      url: `${PLACES_BASE}/places:searchText`,
      data: {
        textQuery: name,
        regionCode: "in",
        pageSize: 1,
        ...(latitude != null
          ? { locationBias: { circle: { center: { latitude, longitude }, radius: 500 } } }
          : {}),
      },
    },
    ["places.id"]
  );
  return data.places?.[0]?.id ?? null;
};

export const resolveShareLink = async (raw) => {
  const start = parseShareUrl(raw);
  if (!start) throw new GooglePlacesError("That doesn't look like a Google Maps link", 422);
  const finalUrl = await followShareLink(start);
  const hints = placeHintsFromUrl(finalUrl);
  if (!hints) throw new GooglePlacesError("Couldn't find a business in that link. Please search instead.", 422);
  const placeId = hints.placeId ?? (await findPlaceId(hints));
  if (!placeId) throw new GooglePlacesError("Couldn't find a business in that link. Please search instead.", 422);
  return placeId;
};

export default {
  searchBusinesses,
  getPlaceSummary,
  placeEmbedUrl,
  placeMapsUrl,
  resolveShareLink,
  assertPlaceId,
  GooglePlacesError,
};
