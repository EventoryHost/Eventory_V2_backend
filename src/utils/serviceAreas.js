/**
 * Vendor service areas are stored as `[{ area, sublocalities: [String] }]` —
 * one entry per area chip the vendor picked in onboarding ("Gurgaon",
 * "South Delhi"), with the localities they narrowed it to.
 *
 * Before 2026-10-07 they were a flat `[String]` mixing area and locality
 * chips. Old app builds still send that shape, so every write goes through
 * normalizeServiceAreas, which also groups legacy locality strings under the
 * area they belong to.
 */

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Legacy locality chips -> the area entry they are grouped under on migration.
const LEGACY_LOCALITY_AREA = {
  indirapuram: "Ghaziabad", vasundhara: "Ghaziabad", vaishali: "Ghaziabad", "raj nagar": "Ghaziabad",
  kaushambi: "Ghaziabad", "crossings republik": "Ghaziabad",
  "connaught place": "New Delhi", "lajpat nagar": "South Delhi", "hauz khas": "South Delhi", saket: "South Delhi",
  "sector 18": "Noida", "sector 62": "Noida", "sector 63": "Noida", "sector 137": "Noida", "sector 15": "Noida",
  "noida extension": "Greater Noida",
  "dlf phase 1": "Gurgaon", "sushant lok": "Gurgaon", "golf course road": "Gurgaon", "sohna road": "Gurgaon",
  "mg road": "Gurgaon", "sector 56": "Gurgaon", "sector 14": "Gurgaon",
};

// Legacy area spellings -> the area chip name the app uses now.
const AREA_RENAMES = { gurugram: "Gurgaon" };

const cleanList = (list) => {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const value = typeof raw === "string" ? raw.trim() : "";
    const key = norm(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
};

/** Any accepted input shape -> `[{ area, sublocalities }]`, merged by area name. */
export function normalizeServiceAreas(input) {
  if (!Array.isArray(input)) return [];
  const byArea = new Map();
  const entryFor = (rawArea) => {
    const area = AREA_RENAMES[norm(rawArea)] || rawArea.trim();
    const key = norm(area);
    if (!byArea.has(key)) byArea.set(key, { area, sublocalities: [] });
    return byArea.get(key);
  };

  for (const item of input) {
    if (typeof item === "string") {
      if (!norm(item)) continue;
      const parent = LEGACY_LOCALITY_AREA[norm(item)];
      if (parent) entryFor(parent).sublocalities.push(item);
      else entryFor(item);
    } else if (item && typeof item === "object" && norm(item.area)) {
      entryFor(String(item.area)).sublocalities.push(...(Array.isArray(item.sublocalities) ? item.sublocalities : []));
    }
  }

  return [...byArea.values()].map((e) => ({ area: e.area, sublocalities: cleanList(e.sublocalities) }));
}

/** Every area and locality name, flat — for text search and display. */
export function flattenServiceAreas(serviceAreas) {
  return normalizeServiceAreas(serviceAreas).flatMap((e) => [e.area, ...e.sublocalities]);
}

/** Mongo clauses matching a regex against areas and localities (plus legacy string arrays). */
export function serviceAreaRegexClauses(rx) {
  return [{ "serviceAreas.area": rx }, { "serviceAreas.sublocalities": rx }, { serviceAreas: rx }];
}

/** A stored item: the new `{ area, sublocalities }` or a legacy string. */
export function isServiceAreaItem(item) {
  if (typeof item === "string") return true;
  return (
    !!item &&
    typeof item.area === "string" &&
    (item.sublocalities === undefined ||
      (Array.isArray(item.sublocalities) && item.sublocalities.every((s) => typeof s === "string")))
  );
}

/** True while the vendor still has the pre-2026-10-07 flat `[String]` shape. */
export function hasLegacyServiceAreas(serviceAreas) {
  return Array.isArray(serviceAreas) && serviceAreas.some((item) => typeof item === "string");
}
