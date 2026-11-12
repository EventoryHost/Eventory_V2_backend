import mongoose from "mongoose";
import Package from "../../models/Package.js";
import Vendor from "../../models/Vendor.js";
import Booking from "../../models/Booking.js";
import Review from "../../models/Review.js";
import VendorCategoryHistory from "../../models/VendorCategoryHistory.js";
import { resolveVendorForPackage } from "../../utils/resolveVendor.js";
import { ReviewTransitionError } from "../../utils/reviewTransitionError.js";
import { round2 } from "../../utils/money.js";
import { getActiveRules } from "./ruleSetService.js";
import { evaluatePublication } from "./publicationEngine.js";
import { priceAllModes } from "./pricingEngine.js";
import {
  resolveVendorDemand,
  publicationPackage,
  buildBaseline,
  buildEngineVendor,
  defaultBookingMode,
  packageVendorGst,
} from "./commercialContextService.js";

/**
 * Commercial Engine persistence — everything that reads/writes documents.
 * The maths stays in the pure engine modules next to this file.
 */

const VENDOR_FIELDS = "id vendorType gstNumber bookingsPerYear experience teamSize commercial";

const COMMERCIAL_KEYS = [
  "vendorB2BPrice",
  "verifiedVendorB2CPrice",
  "eventoryApprovedCriticality",
  "marketPriceLow",
  "marketPriceMedian",
  "marketPriceHigh",
];

export const loadVendor = (vendorIdRaw) => resolveVendorForPackage(vendorIdRaw, VENDOR_FIELDS);

const vendorQuery = (vendor) =>
  mongoose.Types.ObjectId.isValid(vendor._id) ? { _id: vendor._id } : { id: vendor.id };

async function vendorRatingTotals(vendor) {
  const ids = [vendor.id, vendor._id && String(vendor._id)].filter(Boolean);
  const [row] = await Review.aggregate([
    { $match: { vendorId: { $in: ids }, status: "Published" } },
    { $group: { _id: null, ratingSum: { $sum: "$rating" }, ratingCount: { $sum: 1 } } },
  ]);
  return { ratingSum: row?.ratingSum ?? 0, ratingCount: row?.ratingCount ?? 0 };
}

/**
 * Recomputes the vendor's demand tier and stores it. A change writes a
 * VendorCategoryHistory row; confirmed bookings keep their own snapshot.
 */
export async function refreshVendorTier(vendorIn, { source = "COMPUTED", by = null, reason = null } = {}) {
  const rules = await getActiveRules();
  // Ratings are derived from raw Published reviews, never averaged averages (§5.4).
  const ratings = await vendorRatingTotals(vendorIn);
  const vendor = {
    ...vendorIn,
    commercial: {
      ...(vendorIn.commercial || {}),
      counters: { ...(vendorIn.commercial?.counters || {}), ...ratings },
    },
  };
  const demand = resolveVendorDemand(vendor, rules);
  const previousTier = vendor.commercial?.currentDemandTier ?? null;
  const now = new Date();

  const set = {
    "commercial.counters.ratingSum": ratings.ratingSum,
    "commercial.counters.ratingCount": ratings.ratingCount,
    "commercial.demandScore": demand.score,
    "commercial.currentDemandTier": demand.tier,
    "commercial.lastCategoryUpdatedAt": now,
  };
  if (previousTier !== demand.tier) {
    set["commercial.previousDemandTier"] = previousTier;
    set["commercial.categoryEffectiveFrom"] = now;
    await VendorCategoryHistory.create({
      vendorId: vendor.id || String(vendor._id),
      previousTier,
      newTier: demand.tier,
      demandScore: demand.score,
      preEventoryScore: demand.pre?.score ?? null,
      behaviourScore: demand.behaviour?.score ?? null,
      behaviourWeight: demand.behaviourWeight ?? null,
      source: demand.overridden ? "ADMIN_OVERRIDE" : source,
      reason,
      categoryRuleVersion: rules.versions.category,
      by,
      effectiveFrom: now,
    });
  }
  await Vendor.updateOne(vendorQuery(vendor), { $set: set });
  return demand;
}

/** Publication review for one package (no write). */
export async function evaluatePackage(pkg, vendor) {
  const rules = await getActiveRules();
  const v = vendor ?? (await loadVendor(pkg.vendorId));
  if (!v) throw new ReviewTransitionError("Vendor profile not found", 404);
  const demand = resolveVendorDemand(v, rules);
  return evaluatePublication(
    {
      vendor: {
        gstRegistered: Boolean(v.gstNumber),
        monetizationModel: v.commercial?.monetizationModel ?? "TRIAL",
        successfulBookingsCount: v.commercial?.successfulBookingsCount ?? 0,
      },
      demand,
      pkg: publicationPackage(pkg, v),
    },
    rules,
  );
}

/**
 * Runs the publication review on every variant of a group and stores the
 * outcome on Package.commercial (PRD §13.3 steps 2–10). Called on approve.
 */
export async function reviewGroupCommercials(groupFilter, { by = null } = {}) {
  const variants = await Package.find(groupFilter).select("+commercial").lean();
  if (!variants.length) throw new ReviewTransitionError("Package not found", 404);

  const vendor = await loadVendor(variants[0].vendorId);
  if (!vendor) throw new ReviewTransitionError("Vendor profile not found", 404);
  await refreshVendorTier(vendor, { by });

  const now = new Date();
  const results = [];
  for (const pkg of variants) {
    const result = await evaluatePackage(pkg, vendor);
    // §13.5: a commercial change (B2B, B2C, criticality, benchmark) is a new
    // package version; photo/copy edits leave the baseline unchanged.
    const prev = pkg.commercial?.baseline;
    const commercialChanged =
      prev &&
      COMMERCIAL_KEYS.some((k) => JSON.stringify(prev[k] ?? null) !== JSON.stringify(result.snapshot[k] ?? null));
    await Package.updateOne(
      { _id: pkg._id },
      {
        ...(commercialChanged ? { $inc: { "commercial.packageVersion": 1 } } : {}),
        $set: {
          "commercial.publicationOutcome": result.outcome,
          "commercial.modeEligibility": result.modes,
          "commercial.reasonCodes": result.reasonCodes,
          "commercial.baseline": { ...result.snapshot, warnings: result.warnings },
          "commercial.commercialReviewedAt": now,
          "commercial.commercialReviewedBy": by,
        },
      },
    );
    results.push({ packageId: pkg._id, variantType: pkg.variantType, ...result });
  }
  return results;
}

/**
 * Go-live gate: a variant whose commercial review ends in
 * PRICE_REVIEW_REQUIRED can't be published. The review is re-run on every
 * go-live, so whatever the EM corrected since approval (commercial values,
 * the vendor's profile, rules) counts straight away.
 */
export async function assertGroupCanGoLive(groupFilter, { by = null } = {}) {
  const approved = await Package.find({ ...groupFilter, packageStatus: "Approved" }).select("_id").lean();
  const approvedIds = new Set(approved.map((v) => String(v._id)));
  const results = (await reviewGroupCommercials(groupFilter, { by })).filter((r) => approvedIds.has(String(r.packageId)));

  const blocked = results.filter((r) => r.outcome === "PRICE_REVIEW_REQUIRED");
  if (blocked.length) {
    throw new ReviewTransitionError(
      "Commercial review requires a price correction before this package can go live.",
      409,
      { code: "PRICE_REVIEW_REQUIRED", variants: blocked.map((r) => ({ packageId: r.packageId, reasonCodes: r.reasonCodes })) },
    );
  }
}

/** All-mode runtime price for one package + event date (admin preview, PDP). */
export async function previewPackagePricing(pkgIn, { daysToEvent, eventDate, negotiationMode, customer } = {}) {
  const rules = await getActiveRules();
  // Customer-side reads load packages without the select:false commercial block.
  const pkg =
    pkgIn.commercial === undefined
      ? { ...pkgIn, commercial: (await Package.findById(pkgIn._id).select("commercial").lean())?.commercial }
      : pkgIn;
  const vendor = await loadVendor(pkg.vendorId);
  const { baseline, demand, criticality } = buildBaseline({ pkg, vendor, rules });
  const modes = priceAllModes(
    {
      vendor: buildEngineVendor(vendor, { vendorGst: packageVendorGst(pkg, vendor) }),
      baseline,
      runtime: {
        daysToEvent,
        eventDate,
        negotiationMode: negotiationMode ?? pkg.commercial?.negotiationMode ?? "NONE",
        customer,
      },
    },
    rules,
  );
  return { demand, criticality, baseline, defaultMode: defaultBookingMode(pkg), modes };
}

/** Booking.commercialSnapshot is select:false — load it when the caller's doc lacks it. */
export async function bookingCommercialSnapshot(booking) {
  if (booking.commercialSnapshot != null) return booking.commercialSnapshot;
  if (!booking._id) return null;
  const doc = await Booking.findById(booking._id).select("+commercialSnapshot").lean();
  return doc?.commercialSnapshot ?? null;
}

/**
 * Monthly demand review (§5.6) for every vendor — run from
 * POST /api/admin/commercial/vendors/refresh-all or refreshVendorTiers.mjs.
 * Confirmed bookings never reprice; only future pricing sees a new tier.
 */
export async function refreshAllVendorTiers({ by = null } = {}) {
  const vendors = await Vendor.find({}).select(VENDOR_FIELDS).lean();
  const summary = { total: vendors.length, changed: [], failed: [] };
  for (const vendor of vendors) {
    try {
      const before = vendor.commercial?.currentDemandTier ?? null;
      const demand = await refreshVendorTier(vendor, { source: "MONTHLY_REVIEW", by });
      if (before !== demand.tier) summary.changed.push({ vendorId: vendor.id, from: before, to: demand.tier });
    } catch (err) {
      summary.failed.push({ vendorId: vendor.id, error: err.message });
    }
  }
  return summary;
}
