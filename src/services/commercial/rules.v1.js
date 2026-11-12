/**
 * COMMERCIAL ENGINE RULES — v1 (Eventory V2 Commercial Engine PRD v1.0,
 * Phase-1 frozen baseline, 07 Sep 2026).
 *
 * Every rate/threshold the engine uses lives here, transcribed from the PRD
 * tables. The engine modules never hard-code a number; they read it from the
 * rule set passed in, so a future DB-backed rule set (CommercialRuleSet) can
 * replace this file without touching the maths.
 *
 * Band/bucket tables are ordered lists of { min, ... } with INCLUSIVE lower
 * bounds: a value belongs to the last row whose `min` it reaches.
 *
 * ----------------------------------------------------------------------------
 * Values the PRD does NOT give — isolated here and listed in `assumptions`
 * so the engine output can surface them:
 *
 *   - opsCost amounts: taken from the tech-team ticket sheet (LIMITED Rs 400,
 *     CUSTOM Rs 650), reverse-solved from its contribution column.
 *   - zeroPayRiskReserve: PRD says "rule-driven", gives no numbers -> 0.
 *   - PCI NOT_AVAILABLE commission modifier: PRD silent -> 0 (neutral).
 *   - Response-rate score: PRD gives no band table -> linear rate * 100.
 *   - Minimum ratings before the rating dimension counts: PRD says
 *     "sufficient history" -> 5.
 * ----------------------------------------------------------------------------
 */

export const RULES_V1 = {
  versions: {
    category: "CAT-1.0",
    pricing: "PRC-1.0",
    tax: "TAX-1.0",
  },

  // ── §3 Pre-Eventory score ───────────────────────────────────────────────
  preEventory: {
    weights: { bookings: 0.6, experience: 0.2, team: 0.2 },
    bookingsScore: [
      { min: 0, score: 1 },
      { min: 25, score: 2 },
      { min: 50, score: 3 },
      { min: 75, score: 4 },
      { min: 100, score: 5 },
    ],
    yearsScore: [
      { min: 0, score: 1 },
      { min: 3, score: 2 },
      { min: 6, score: 3 },
      { min: 9, score: 4 },
      { min: 13, score: 5 },
    ],
    teamScore: [
      { min: 1, score: 1 },
      { min: 6, score: 2 },
      { min: 16, score: 3 },
      { min: 31, score: 4 },
      { min: 51, score: 5 },
    ],
  },

  demandTiers: [
    { min: 0, tier: "LOW" },
    { min: 45, tier: "MODERATE" },
    { min: 70, tier: "HIGH" },
  ],

  // ── §5.5 / §5.6 Behaviour score + blend ─────────────────────────────────
  behaviour: {
    weights: {
      conversion: 0.3,
      acceptance: 0.2,
      response: 0.15,
      reliability: 0.2,
      rating: 0.15,
    },
    conversionScore: [
      { min: 0, score: 20 },
      { min: 5, score: 40 },
      { min: 10, score: 60 },
      { min: 20, score: 80 },
      { min: 30, score: 100 },
    ],
    acceptanceScore: [
      { min: 0, score: 20 },
      { min: 50, score: 40 },
      { min: 65, score: 60 },
      { min: 80, score: 80 },
      { min: 90, score: 100 },
    ],
    // Median response time in MINUTES -> score (lower is better).
    responseTimeScore: [
      { maxMinutes: 30, score: 100 },
      { maxMinutes: 60, score: 80 },
      { maxMinutes: 180, score: 60 },
      { maxMinutes: 360, score: 40 },
      { maxMinutes: Infinity, score: 20 },
    ],
    // Failure rate % -> score (lower is better). 0% exactly is 100.
    failureRateScore: [
      { maxPct: 0, score: 100 },
      { maxPct: 2, score: 90 },
      { maxPct: 5, score: 75 },
      { maxPct: 10, score: 50 },
      { maxPct: Infinity, score: 20 },
    ],
    ratingScore: [
      { min: 0, score: 20 },
      { min: 3.0, score: 40 },
      { min: 3.5, score: 60 },
      { min: 4.0, score: 80 },
      { min: 4.5, score: 100 },
    ],
    minRatingCount: 5,
    // Completed Eventory bookings -> share of weight given to behaviour.
    blend: [
      { min: 0, behaviourWeight: 0 },
      { min: 6, behaviourWeight: 0.2 },
      { min: 21, behaviourWeight: 0.4 },
      { min: 51, behaviourWeight: 0.6 },
      { min: 101, behaviourWeight: 0.8 },
    ],
  },

  // ── §4 Commercial category ──────────────────────────────────────────────
  categoryMatrix: {
    CRITICAL: { HIGH: "CAT_1", MODERATE: "CAT_2", LOW: "CAT_3" },
    NON_CRITICAL: { HIGH: "CAT_4", MODERATE: "CAT_5", LOW: "CAT_6" },
  },

  // ── §6.1 Package bands (on Vendor B2B) ──────────────────────────────────
  packageBands: [
    { min: 0, band: "MICRO" },
    { min: 5000, band: "ENTRY" },
    { min: 10000, band: "CORE" },
    { min: 15000, band: "GROWTH" },
    { min: 20000, band: "PREMIUM" },
    { min: 25000, band: "HIGH" },
    { min: 30000, band: "LARGE" },
    { min: 50000, band: "ENTERPRISE" },
  ],
  bandOrder: ["MICRO", "ENTRY", "CORE", "GROWTH", "PREMIUM", "HIGH", "LARGE", "ENTERPRISE"],

  // ── §7.1 PCI bands (%) ──────────────────────────────────────────────────
  pciBands: [
    { min: -Infinity, band: "WEAK" },
    { min: 0, band: "LOW" },
    { min: 5, band: "FAIR" },
    { min: 10, band: "GOOD" },
    { min: 15, band: "VERY_GOOD" },
    { min: 25, band: "EXCELLENT" },
  ],

  // ── §7.3 CPCI bands (%) — upper-inclusive ───────────────────────────────
  cpciBands: [
    { max: -10, band: "EXCELLENT" },
    { max: -3, band: "GOOD" },
    { max: 2, band: "FAIR" },
    { max: 5, band: "PREMIUM" },
    { max: Infinity, band: "REVIEW_REQUIRED" },
  ],

  // ── Lead-time buckets (days before event) ───────────────────────────────
  leadTimeBuckets: [
    { min: 0, bucket: "SAME_DAY" },
    { min: 1, bucket: "D1_3" },
    { min: 4, bucket: "D4_7" },
    { min: 8, bucket: "D8_13" },
    { min: 14, bucket: "D14_20" },
    { min: 21, bucket: "D21_PLUS" },
  ],

  // ── §8 MCT ──────────────────────────────────────────────────────────────
  mct: {
    // No absolute floor for MICRO (business override of PRD §8's Rs 250,
    // 2026-11-12): MCT is just 7% of B2B, however small the package.
    MICRO: { rate: 7.0, minimum: 0 },
    ENTRY: { rate: 6.0, minimum: 350 },
    CORE: { rate: 5.5, minimum: 600 },
    GROWTH: { rate: 5.0, minimum: 825 },
    PREMIUM: { rate: 4.5, minimum: 1000 },
    HIGH: { rate: 4.0, minimum: 1125 },
    LARGE: { rate: 3.5, minimum: 1200 },
    ENTERPRISE: { rate: 3.0, minimum: 1750 },
  },

  // ── §8 MRER cost components ─────────────────────────────────────────────
  costs: {
    pgRatePct: 2.5, // of the digitally captured customer amount
    payoutsPerBooking: 1,
    impsPayoutFee: [
      { min: 0, fee: 6 },
      { min: 1001, fee: 8 },
      { min: 25001, fee: 15 },
    ],
    // Applies only to ADVANCE_PAY_BOOK / ENQUIRE_QUOTE with LIMITED/CUSTOM.
    opsCost: { NONE: 0, LIMITED: 400, CUSTOM: 650 },
    opsCostModes: ["ADVANCE_PAY_BOOK", "ENQUIRE_QUOTE"],
    communicationCost: 5,
    // ZERO_PAY_BOOK only: % of Vendor B2B by lead bucket. PRD gives no values.
    zeroPayReservePct: {
      SAME_DAY: 0,
      D1_3: 0,
      D4_7: 0,
      D8_13: 0,
      D14_20: 0,
      D21_PLUS: 0,
    },
  },

  // ── §9 Vendor commission ────────────────────────────────────────────────
  commission: {
    clamp: { min: 2.0, max: 7.0 },
    categoryBase: { CAT_1: 4.5, CAT_2: 4.25, CAT_3: 4.0, CAT_4: 4.0, CAT_5: 3.5, CAT_6: 3.0 },
    bandModifier: {
      MICRO: 1.0, ENTRY: 0.75, CORE: 0.5, GROWTH: 0.25,
      PREMIUM: 0, HIGH: -0.25, LARGE: -0.5, ENTERPRISE: -0.75,
    },
    pciModifier: {
      WEAK: 1.5, LOW: 1.0, FAIR: 0.5, GOOD: 0, VERY_GOOD: -0.5, EXCELLENT: -1.0,
      NOT_AVAILABLE: 0,
    },
    leadTimeModifier: {
      D21_PLUS: 1.0, D14_20: 0.75, D8_13: 0.5, D4_7: 0, D1_3: -0.5, SAME_DAY: -0.75,
    },
    // §9.2 rounding step by Vendor B2B.
    rounding: [
      { min: 0, step: 10 },
      { min: 10000, step: 50 },
      { min: 50000, step: 100 },
    ],
    trialBookings: 5,
    // PRD §10 floor is MRER - VendorCommissionRevenue. Read literally, the
    // trial's 0 commission makes the customer fee cover MRER alone, which
    // blocked every trial vendor's package under ~₹5,100. true = the floor
    // counts the SHADOW commission, i.e. Eventory funds the trial and the
    // customer pays the normal fee. Business override (2026-11-12) of the
    // literal reading chosen on 2026-11-04.
    trialFloorUsesShadowCommission: true,
  },

  // ── §10 Eventory Service Fee ────────────────────────────────────────────
  serviceFee: {
    bandBase: {
      MICRO: 9.0, ENTRY: 8.5, CORE: 8.0, GROWTH: 7.5,
      PREMIUM: 7.0, HIGH: 6.5, LARGE: 5.5, ENTERPRISE: 4.5,
    },
    categoryModifier: { CAT_1: 0.75, CAT_2: 0.5, CAT_3: 0.25, CAT_4: 0.25, CAT_5: 0.1, CAT_6: 0 },
    bookingModeModifier: { ADVANCE_PAY_BOOK: -0.75, ZERO_PAY_BOOK: 0.75, ENQUIRE_QUOTE: 1.0 },
    leadTimeModifier: {
      D21_PLUS: -1.0, D14_20: -0.75, D8_13: -0.5, D4_7: 0, D1_3: 0.75, SAME_DAY: 1.25,
    },
    negotiationModifier: { NONE: 0, LIMITED: 0.5, CUSTOM: 1.0 },
    modeLimits: {
      ADVANCE_PAY_BOOK: { floor: 4, ceiling: 10 },
      ZERO_PAY_BOOK: { floor: 5, ceiling: 12 },
      ENQUIRE_QUOTE: { floor: 6, ceiling: 15 },
    },
    // Bands with no mode ceiling: the fee may rise as far as MRER needs.
    // Business override of PRD §10.6 (2026-11-12): at MICRO prices the
    // MCT minimum alone exceeds 10% of B2B, so with a ceiling no MICRO
    // package could ever be booked at a fixed price.
    ceilingExemptBands: ["MICRO"],
  },

  // ── §12 Booking modes ───────────────────────────────────────────────────
  bookingModes: ["ADVANCE_PAY_BOOK", "ZERO_PAY_BOOK", "ENQUIRE_QUOTE"],
  fixedPriceModes: ["ADVANCE_PAY_BOOK", "ZERO_PAY_BOOK"],
  quoteMinBand: "CORE",
  zeroPay: { maxActiveForNewCustomer: 1 },

  // ── §11 Round-off & merchandising ───────────────────────────────────────
  merchandising: {
    corridorPctOfB2B: 1.0,
    // Fixed-price endings by customer total. A point P qualifies when
    // P mod `modulus` is one of `endings`.
    fixedPriceEndings: [
      { min: 0, modulus: 100, endings: [99] },
      { min: 10000, modulus: 500, endings: [499] },
      { min: 50000, modulus: 1000, endings: [999] },
    ],
    // ENQUIRE_QUOTE prefers clean starting prices.
    quoteStep: 500,
  },

  // ── §15 Tax (CA-supplied; reconfirm before production) ──────────────────
  tax: {
    gstOnServiceFeePct: 18,
    gstOnCommissionPct: 18,
    tcsPctRegisteredVendor: 0.5,
  },

  assumptions: [
    "OPS_COST_FROM_TICKET_SHEET",
    "ZERO_PAY_RESERVE_PLACEHOLDER_ZERO",
    "PCI_NOT_AVAILABLE_MODIFIER_ZERO",
    "RESPONSE_RATE_SCORE_LINEAR",
    "MIN_RATING_COUNT_5",
    "B2B_IS_PRE_GST",
    "BAND_LOWER_BOUND_INCLUSIVE",
    "MICRO_NO_FEE_CEILING",
    "MICRO_NO_MCT_MINIMUM",
    "TRIAL_FLOOR_USES_SHADOW_COMMISSION",
  ],
};

export default RULES_V1;
