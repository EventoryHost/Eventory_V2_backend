import fs from "fs";

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
 *     "What is your Service area?" — city chips plus locality chips, plain
 *     strings). There is no pincode/radius data on the vendor side, so a
 *     vendor area is matched to a pincode by NAME: a city chip covers every
 *     pincode in that city; a locality chip covers pincodes whose
 *     post-office/area names contain it (e.g. "Sector 18" -> "Sector 18
 *     Noida"). A vendor with NO serviceAreas declared has stated no
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

// Vendor UI has "South Delhi"/"North Delhi" chips — map them to the Delhi
// districts in the dataset.
const DELHI_REGION_CHIPS = {
  "south delhi": ["SOUTH", "SOUTH EAST", "SOUTH WEST"],
  "north delhi": ["NORTH", "NORTH WEST", "NORTH EAST"],
};

export function extractPincode(text) {
  const m = String(text || "").match(/(?<!\d)(\d{6})(?!\d)/);
  return m ? m[1] : null;
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
  const a = norm(vendorArea);
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
  const declared = (vendorServiceAreas || []).filter(Boolean);
  if (declared.length === 0) {
    return { platformServiceable: true, vendorServiceable: true, serviceable: true, reason: null, basis: "NO_AREAS_DECLARED", location };
  }
  const levels = declared.map((a) => areaMatchLevel(a, info)).filter(Boolean);
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

// For the "vendor provides service at" list: keep the vendor's own strings,
// split into cities (chips that name a platform city) and localities.
const CITY_NAMES = new Set(["delhi", "gurugram", "faridabad", "ghaziabad", "noida"]);
export function describeVendorAreas(serviceAreas) {
  const all = (serviceAreas || []).filter(Boolean);
  const cities = all.filter((a) => CITY_NAMES.has(norm(a)));
  return { all, cities, localities: all.filter((a) => !CITY_NAMES.has(norm(a))) };
}
