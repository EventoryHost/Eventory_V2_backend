import { round2 } from "../utils/money.js";

/**
 * CUSTOMER CONVENIENCE FEE — added 2026-09-10.
 *
 * A platform fee charged to the CUSTOMER (not the vendor), computed PER
 * VENDOR LINE and summed into the order total. Shown on the PDP, cart,
 * checkout, and the booking's payment-summary.
 *
 * Built from three data tables the user supplied (Eventory_S3_Data_*.pdf) —
 * transcribed here verbatim, NOT re-derived. All three are lookup tables;
 * the ONLY thing not in any of them is the final arithmetic that combines
 * their outputs, which the user explicitly confirmed:
 *
 *     lineConvenienceFee = baseFee + (linePrice * percentage/100 * weight)
 *
 *   - baseFee     : CATEGORY_FEE_TABLE, by (criticality, category)          [File 2]
 *   - percentage  : FEE_TABLE[category][priceSlab][daysBucket]              [File 1]
 *   - weight      : FEE_TABLE[category][priceSlab].weight                   [File 1]
 *   - category    : from a 3–15 vendor score + the service's criticality    [File 2 + 3]
 *   - vendorScore : sum of 3 sub-scores (bookings/yr, years, team size)     [File 3]
 *
 * ----------------------------------------------------------------------------
 * ASSUMPTIONS made where the tables are silent — all flagged to the user,
 * all isolated so they're one-line changes:
 *
 *   1. linePrice = the line's PRE-GST subtotal (package base + team &
 *      equipment + add-ons + chargeable items). Convenience % is applied to
 *      the pre-tax amount, not tax-inclusive.
 *   2. The convenience fee itself is added to grandTotal AFTER gst and is
 *      NOT itself taxed. (Real GST question for finance.)
 *   3. Price >= 300000 clamps to the top slab (250k–300k row).
 *   4. Day buckets (daysLeft = whole days from "now" to the event date):
 *        >= 25        -> 25_plus_days
 *        18..24       -> 18_25_days
 *        13..17       -> 13_18_days
 *        8..12        -> 8_12_days
 *        4..7         -> 4_7_days
 *        1..3         -> 1_3_days
 *        <= 0         -> event_day
 *   5. A vendor sub-attribute that is missing or unparseable is scored as 3
 *      (the 1–5 midpoint) rather than zeroing the whole fee — the user asked
 *      for this live and added to totals, and most real vendors are missing
 *      teamSize today. `estimatedScore: true` flags when this happened.
 *   6. No event date on the line (a cart item added before a date is set)
 *      -> the fee genuinely cannot be computed; that line's fee is null and
 *      `configured: false`, contributing 0 to the total, until a date is set.
 * ----------------------------------------------------------------------------
 */

// ── File 2: service_type -> criticality (which CAT band applies) ──────────
// The customer-facing vendorType enum (Caterer/Decorator/PAV/DJArtist/
// MakeupArtist/VenueProvider) mapped to File 2's service_type labels.
const SERVICE_TYPE = {
  PAV: { label: "Photographer", critical: true },
  VenueProvider: { label: "Venue", critical: true },
  Caterer: { label: "Caterer", critical: true },
  Decorator: { label: "Decorator", critical: true },
  MakeupArtist: { label: "Makeup", critical: false },
  DJArtist: { label: "DJ", critical: false },
};

// ── File 2: (criticality, scoreBand) -> category + base flat fee ──────────
// scoreBand: 3–6 -> low tier, 7–9 -> mid, 10–15 -> top.
const CATEGORY_FEE = {
  critical: {
    top: { category: "CAT_1", baseFee: 599 }, // score 10–15
    mid: { category: "CAT_2", baseFee: 499 }, // score 7–9
    low: { category: "CAT_3", baseFee: 399 }, // score 3–6
  },
  nonCritical: {
    top: { category: "CAT_4", baseFee: 299 },
    mid: { category: "CAT_5", baseFee: 199 },
    low: { category: "CAT_6", baseFee: 99 },
  },
};

// ── File 3: vendor score = sum of 3 sub-scores (each 1–5) ─────────────────
// Each entry is [lowerBoundThreshold, subScore], highest threshold <= value
// wins. NOTE the inverse direction: a bigger / more established vendor
// scores LOWER (down to 1); a small / new vendor scores HIGHER (up to 5).
// Total 3–15 then feeds File 2's score bands.
const SUBSCORE_THRESHOLDS = {
  bookingsPerYear: [
    [0, 5],
    [25, 4],
    [50, 3],
    [75, 2],
    [100, 1],
  ],
  yearsOfOperation: [
    [0, 5],
    [3, 4],
    [7, 3],
    [10, 2],
    [15, 1],
  ],
  teamSize: [
    [1, 5],
    [6, 4],
    [16, 3],
    [31, 2],
    [50, 1],
  ],
};
const MISSING_SUBSCORE = 3; // assumption #5

// ── File 1: price slabs (lower bound, upper bound inclusive) ──────────────
const PRICE_SLABS = [
  { key: "0-15k", ll: 0, ul: 14999 },
  { key: "15k-30k", ll: 15000, ul: 29999 },
  { key: "30k-50k", ll: 30000, ul: 49999 },
  { key: "50k-75k", ll: 50000, ul: 74999 },
  { key: "75k-100k", ll: 75000, ul: 99999 },
  { key: "100k-125k", ll: 100000, ul: 124999 },
  { key: "125k-150k", ll: 125000, ul: 149999 },
  { key: "150k-175k", ll: 150000, ul: 174999 },
  { key: "175k-200k", ll: 175000, ul: 199999 },
  { key: "200k-250k", ll: 200000, ul: 249999 },
  { key: "250k-300k", ll: 250000, ul: 299999 },
];

// Day-bucket order matches the 7 percentage columns in File 1.
const DAY_BUCKETS = ["25_plus_days", "18_25_days", "13_18_days", "8_12_days", "4_7_days", "1_3_days", "event_day"];

// ── File 1: FEE_TABLE[category][priceSlabKey] = { pct: [7 values], weight } ─
// pct array is indexed by DAY_BUCKETS above. Transcribed verbatim from
// Eventory_S3_Data_customer_convenience_fees.pdf.
const FEE_TABLE = {
  CAT_1: {
    "0-15k": { pct: [0.75, 1.75, 2.75, 3.75, 4.75, 5.75, 6.75], weight: 1.4 },
    "15k-30k": { pct: [1.25, 2.25, 3.25, 4.25, 5.25, 6.25, 7.25], weight: 1.38 },
    "30k-50k": { pct: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5], weight: 1.36 },
    "50k-75k": { pct: [2, 3, 4, 5, 6, 7, 8], weight: 1.34 },
    "75k-100k": { pct: [2.25, 3.25, 4.25, 5.25, 6.25, 7.25, 8.25], weight: 1.32 },
    "100k-125k": { pct: [2.75, 3.75, 4.75, 5.75, 6.75, 7.75, 8.75], weight: 1.3 },
    "125k-150k": { pct: [3, 4, 5, 6, 7, 8, 9], weight: 1.28 },
    "150k-175k": { pct: [3, 4, 5, 6, 7, 8, 9], weight: 1.26 },
    "175k-200k": { pct: [3.25, 4.25, 5.25, 6.25, 7.25, 8.25, 9.25], weight: 1.24 },
    "200k-250k": { pct: [3.75, 4.75, 5.75, 6.75, 7.75, 8.75, 9.75], weight: 1.22 },
    "250k-300k": { pct: [4, 5, 6, 7, 8, 9, 10], weight: 1.2 },
  },
  CAT_2: {
    "0-15k": { pct: [0.95, 1.95, 2.95, 3.95, 4.95, 5.95, 6.95], weight: 1.25 },
    "15k-30k": { pct: [1.45, 2.45, 3.45, 4.45, 5.45, 6.45, 7.45], weight: 1.23 },
    "30k-50k": { pct: [1.7, 2.7, 3.7, 4.7, 5.7, 6.7, 7.7], weight: 1.21 },
    "50k-75k": { pct: [2.2, 3.2, 4.2, 5.2, 6.2, 7.2, 8.2], weight: 1.19 },
    "75k-100k": { pct: [2.45, 3.45, 4.45, 5.45, 6.45, 7.45, 8.45], weight: 1.17 },
    "100k-125k": { pct: [2.95, 3.95, 4.95, 5.95, 6.95, 7.95, 8.95], weight: 1.15 },
    "125k-150k": { pct: [3.2, 4.2, 5.2, 6.2, 7.2, 8.2, 9.2], weight: 1.13 },
    "150k-175k": { pct: [3.2, 4.2, 5.2, 6.2, 7.2, 8.2, 9.2], weight: 1.09 },
    "175k-200k": { pct: [3.45, 4.45, 5.45, 6.45, 7.45, 8.45, 9.45], weight: 1.07 },
    "200k-250k": { pct: [3.95, 4.95, 5.95, 6.95, 7.95, 8.95, 9.95], weight: 1.05 },
    "250k-300k": { pct: [4.2, 5.2, 6.2, 7.2, 8.2, 9.2, 10.2], weight: 1.03 },
  },
  CAT_3: {
    "0-15k": { pct: [1.15, 2.15, 3.15, 4.15, 5.15, 6.15, 7.15], weight: 1.1 },
    "15k-30k": { pct: [1.65, 2.65, 3.65, 4.65, 5.65, 6.65, 7.65], weight: 1.08 },
    "30k-50k": { pct: [1.9, 2.9, 3.9, 4.9, 5.9, 6.9, 7.9], weight: 1.06 },
    "50k-75k": { pct: [2.4, 3.4, 4.4, 5.4, 6.4, 7.4, 8.4], weight: 1.04 },
    "75k-100k": { pct: [2.65, 3.65, 4.65, 5.65, 6.65, 7.65, 8.65], weight: 1.02 },
    "100k-125k": { pct: [3.15, 4.15, 5.15, 6.15, 7.15, 8.15, 9.15], weight: 1 },
    "125k-150k": { pct: [3.4, 4.4, 5.4, 6.4, 7.4, 8.4, 9.4], weight: 0.98 },
    "150k-175k": { pct: [3.4, 4.4, 5.4, 6.4, 7.4, 8.4, 9.4], weight: 0.96 },
    "175k-200k": { pct: [3.65, 4.65, 5.65, 6.65, 7.65, 8.65, 9.65], weight: 0.94 },
    "200k-250k": { pct: [4.15, 5.15, 6.15, 7.15, 8.15, 9.15, 10.15], weight: 0.92 },
    "250k-300k": { pct: [4.4, 5.4, 6.4, 7.4, 8.4, 9.4, 10.4], weight: 0.9 },
  },
  CAT_4: {
    "0-15k": { pct: [1.35, 2.35, 3.35, 4.35, 5.35, 6.35, 7.35], weight: 1 },
    "15k-30k": { pct: [1.85, 2.85, 3.85, 4.85, 5.85, 6.85, 7.85], weight: 0.98 },
    "30k-50k": { pct: [2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1], weight: 0.96 },
    "50k-75k": { pct: [2.6, 3.6, 4.6, 5.6, 6.6, 7.6, 8.6], weight: 0.94 },
    "75k-100k": { pct: [2.85, 3.85, 4.85, 5.85, 6.85, 7.85, 8.85], weight: 0.92 },
    "100k-125k": { pct: [3.35, 4.35, 5.35, 6.35, 7.35, 8.35, 9.35], weight: 0.9 },
    "125k-150k": { pct: [3.6, 4.6, 5.6, 6.6, 7.6, 8.6, 9.6], weight: 0.88 },
    "150k-175k": { pct: [3.6, 4.6, 5.6, 6.6, 7.6, 8.6, 9.6], weight: 0.86 },
    "175k-200k": { pct: [3.85, 4.85, 5.85, 6.85, 7.85, 8.85, 9.85], weight: 0.84 },
    "200k-250k": { pct: [4.35, 5.35, 6.35, 7.35, 8.35, 9.35, 10.35], weight: 0.82 },
    "250k-300k": { pct: [4.6, 5.6, 6.6, 7.6, 8.6, 9.6, 10.6], weight: 0.8 },
  },
  CAT_5: {
    "0-15k": { pct: [1.55, 2.55, 3.55, 4.55, 5.55, 6.55, 7.55], weight: 0.9 },
    "15k-30k": { pct: [2.05, 3.05, 4.05, 5.05, 6.05, 7.05, 8.05], weight: 0.88 },
    "30k-50k": { pct: [2.3, 3.3, 4.3, 5.3, 6.3, 7.3, 8.3], weight: 0.86 },
    "50k-75k": { pct: [2.8, 3.8, 4.8, 5.8, 6.8, 7.8, 8.8], weight: 0.84 },
    "75k-100k": { pct: [3.05, 4.05, 5.05, 6.05, 7.05, 8.05, 9.05], weight: 0.82 },
    "100k-125k": { pct: [3.55, 4.55, 5.55, 6.55, 7.55, 8.55, 9.55], weight: 0.8 },
    "125k-150k": { pct: [3.8, 4.8, 5.8, 6.8, 7.8, 8.8, 9.8], weight: 0.78 },
    "150k-175k": { pct: [3.8, 4.8, 5.8, 6.8, 7.8, 8.8, 9.8], weight: 0.76 },
    "175k-200k": { pct: [4.05, 5.05, 6.05, 7.05, 8.05, 9.05, 10.05], weight: 0.74 },
    "200k-250k": { pct: [4.55, 5.55, 6.55, 7.55, 8.55, 9.55, 10.55], weight: 0.72 },
    "250k-300k": { pct: [4.8, 5.8, 6.8, 7.8, 8.8, 9.8, 10.8], weight: 0.7 },
  },
  CAT_6: {
    "0-15k": { pct: [1.75, 2.75, 3.75, 4.75, 5.75, 6.75, 7.75], weight: 0.8 },
    "15k-30k": { pct: [2.25, 3.25, 4.25, 5.25, 6.25, 7.25, 8.25], weight: 0.78 },
    "30k-50k": { pct: [2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5], weight: 0.76 },
    "50k-75k": { pct: [3, 4, 5, 6, 7, 8, 9], weight: 0.74 },
    "75k-100k": { pct: [3.25, 4.25, 5.25, 6.25, 7.25, 8.25, 9.25], weight: 0.72 },
    "100k-125k": { pct: [3.75, 4.75, 5.75, 6.75, 7.75, 8.75, 9.75], weight: 0.7 },
    "125k-150k": { pct: [4, 5, 6, 7, 8, 9, 10], weight: 0.68 },
    "150k-175k": { pct: [4, 5, 6, 7, 8, 9, 10], weight: 0.66 },
    "175k-200k": { pct: [4.25, 5.25, 6.25, 7.25, 8.25, 9.25, 10.25], weight: 0.64 },
    "200k-250k": { pct: [4.75, 5.75, 6.75, 7.75, 8.75, 9.75, 10.75], weight: 0.62 },
    "250k-300k": { pct: [5, 6, 7, 8, 9, 10, 11], weight: 0.6 },
  },
};

// ── Parsing helpers ─────────────────────────────────────────────────────

// Vendor.teamSize / bookingsPerYear / experience are free-text dropdown
// values ("6 - 15 people", "100+ booking/year", "11 - 15 years",
// "12+ years"). Parse the LEADING integer — the lower bound of the chosen
// range — and bucket THAT via SUBSCORE_THRESHOLDS. Returns null when
// nothing parses.
function parseLeadingInt(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/-?\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

function subScoreFor(attr, rawValue) {
  const n = parseLeadingInt(rawValue);
  if (n == null) return { score: MISSING_SUBSCORE, parsed: null, estimated: true };
  const thresholds = SUBSCORE_THRESHOLDS[attr];
  let score = thresholds[0][1];
  for (const [threshold, s] of thresholds) {
    if (n >= threshold) score = s;
  }
  return { score, parsed: n, estimated: false };
}

/**
 * @param {{ bookingsPerYear?: string, experience?: string, teamSize?: string }} vendor
 * @returns {{ total: number, estimatedScore: boolean, subScores: object }}
 */
export function computeVendorScore(vendor = {}) {
  const b = subScoreFor("bookingsPerYear", vendor.bookingsPerYear);
  const y = subScoreFor("yearsOfOperation", vendor.experience);
  const t = subScoreFor("teamSize", vendor.teamSize);
  return {
    total: b.score + y.score + t.score, // 3..15
    estimatedScore: b.estimated || y.estimated || t.estimated,
    subScores: { bookingsPerYear: b, yearsOfOperation: y, teamSize: t },
  };
}

function scoreBand(total) {
  if (total >= 10) return "top";
  if (total >= 7) return "mid";
  return "low"; // 3..6 (and any lower, defensively)
}

/**
 * @returns {{ category: string, baseFee: number, serviceLabel: string, critical: boolean } | null}
 *   null when vendorType isn't one of the 6 known service types.
 */
export function resolveCategory(vendorType, vendorScoreTotal) {
  const svc = SERVICE_TYPE[vendorType];
  if (!svc) return null;
  const band = scoreBand(vendorScoreTotal);
  const entry = svc.critical ? CATEGORY_FEE.critical[band] : CATEGORY_FEE.nonCritical[band];
  return { category: entry.category, baseFee: entry.baseFee, serviceLabel: svc.label, critical: svc.critical };
}

function resolvePriceSlab(price) {
  const p = Math.max(0, Math.round(price || 0));
  for (const slab of PRICE_SLABS) {
    if (p >= slab.ll && p <= slab.ul) return slab.key;
  }
  // Assumption #3: anything above the top slab clamps to it.
  return PRICE_SLABS[PRICE_SLABS.length - 1].key;
}

/**
 * Whole days from now to the event. Returns null when eventDate is missing
 * or unparseable (assumption #6 — the fee then can't be computed).
 */
export function daysUntilEvent(eventDate, now = new Date()) {
  if (!eventDate) return null;
  const d = new Date(eventDate);
  if (isNaN(d.getTime())) return null;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.floor((d.getTime() - now.getTime()) / MS_PER_DAY);
}

function resolveDayBucket(daysLeft) {
  if (daysLeft == null) return null;
  if (daysLeft >= 25) return "25_plus_days";
  if (daysLeft >= 18) return "18_25_days";
  if (daysLeft >= 13) return "13_18_days";
  if (daysLeft >= 8) return "8_12_days";
  if (daysLeft >= 4) return "4_7_days";
  if (daysLeft >= 1) return "1_3_days";
  return "event_day";
}

/**
 * The whole calculation for one vendor line.
 *
 * @param {object} args
 * @param {string} args.vendorType   - customer-facing vendorType enum
 * @param {object} args.vendor       - Vendor doc/lean (bookingsPerYear, experience, teamSize)
 * @param {number} args.linePrice    - the line's PRE-GST subtotal (assumption #1)
 * @param {Date|string|null} args.eventDate
 * @param {Date} [args.now]
 * @returns {{
 *   configured: boolean,
 *   fee: number|null,
 *   reason: string|null,
 *   breakdown: object|null
 * }}
 */
export function computeLineConvenienceFee({ vendorType, vendor, linePrice, eventDate, now = new Date() }) {
  const score = computeVendorScore(vendor || {});
  const cat = resolveCategory(vendorType, score.total);
  if (!cat) {
    return { configured: false, fee: null, reason: `Unknown service type "${vendorType}" — no convenience-fee category`, breakdown: null };
  }

  const daysLeft = daysUntilEvent(eventDate, now);
  const dayBucket = resolveDayBucket(daysLeft);
  if (!dayBucket) {
    return {
      configured: false,
      fee: null,
      reason: "No event date on this line yet — convenience fee is calculated once the event date is set",
      breakdown: { category: cat.category, baseFee: cat.baseFee, vendorScore: score.total, estimatedScore: score.estimatedScore },
    };
  }

  const priceSlab = resolvePriceSlab(linePrice);
  const cell = FEE_TABLE[cat.category][priceSlab];
  const bucketIndex = DAY_BUCKETS.indexOf(dayBucket);
  const percentage = cell.pct[bucketIndex];
  const weight = cell.weight;

  // The one formula the user confirmed:
  const variablePart = round2(((linePrice || 0) * percentage) / 100 * weight);
  const fee = round2(cat.baseFee + variablePart);

  return {
    configured: true,
    fee,
    reason: null,
    breakdown: {
      vendorScore: score.total,
      estimatedScore: score.estimatedScore,
      subScores: score.subScores,
      serviceLabel: cat.serviceLabel,
      critical: cat.critical,
      category: cat.category,
      baseFee: cat.baseFee,
      priceSlab,
      daysLeft,
      dayBucket,
      percentage,
      weight,
      linePrice: round2(linePrice || 0),
      variablePart,
      formula: "baseFee + linePrice * percentage/100 * weight",
    },
  };
}

export default computeLineConvenienceFee;
