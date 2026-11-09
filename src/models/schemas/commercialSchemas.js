import mongoose from "mongoose";

/**
 * Commercial Engine (PRD v1.0) data that lives on existing documents.
 * The maths is in src/services/commercial/; these schemas only hold the
 * inputs Eventory/the vendor supply and the results the engine produced.
 */

export const CRITICALITIES = ["CRITICAL", "NON_CRITICAL"];
export const DEMAND_TIERS = ["LOW", "MODERATE", "HIGH", "PROVISIONAL"];
export const BOOKING_MODES = ["ADVANCE_PAY_BOOK", "ZERO_PAY_BOOK", "ENQUIRE_QUOTE"];
export const NEGOTIATION_MODES = ["NONE", "LIMITED", "CUSTOM"];
export const PUBLICATION_OUTCOMES = ["APPROVED_FIXED", "QUOTE_ONLY", "PRICE_REVIEW_REQUIRED"];
export const MONETIZATION_MODELS = ["TRIAL", "COMMISSION", "SUBSCRIPTION"];
export const SEASON_BUCKETS = ["NORMAL", "PEAK", "SUPER_PEAK"];

/** Package.commercial — PRD §6.2 vendor fields, §6.3 EM fields, §13 baseline. */
export const PackageCommercialSchema = new mongoose.Schema(
  {
    // ── Vendor-entered (§6.2) ──
    // null = not entered yet; the engine then uses the package's effective price.
    vendorB2BPrice: { type: Number, min: 0, default: null },
    vendorNormalB2CPrice: { type: Number, min: 0, default: null },
    vendorFloorPrice: { type: Number, min: 0, default: null },
    allowVendorSideNegotiation: { type: Boolean, default: false },
    vendorProposedCriticality: { type: String, enum: [...CRITICALITIES, null], default: null },
    negotiationMode: { type: String, enum: NEGOTIATION_MODES, default: "NONE" },
    // null = derived from bookingSettings (see commercialContextService).
    bookingModesSupported: { type: [{ type: String, enum: BOOKING_MODES }], default: undefined },

    // ── EM / PRINT review (§6.3) ──
    eventoryApprovedCriticality: { type: String, enum: [...CRITICALITIES, null], default: null },
    b2cPriceVerified: { type: Boolean, default: false },
    verifiedVendorB2CPrice: { type: Number, min: 0, default: null },
    marketPriceLow: { type: Number, min: 0, default: null },
    marketPriceMedian: { type: Number, min: 0, default: null },
    marketPriceHigh: { type: Number, min: 0, default: null },
    marketBenchmarkSource: { type: String, default: null },
    marketBenchmarkUpdatedAt: { type: Date, default: null },
    seasonBucket: { type: String, enum: [...SEASON_BUCKETS, null], default: null },
    packageScopeVerified: { type: Boolean, default: false },
    comparableScopeSignature: { type: String, default: null },

    // ── Publication result (§13.2–13.4) ──
    packageVersion: { type: Number, default: 1 },
    publicationOutcome: { type: String, enum: [...PUBLICATION_OUTCOMES, null], default: null },
    modeEligibility: {
      ADVANCE_PAY_BOOK: { type: Boolean, default: null },
      ZERO_PAY_BOOK: { type: Boolean, default: null },
      ENQUIRE_QUOTE: { type: Boolean, default: null },
    },
    reasonCodes: { type: [String], default: [] },
    // Frozen publication snapshot (§13.4): versions, tier, category, band, PCI, benchmark.
    baseline: { type: mongoose.Schema.Types.Mixed, default: null },
    commercialReviewedAt: { type: Date, default: null },
    commercialReviewedBy: { type: String, default: null },
  },
  { _id: false }
);

/** Vendor.commercial — PRD §3 inputs, §5.2 behaviour counters, §5.6 tier state, §9.1 trial. */
export const VendorCommercialSchema = new mongoose.Schema(
  {
    // Numeric demand inputs. null = parse the legacy free-text profile fields.
    bookingsLast12Months: { type: Number, min: 0, default: null },
    yearsOfOperation: { type: Number, min: 0, default: null },
    teamSize: { type: Number, min: 0, default: null },

    monetizationModel: { type: String, enum: MONETIZATION_MODELS, default: "TRIAL" },
    // Confirmed + paid + delivered Eventory bookings — drives the trial.
    successfulBookingsCount: { type: Number, default: 0 },

    counters: {
      qualifiedLeadsCount: { type: Number, default: 0 },
      acceptedLeadsCount: { type: Number, default: 0 },
      rejectedLeadsCount: { type: Number, default: 0 },
      bookingsCount: { type: Number, default: 0 },
      completedBookingsCount: { type: Number, default: 0 },
      vendorCancelledCount: { type: Number, default: 0 },
      customerCancelledCount: { type: Number, default: 0 },
      vendorAttributableFailureCount: { type: Number, default: 0 },
      totalGmv: { type: Number, default: 0 },
      vendorActionRequiredCount: { type: Number, default: 0 },
      responseTimeTotalMinutes: { type: Number, default: 0 },
      responseCount: { type: Number, default: 0 },
      ratingSum: { type: Number, default: 0 },
      ratingCount: { type: Number, default: 0 },
    },

    demandScore: { type: Number, default: null },
    currentDemandTier: { type: String, enum: [...DEMAND_TIERS, null], default: null },
    previousDemandTier: { type: String, enum: [...DEMAND_TIERS, null], default: null },
    lastCategoryUpdatedAt: { type: Date, default: null },
    categoryEffectiveFrom: { type: Date, default: null },
    // Admin override wins over the computed tier until cleared.
    tierOverride: {
      tier: { type: String, enum: [...DEMAND_TIERS, null], default: null },
      reason: { type: String, default: null },
      by: { type: String, default: null },
      at: { type: Date, default: null },
    },
  },
  { _id: false }
);
