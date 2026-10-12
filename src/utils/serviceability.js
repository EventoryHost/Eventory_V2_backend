import fs from "fs";
import { flattenServiceAreas, normalizeServiceAreas } from "./serviceAreas.js";

/**
 * Location serviceability — the PDP's "is this vendor available at my
 * location" check (added 2026-09-21).
 *
 * Two layers:
 *  1. PLATFORM: Eventory only operates in the Delhi NCR pincodes listed in
 *     src/data/serviceablePincodes.json (194 pincodes across Delhi,
 *     Gurugram, Faridabad, Noida/Greater Noida (Gautam Buddha Nagar) and
 *     Ghaziabad — scraped from indelhincr.com/PinCode.aspx, the list the
 *     product owner named as the source of truth). Any pincode outside it is
 *     non-serviceable, for every vendor.
 *  2. VENDOR: the vendor's own `serviceAreas` (picked in vendor onboarding,
 *     "What is your Service area?" — `[{ area, sublocalities }]`, see
 *     utils/serviceAreas.js). There is no pincode/radius data on the vendor
 *     side, so a vendor area is matched to a pincode by NAME: an area with no
 *     localities covers every pincode in that city/region; a locality covers
 *     pincodes whose post-office/area names contain it (e.g. "Sector 18" ->
 *     "Sector 18 Noida"), falling back to its area's city when no post office
 *     carries the locality's name. A vendor with NO serviceAreas declared has stated no
 *     restriction, so they are treated as serving the whole platform region
 *     (flagged as basis NO_AREAS_DECLARED, not silently presented as a
 *     confirmed match) — 279 of 304 prod vendors are in this state today.
 */
const PINCODES = JSON.parse(fs.readFileSync(new URL("../data/serviceablePincodes.json", import.meta.url), "utf8"));

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// (state, district) -> the city label a vendor's "city" chip would use.
function cityOf(info) {
  if (info.state === "DELHI") return "Delhi";
  if (info.district === "GURUGRAM") return "Gurugram";
  if (info.district === "FARIDABAD") return "Faridabad";
  if (info.district === "GHAZIABAD") return "Ghaziabad";
  if (info.district === "GAUTAM BUDDHA NAGAR") return "Noida";
  return info.district;
}

// Vendor UI has Delhi region chips ("South Delhi", "Old Delhi", ...) — map
// them to the Delhi districts in the dataset.
const DELHI_REGION_CHIPS = {
  "south delhi": ["SOUTH", "SOUTH EAST", "SOUTH WEST"],
  "north delhi": ["NORTH", "NORTH WEST", "NORTH EAST"],
  "central delhi": ["CENTRAL", "WEST"],
  "old delhi": ["CENTRAL", "NORTH"],
  "new delhi": ["NEW DELHI"],
};

// Area chips spelled differently from the dataset's city labels.
const AREA_ALIASES = { gurgaon: "gurugram" };

export function extractPincode(text) {
  const m = String(text || "").match(/(?<!\d)(\d{6})(?!\d)/);
  return m ? m[1] : null;
}

/**
 * Distinct, alphabetically sorted RAW district names across the whole
 * serviceable dataset — e.g. "CENTRAL", "SOUTH WEST", "GAUTAM BUDDHA NAGAR",
 * exactly as they appear on indelhincr.com/PinCode.aspx (the dataset's
 * source) and in serviceablePincodes.json's own `district` field. This is
 * the raw admin-district level, NOT the 5 collapsed city labels cityOf()
 * derives for the vendor-serviceability match — the navbar's district
 * picker wants every real district, not the coarser city grouping.
 */
export function listServiceableCities() {
  const districts = new Set(Object.values(PINCODES).map((info) => info.district));
  return [...districts].sort();
}

export function lookupPincode(pincode) {
  const info = PINCODES[String(pincode || "").trim()];
  if (!info) return null;
  return { pincode: String(pincode).trim(), city: cityOf(info), district: info.district, state: info.state, areas: info.areas };
}

// Locality chips the vendor UI offers (plus legacy ones already in vendor
// data) -> their city. The pincode dataset only carries post-office names, so
// many real localities ("Indirapuram", "Sector 62", "Golf Course Road") match
// no pincode by name. For those, fall back to the CITY the locality belongs
// to — deliberately broader than the vendor meant, reported as basis
// CITY_LEVEL_FALLBACK rather than a precise match.
const LOCALITY_CITY = {
  indirapuram: "Ghaziabad", vasundhara: "Ghaziabad", vaishali: "Ghaziabad", "raj nagar": "Ghaziabad",
  kaushambi: "Ghaziabad", "crossings republik": "Ghaziabad",
  "connaught place": "Delhi", "lajpat nagar": "Delhi", "hauz khas": "Delhi", dwarka: "Delhi", saket: "Delhi", rohini: "Delhi",
  "sector 18": "Noida", "sector 62": "Noida", "sector 63": "Noida", "sector 137": "Noida", "sector 15": "Noida",
  "noida extension": "Noida", "greater noida": "Noida",
  "dlf phase 1": "Gurugram", "sushant lok": "Gurugram", "golf course road": "Gurugram", "sohna road": "Gurugram",
  "mg road": "Gurugram", "sector 56": "Gurugram", "sector 14": "Gurugram",
};

// -> "exact" | "city_fallback" | null
function areaMatchLevel(vendorArea, info) {
  const raw = norm(vendorArea);
  const a = AREA_ALIASES[raw] || raw;
  if (!a) return null;
  if (a === norm(info.city)) return "exact"; // city chip
  if (a === "greater noida" && info.district === "GAUTAM BUDDHA NAGAR") {
    if (info.areas.some((n) => norm(n).includes("greater noida"))) return "exact";
  }
  if (DELHI_REGION_CHIPS[a]) return info.state === "DELHI" && DELHI_REGION_CHIPS[a].includes(info.district) ? "exact" : null;
  if (info.areas.some((n) => norm(n).includes(a))) return "exact";
  if (LOCALITY_CITY[a] && LOCALITY_CITY[a] === info.city) return "city_fallback";
  return null;
}

// An area with no localities covers its whole city/region. With localities,
// only those count; when none of them names a post office, the area itself
// is the (broader) fallback.
function entryMatchLevel({ area, sublocalities }, info) {
  if (sublocalities.length === 0) return areaMatchLevel(area, info);
  if (sublocalities.some((s) => info.areas.some((n) => norm(n).includes(norm(s))))) return "exact";
  return areaMatchLevel(area, info) ? "city_fallback" : null;
}

/**
 * @returns {{platformServiceable:boolean, vendorServiceable:boolean|null,
 * serviceable:boolean, reason:string|null, basis:string|null, location:object|null}}
 */
export function checkServiceability(pincode, vendorServiceAreas) {
  const info = lookupPincode(pincode);
  if (!info) {
    return { platformServiceable: false, vendorServiceable: null, serviceable: false, reason: "OUTSIDE_SERVICE_REGION", basis: null, location: null };
  }
  const location = { pincode: info.pincode, city: info.city, district: info.district, state: info.state, areas: info.areas };
  const declared = normalizeServiceAreas(vendorServiceAreas);
  if (declared.length === 0) {
    return { platformServiceable: true, vendorServiceable: true, serviceable: true, reason: null, basis: "NO_AREAS_DECLARED", location };
  }
  const levels = declared.map((entry) => entryMatchLevel(entry, info)).filter(Boolean);
  const matched = levels.length > 0;
  return {
    platformServiceable: true,
    vendorServiceable: matched,
    serviceable: matched,
    reason: matched ? null : "VENDOR_DOES_NOT_SERVE_AREA",
    basis: !matched ? null : levels.includes("exact") ? "SERVICE_AREA_MATCH" : "CITY_LEVEL_FALLBACK",
    location,
  };
}

// For the "vendor provides service at" list: the vendor's own names, flat,
// split into areas and localities, plus the structured entries.
export function describeVendorAreas(serviceAreas) {
  const areas = normalizeServiceAreas(serviceAreas);
  return {
    all: flattenServiceAreas(areas),
    cities: areas.map((e) => e.area),
    localities: areas.flatMap((e) => e.sublocalities),
    areas,
  };
}

// Platform city names and common spellings, for free-text areas.
const PLATFORM_CITY_NAMES = {
  delhi: "Delhi", "new delhi": "Delhi", "south delhi": "Delhi", "north delhi": "Delhi", "east delhi": "Delhi",
  "west delhi": "Delhi", "central delhi": "Delhi", "old delhi": "Delhi", ncr: "Delhi",
  gurugram: "Gurugram", gurgaon: "Gurugram", noida: "Noida", "greater noida": "Noida",
  ghaziabad: "Ghaziabad", faridabad: "Faridabad",
};

// Cities with numbered sectors. "Sector 15" alone is ambiguous between them.
const SECTOR_CITIES = ["Noida", "Gurugram", "Faridabad"];

// Post-office names carry suffixes ("Punjabi Bagh S.O", "Rohini sec11").
const cleanPostOffice = (name) =>
  String(name)
    .replace(/\b(S\.?O|H\.?O|B\.?O|EXTN COUNTER|EXTENSION COUNTER)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());

/** The most specific part of what the customer gave: "Rohini Sector 5, Delhi, 110085" -> "Rohini Sector 5". */
function displayLabel(raw, pincodeInfo) {
  const first = raw.split(",").map((p) => p.trim()).find((p) => p && !/^\d{6}$/.test(p));
  if (first) return first.replace(/\s*\d{6}$/, "").trim();
  return pincodeInfo ? cleanPostOffice(pincodeInfo.areas[0]) : raw;
}

/**
 * Where is this free-text area, and do we serve it? The help panel's
 * location step (frontend customer-help, Figma "09 — Location").
 *  - A pincode decides it outright (the dataset is the source of truth).
 *  - Else a platform city / known locality / NCR post-office name = served.
 *  - "Sector 15" with no city named is ambiguous: every city that has one.
 *  - Anything else is outside the region.
 */
export function resolveArea(text) {
  const raw = String(text || "").trim();
  const base = { input: raw, label: raw, serviceable: false, city: null, pincode: null, matchedBy: null, ambiguous: [] };
  if (!raw) return base;

  const pin = extractPincode(raw);
  if (pin) {
    const info = lookupPincode(pin);
    return { ...base, label: displayLabel(raw, info), pincode: pin, serviceable: Boolean(info), city: info?.city ?? null, matchedBy: "pincode" };
  }

  const t = norm(raw);
  const words = ` ${t} `;
  const label = displayLabel(raw, null);
  const cityNamed = Object.entries(PLATFORM_CITY_NAMES).find(([name]) => words.includes(` ${name} `));

  const sector = t.match(/\bsector\s?(\d{1,3})\b/);
  if (sector && !cityNamed) {
    const n = sector[1];
    const re = new RegExp(`\\bsec(?:tor)?\\s?${n}\\b`, "i");
    const cities = new Set(SECTOR_CITIES);
    // Delhi has sectors too (Rohini, Dwarka): add it if the dataset does.
    for (const info of Object.values(PINCODES)) if (info.areas.some((a) => re.test(a))) cities.add(cityOf(info));
    return {
      ...base,
      label: `Sector ${n}`,
      matchedBy: "ambiguous_sector",
      ambiguous: [...cities].map((city) => ({ label: `Sector ${n}, ${city}`, city })),
    };
  }

  if (cityNamed) {
    const city = cityNamed[1];
    // "Sector 50, Noida" keeps its city; "Gurgaon" alone becomes "Gurugram".
    const named = norm(label) === cityNamed[0] ? city : norm(label).includes(norm(city)) ? label : `${label}, ${city}`;
    return { ...base, label: named, serviceable: true, city, matchedBy: "city" };
  }
  for (const [loc, city] of Object.entries(LOCALITY_CITY)) {
    if (words.includes(` ${loc} `)) return { ...base, label, serviceable: true, city, matchedBy: "locality" };
  }
  // Post-office names, e.g. "Rohini", "Lajpat Nagar". Names under 4
  // letters are too ambiguous to match on.
  for (const info of Object.values(PINCODES)) {
    for (const a of info.areas) {
      const n = norm(cleanPostOffice(a));
      const head = n.split(" ")[0];
      if (
        (n.length >= 4 && (t === n || words.includes(` ${n} `))) ||
        // "Rohini" names "Rohini Sector 5" etc. (only sector-style names,
        // so "Meerut" doesn't match "Meerut Road Industrial Area").
        (head.length >= 5 && t === head && /^\S+ sec(tor)?\s?\d/.test(n))
      ) {
        return { ...base, label, serviceable: true, city: cityOf(info), pincode: null, matchedBy: "post_office" };
      }
    }
  }
  return base;
}

/**
 * Served areas nearest to an unserved pincode just outside the dataset
 * (pincodes are assigned by geography, so a near-identical number is a
 * neighbouring post office). Far-off pincodes return nothing — use
 * closestHubs for those.
 */
export function closestByPincode(pincode, limit = 3) {
  const p = Number(pincode);
  return Object.entries(PINCODES)
    .map(([code, info]) => ({ info, d: Math.abs(Number(code) - p) }))
    .filter(({ d }) => d <= 20)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ info }) => ({ label: cleanPostOffice(info.areas[0]), city: cityOf(info) }));
}

// Centre points of the cities Eventory serves.
const HUBS = [
  { label: "Delhi", lat: 28.6139, lon: 77.209 },
  { label: "Gurugram", lat: 28.4595, lon: 77.0266 },
  { label: "Noida", lat: 28.5355, lon: 77.391 },
  { label: "Greater Noida", lat: 28.4744, lon: 77.504 },
  { label: "Ghaziabad", lat: 28.6692, lon: 77.4538 },
  { label: "Faridabad", lat: 28.4089, lon: 77.3178 },
];

/** Served cities nearest to a point, closest first. */
export function closestHubs(lat, lon, limit = 3) {
  const rad = (d) => (d * Math.PI) / 180;
  const km = (h) => {
    const a =
      Math.sin(rad(h.lat - lat) / 2) ** 2 +
      Math.cos(rad(lat)) * Math.cos(rad(h.lat)) * Math.sin(rad(h.lon - lon) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  };
  return [...HUBS]
    .sort((a, b) => km(a) - km(b))
    .slice(0, limit)
    .map((h) => ({ label: h.label, city: h.label === "Greater Noida" ? "Noida" : h.label }));
}
