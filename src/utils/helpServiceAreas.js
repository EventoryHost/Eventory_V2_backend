import fs from "fs";
import { extractPincode, lookupPincode } from "./serviceability.js";

/**
 * Help panel location check ("Do you serve my area?", Figma "09 —
 * Location"). The served areas are src/data/ncrServiceAreas.csv — the list
 * the product owner gave as every serviceable area (area, locality,
 * pincode, source). Replace that file to change coverage; nothing else
 * needs editing. Not every locality has a pincode, so names are matched
 * first and pincodes second. The vendor-level PDP check
 * (serviceability.js) still uses serviceablePincodes.json.
 */

// The CSV's area column -> the city the package search filters on.
const REGION_CITY = {
  Gurgaon: "Gurugram",
  Faridabad: "Faridabad",
  Ghaziabad: "Ghaziabad",
  Noida: "Noida",
  "Greater Noida": "Noida",
  "Central Delhi": "Delhi",
  "South Delhi": "Delhi",
  "Old Delhi": "Delhi",
  "New Delhi": "Delhi",
};

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function readCsv() {
  const lines = fs
    .readFileSync(new URL("../data/ncrServiceAreas.csv", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const header = lines.shift().split(",").map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  return lines.map((line) => {
    // Plain CSV; quoted fields are unquoted so a "Sector 9, Faridabad" row still reads.
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim());
    return { region: cells[col("area")], locality: cells[col("locality")], pincode: cells[col("pincode")] || null };
  });
}

/** "Sector 14" in Gurgaon, "Noida Sector 62", "Greater Faridabad (Sectors 75-89)". */
function sectorsOf(locality) {
  const n = norm(locality.replace(/\(.*?\)/g, (m) => ` ${m} `));
  const range = n.match(/sectors? (\d{1,3}) (\d{1,3})/);
  if (range) {
    const out = [];
    for (let i = Number(range[1]); i <= Number(range[2]); i += 1) out.push(i);
    return out;
  }
  const one = n.match(/^(?:noida )?sector (\d{1,3})\b/);
  return one ? [Number(one[1])] : [];
}

/** Names a customer might type for a CSV locality. */
function aliasesOf(locality) {
  const out = new Set();
  const add = (s) => {
    const n = norm(s);
    if (n.length >= 4) out.add(n);
  };
  const inParens = [...locality.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  const bare = locality.replace(/\(.*?\)/g, "").trim();
  add(bare);
  // "Greater Kailash II" / "South City 1" are also just "Greater Kailash".
  add(bare.replace(/\s+(i{1,3}|[1-3])(\s*(&|-)\s*\d)?$/i, ""));
  // "DLF Cyber City" is "Cyber City" (not "Phase 1", too vague alone).
  if (/^dlf (?!phase)/i.test(bare)) add(bare.replace(/^dlf /i, ""));
  inParens.filter((p) => !/sectors?\s*\d/i.test(p)).forEach(add);
  // "Techzone / Ecotech"
  bare.split("/").forEach(add);
  // Greater Noida's "Alpha 1 & 2", "Delta 1-3", "Chi sectors": the bare
  // name, plus numbered ones for names too short to match alone ("Chi 2").
  const greek = bare.match(/^(alpha|beta|gamma|delta|omega|sigma|zeta|chi)\b/i);
  if (greek) {
    const g = norm(greek[1]);
    add(g);
    for (let i = 1; i <= 5; i += 1) add(`${g} ${i}`);
    add(`${g} sector`);
  }
  // Sectors ("Sector 15", "Noida Sector 18") are matched separately, so
  // "Sector 15" alone can ask which city.
  return [...out].filter((a) => !/^(noida )?sectors? \d/.test(a));
}

const ROWS = readCsv().filter((r) => r.region && r.locality && REGION_CITY[r.region]);

const LOCALITIES = ROWS.map((r) => ({
  ...r,
  city: REGION_CITY[r.region],
  aliases: aliasesOf(r.locality),
  sectors: sectorsOf(r.locality),
}));

const PINCODES = new Map();
for (const l of LOCALITIES) if (l.pincode && !PINCODES.has(l.pincode)) PINCODES.set(l.pincode, l);

/** "Noida Sector 62" -> "Sector 62, Noida"; "Saket" -> "Saket, South Delhi". */
function labelOf(l) {
  const name = l.locality.replace(/\s*\(.*?\)/g, "").trim();
  if (/^Noida Sector/.test(name)) return `${name.replace(/^Noida /, "")}, Noida`;
  return norm(name).includes(norm(l.region)) ? name : `${name}, ${l.region}`;
}

// City names and spellings in free text and location tags.
const CITY_NAMES = [
  ["greater noida", "Noida", "Greater Noida"],
  ["noida extension", "Noida", "Greater Noida"],
  ["new delhi", "Delhi", "New Delhi"],
  // Districts before the words inside them ("North West Delhi" isn't "West Delhi").
  ["north west delhi", "Delhi", "North West Delhi"],
  ["south west delhi", "Delhi", "South West Delhi"],
  ["north east delhi", "Delhi", "North East Delhi"],
  ["south east delhi", "Delhi", "South East Delhi"],
  ["south delhi", "Delhi", "South Delhi"],
  ["central delhi", "Delhi", "Central Delhi"],
  ["old delhi", "Delhi", "Old Delhi"],
  ["north delhi", "Delhi", "North Delhi"],
  ["east delhi", "Delhi", "East Delhi"],
  ["west delhi", "Delhi", "West Delhi"],
  ["delhi ncr", "Delhi", "Delhi NCR"],
  ["delhi", "Delhi", "Delhi"],
  ["ncr", "Delhi", "Delhi NCR"],
  ["gurugram", "Gurugram", "Gurugram"],
  ["gurgaon", "Gurugram", "Gurugram"],
  ["noida", "Noida", "Noida"],
  ["ghaziabad", "Ghaziabad", "Ghaziabad"],
  ["faridabad", "Faridabad", "Faridabad"],
];
const SECTOR_REGIONS = { Noida: "Noida", Gurugram: "Gurgaon", Faridabad: "Faridabad" };

// Delhi NCR post offices (serviceablePincodes.json): only to tell which
// city an unlisted place is in ("Rohini" -> Delhi), never whether it's served.
const POST_OFFICES = Object.values(
  JSON.parse(fs.readFileSync(new URL("../data/serviceablePincodes.json", import.meta.url), "utf8"))
).flatMap((info) =>
  info.areas.map((a) => ({
    name: norm(String(a).replace(/\b(S\.?O|H\.?O|B\.?O|EXTN COUNTER|EXTENSION COUNTER)\b\.?/gi, "")),
    city:
      info.state === "DELHI"
        ? "Delhi"
        : { GURUGRAM: "Gurugram", FARIDABAD: "Faridabad", GHAZIABAD: "Ghaziabad", "GAUTAM BUDDHA NAGAR": "Noida" }[info.district] ?? null,
  }))
);
const cityOfPlace = (place) => {
  const n = norm(place);
  if (n.length < 4) return null;
  // "Rohini" names "Rohini Sector 5", but "Meerut" isn't "Meerut Road Industrial Area".
  return POST_OFFICES.find((p) => p.name === n || new RegExp(`^${n} sec(tor)? ?\\d`).test(p.name))?.city ?? null;
};

// Clearly outside NCR: a non-NCR pincode, or a state other than Delhi /
// Haryana / UP ("Malviya Nagar, Jaipur, Rajasthan" isn't Delhi's Malviya Nagar).
const NCR_PIN = /^(110|121|122|201|203)/;
const OTHER_STATES =
  /\b(rajasthan|punjab|maharashtra|karnataka|gujarat|tamil nadu|kerala|telangana|andhra pradesh|west bengal|bihar|madhya pradesh|uttarakhand|himachal pradesh|jammu|kashmir|chandigarh|goa|odisha|assam|jharkhand|chhattisgarh|ladakh|sikkim|tripura|meghalaya|manipur|mizoram|nagaland|arunachal pradesh|puducherry)\b/i;

const hasWords = (text, phrase) => ` ${text} `.includes(` ${phrase} `);
const cityIn = (t) => CITY_NAMES.find(([name]) => hasWords(t, name));

const parts = (raw) => raw.split(",").map((p) => p.trim()).filter(Boolean);
// Address noise in a location tag: "Ward 12", "Block A", "H No 4".
const NOISE = /^(ward|block|pocket|house|h ?no|plot|flat|tower|gali|lane|street|road no)\b|^\d/i;

/** The most specific place in what was given: "Ward 12, Rohini, North West Delhi, 110085" -> "Rohini". */
function firstPart(raw) {
  const ps = parts(raw).filter((p) => !/^\d{6}$/.test(p));
  const part = ps.find((p) => !NOISE.test(p)) ?? ps[0];
  return part ? part.replace(/\s*\d{6}$/, "").trim() : raw;
}

/** The part of a location tag that names the sector ("Sector 62"), else the first part. */
function placeLabel(raw) {
  const sector = parts(raw).find((p) => /\bsector\s?\d/i.test(p));
  return sector ?? firstPart(raw);
}

/**
 * Served areas in a city, for the "Closest areas we cover" chips. The CSV
 * has no coordinates, so: its first locality in each of the city's regions
 * (Delhi: Central, South, Old, New Delhi), then the next ones.
 */
export function servedInCity(city, limit = 3) {
  const rows = LOCALITIES.filter((l) => l.city === city);
  const leads = rows.filter((l, i) => rows.findIndex((r) => r.region === l.region) === i);
  const ordered = [...new Set([...leads, ...rows])];
  return ordered.slice(0, limit).map((l) => ({ label: labelOf(l), city: l.city }));
}

/**
 * Where is this free-text area, and do we serve it?
 *  1. A CSV locality named in the text (agreeing with any city named).
 *  2. "Sector N": served where the CSV lists it; "Sector 15" alone is
 *     ambiguous between the cities that have one.
 *  3. A pincode: served if a CSV locality carries it.
 *  4. A city on its own ("Gurgaon"): served — we cover parts of it.
 *  Anything else is not on the list, so not served.
 */
export function resolveArea(text) {
  const raw = String(text || "").trim();
  const base = { input: raw, label: raw, serviceable: false, city: null, pincode: null, matchedBy: null, ambiguous: [] };
  if (!raw) return base;

  const t = norm(raw);
  const pin = extractPincode(raw);
  if ((pin && !NCR_PIN.test(pin)) || OTHER_STATES.test(raw)) {
    // "Malviya Nagar, Jaipur" — the place and its city.
    const ps = parts(raw).filter((p) => !/^\d{6}$/.test(p) && !NOISE.test(p));
    const label = [...new Set(ps.slice(0, 2))].join(", ") || raw;
    return { ...base, label, pincode: pin, matchedBy: "outside_ncr" };
  }
  const named = cityIn(t);
  const cityOk = (l) => !named || named[1] === l.city;

  // The earliest part of a location tag wins ("Saket, Malviya Nagar
  // Tehsil, ..." is Saket), then the longest name ("Greater Kailash II").
  const ps = parts(raw).map(norm);
  let best = null;
  for (const l of LOCALITIES) {
    if (!cityOk(l)) continue;
    for (const a of l.aliases) {
      const at = ps.findIndex((p) => hasWords(p, a));
      if (at < 0) continue;
      if (!best || at < best.at || (at === best.at && a.length > best.alias.length)) best = { l, alias: a, at };
    }
  }
  if (best) {
    return { ...base, label: labelOf(best.l), serviceable: true, city: best.l.city, pincode: best.l.pincode ?? pin, matchedBy: "locality" };
  }

  const sector = t.match(/\bsec(?:tor)?\s?(\d{1,3})\b/);
  if (sector) {
    const n = Number(sector[1]);
    const cities = named
      ? [named[1]]
      : Object.keys(SECTOR_REGIONS).filter((c) => LOCALITIES.some((l) => l.city === c && l.sectors.includes(n)));
    const served = cities.filter((c) => LOCALITIES.some((l) => l.city === c && l.sectors.includes(n)));
    if (!named && served.length > 1) {
      return {
        ...base,
        label: `Sector ${n}`,
        matchedBy: "ambiguous_sector",
        ambiguous: served.map((city) => ({ label: `Sector ${n}, ${city}`, city })),
      };
    }
    const city = served[0] ?? named?.[1] ?? null;
    // A location tag's "Sector 17, Rohini, North West Delhi": the locality, not the district.
    const ps = parts(raw);
    const next = ps[ps.findIndex((p) => /\bsec(tor)?\s?\d/i.test(p)) + 1];
    const where =
      next && !cityIn(norm(next)) && !/\d/.test(next) && !/pradesh|haryana|^delhi$/i.test(next)
        ? next
        : named?.[2] && named[1] === city
          ? named[2]
          : city;
    const label = where ? `Sector ${n}, ${where}` : `Sector ${n}`;
    return { ...base, label, serviceable: served.length > 0, city, pincode: pin, matchedBy: "sector" };
  }

  if (pin) {
    const hit = PINCODES.get(pin);
    if (hit) return { ...base, label: placeLabel(raw) === pin ? labelOf(hit) : placeLabel(raw), serviceable: true, city: hit.city, pincode: pin, matchedBy: "pincode" };
    const old = lookupPincode(pin);
    const label = /^\d{6}$/.test(raw) && old ? old.areas[0].replace(/\b(S\.?O|H\.?O|B\.?O)\b\.?/gi, "").trim() : placeLabel(raw);
    return { ...base, label, city: old?.city ?? named?.[1] ?? null, pincode: pin, matchedBy: "pincode" };
  }

  if (named && norm(firstPart(raw)) === named[0]) {
    return { ...base, label: named[2], serviceable: true, city: named[1], matchedBy: "city" };
  }
  const label = placeLabel(raw);
  const city = named?.[1] ?? cityOfPlace(label);
  return { ...base, label, city, matchedBy: city ? "outside_list" : null };
}

/**
 * Served areas to offer for an unserved one: in the same city when it's
 * one we're in ("Rohini" -> Delhi localities), else nothing — the caller
 * then ranks the cities by distance (closestHubs).
 */
export function closestServed(area) {
  return area.city ? servedInCity(area.city) : [];
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

/** Served cities nearest to a point, closest first, with distances in km. */
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
    .map((h) => ({ label: h.label, city: h.label === "Greater Noida" ? "Noida" : h.label, km: Math.round(km(h)) }));
}
