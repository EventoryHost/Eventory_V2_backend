import mongoose from "mongoose";
import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";
import CommercialRuleSet from "../models/CommercialRuleSet.js";
import CommercialEvent from "../models/CommercialEvent.js";
import Booking from "../models/Booking.js";
import CheckoutSession from "../models/CheckoutSession.js";
import VendorCategoryHistory from "../models/VendorCategoryHistory.js";
import {
  CRITICALITIES,
  DEMAND_TIERS,
  BOOKING_MODES,
  NEGOTIATION_MODES,
  MONETIZATION_MODELS,
  SEASON_BUCKETS,
} from "../models/schemas/commercialSchemas.js";
import { RULES_V1 } from "../services/commercial/rules.v1.js";
import { getActiveRules, clearRuleCache, serializeRules, reviveRules } from "../services/commercial/ruleSetService.js";
import { vendorDemand } from "../services/commercial/categoryEngine.js";
import { evaluatePublication } from "../services/commercial/publicationEngine.js";
import { priceAllModes } from "../services/commercial/pricingEngine.js";
import {
  evaluatePackage,
  reviewGroupCommercials,
  previewPackagePricing,
  refreshVendorTier,
  refreshAllVendorTiers,
  loadVendor,
} from "../services/commercial/commercialService.js";
import { resolveVendorDemand, vendorDemandInputs } from "../services/commercial/commercialContextService.js";
import { buildGroupFilter } from "../utils/packageGroup.js";
import { ReviewTransitionError } from "../utils/reviewTransitionError.js";

/**
 * Admin control over the Commercial Engine (PRD v1.0): versioned rule sets,
 * the EM commercial review fields on packages, vendor demand inputs / tier
 * override, and full internal pricing previews. Admin-only — responses here
 * DO include commission, category, PCI and B2B economics.
 */

const fail = (res, error, fallback) => {
  if (error instanceof ReviewTransitionError) {
    return res.status(error.statusCode).json({ success: false, message: error.message, ...(error.details || {}) });
  }
  return res.status(500).json({ success: false, message: fallback, error: error.message });
};

const bad = (res, message) => res.status(400).json({ success: false, message });

// ── Field whitelists ──────────────────────────────────────────────────────

const num = (v) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
const oneOf = (list) => (v) => v === null || list.includes(v);
const bool = (v) => typeof v === "boolean";
const str = (v) => v === null || typeof v === "string";
const listOf = (list) => (v) => v === null || (Array.isArray(v) && v.every((x) => list.includes(x)));

const PACKAGE_FIELDS = {
  vendorB2BPrice: num,
  vendorNormalB2CPrice: num,
  vendorFloorPrice: num,
  allowVendorSideNegotiation: bool,
  vendorProposedCriticality: oneOf(CRITICALITIES),
  negotiationMode: oneOf(NEGOTIATION_MODES),
  bookingModesSupported: listOf(BOOKING_MODES),
  eventoryApprovedCriticality: oneOf(CRITICALITIES),
  b2cPriceVerified: bool,
  verifiedVendorB2CPrice: num,
  marketPriceLow: num,
  marketPriceMedian: num,
  marketPriceHigh: num,
  marketBenchmarkSource: str,
  seasonBucket: oneOf(SEASON_BUCKETS),
  packageScopeVerified: bool,
  comparableScopeSignature: str,
};

// Shared by every variant of a package; prices stay per variant.
const GROUP_FIELDS = [
  "eventoryApprovedCriticality",
  "vendorProposedCriticality",
  "negotiationMode",
  "bookingModesSupported",
  "allowVendorSideNegotiation",
  "marketBenchmarkSource",
  "seasonBucket",
  "packageScopeVerified",
  "comparableScopeSignature",
];

const VENDOR_FIELDS = {
  bookingsLast12Months: num,
  yearsOfOperation: num,
  teamSize: num,
  monetizationModel: oneOf(MONETIZATION_MODELS),
  successfulBookingsCount: num,
};

function pickFields(body, spec, prefix) {
  const set = {};
  for (const [key, valid] of Object.entries(spec)) {
    if (!(key in (body || {}))) continue;
    if (!valid(body[key])) return { error: `Invalid value for ${key}` };
    set[`${prefix}.${key}`] = body[key];
  }
  return { set };
}

const findPackage = (packageId) =>
  mongoose.Types.ObjectId.isValid(packageId) ? Package.findById(packageId).select("+commercial").lean() : null;

const vendorFilter = (vendorId) =>
  mongoose.Types.ObjectId.isValid(vendorId) ? { $or: [{ _id: vendorId }, { id: vendorId }] } : { id: vendorId };

// ── Rule sets ─────────────────────────────────────────────────────────────

/** GET /api/admin/commercial/rules — the active rules plus every stored version. */
export const getRules = async (req, res) => {
  try {
    const [active, versions] = await Promise.all([
      getActiveRules(),
      CommercialRuleSet.find().select("-rules").sort({ createdAt: -1 }).lean(),
    ]);
    const source = versions.some((v) => v.status === "ACTIVE") ? "DATABASE" : "BUNDLED_V1";
    res.status(200).json({ success: true, source, active: serializeRules(active), versions });
  } catch (error) {
    fail(res, error, "Failed to load commercial rules");
  }
};

/** GET /api/admin/commercial/rules/:version */
export const getRuleVersion = async (req, res) => {
  try {
    const doc = await CommercialRuleSet.findOne({ version: req.params.version }).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Rule version not found" });
    res.status(200).json({ success: true, data: doc });
  } catch (error) {
    fail(res, error, "Failed to load rule version");
  }
};

/**
 * POST /api/admin/commercial/rules
 * Body: { version, rules?, fromVersion?, notes?, by? } — creates a DRAFT.
 * Without `rules`, clones `fromVersion`, else the active set.
 */
export const createRuleDraft = async (req, res) => {
  try {
    const { version, rules, fromVersion, notes, by } = req.body || {};
    if (!version || typeof version !== "string") return bad(res, "version is required");
    if (await CommercialRuleSet.exists({ version })) return bad(res, `Version ${version} already exists`);

    let base = rules;
    if (!base && fromVersion) {
      const from = await CommercialRuleSet.findOne({ version: fromVersion }).lean();
      if (!from) return res.status(404).json({ success: false, message: "fromVersion not found" });
      base = from.rules;
    }
    base = serializeRules(base ?? (await getActiveRules()));
    base.versions = { ...(base.versions || {}), pricing: version };

    const doc = await CommercialRuleSet.create({ version, rules: base, notes: notes ?? null, createdBy: by ?? null });
    res.status(201).json({ success: true, data: doc });
  } catch (error) {
    fail(res, error, "Failed to create rule draft");
  }
};

/** PUT /api/admin/commercial/rules/:version — edit a DRAFT. Body: { rules?, notes? } */
export const updateRuleDraft = async (req, res) => {
  try {
    const doc = await CommercialRuleSet.findOne({ version: req.params.version });
    if (!doc) return res.status(404).json({ success: false, message: "Rule version not found" });
    if (doc.status !== "DRAFT") return res.status(409).json({ success: false, message: `Only a DRAFT can be edited (this one is ${doc.status})` });

    const { rules, notes } = req.body || {};
    if (rules) {
      doc.rules = { ...serializeRules(rules), versions: { ...(rules.versions || {}), pricing: doc.version } };
      doc.markModified("rules");
    }
    if (notes !== undefined) doc.notes = notes;
    await doc.save();
    res.status(200).json({ success: true, data: doc });
  } catch (error) {
    fail(res, error, "Failed to update rule draft");
  }
};

/** POST /api/admin/commercial/rules/:version/activate — retires the current ACTIVE set. */
export const activateRuleSet = async (req, res) => {
  try {
    const doc = await CommercialRuleSet.findOne({ version: req.params.version });
    if (!doc) return res.status(404).json({ success: false, message: "Rule version not found" });
    if (doc.status === "ACTIVE") return res.status(200).json({ success: true, data: doc });
    if (doc.status === "RETIRED") return res.status(409).json({ success: false, message: "A retired version can't be re-activated; clone it into a new draft" });

    const now = new Date();
    await CommercialRuleSet.updateMany({ status: "ACTIVE" }, { $set: { status: "RETIRED", retiredAt: now } });
    doc.status = "ACTIVE";
    doc.activatedAt = now;
    doc.activatedBy = req.body?.by ?? null;
    await doc.save();
    clearRuleCache();
    res.status(200).json({ success: true, data: doc });
  } catch (error) {
    fail(res, error, "Failed to activate rule set");
  }
};

/** POST /api/admin/commercial/rules/seed — stores the bundled PRD v1 rules as ACTIVE when none is. */
export const seedRules = async (req, res) => {
  try {
    if (await CommercialRuleSet.exists({ status: "ACTIVE" })) {
      return res.status(409).json({ success: false, message: "An ACTIVE rule set already exists" });
    }
    const version = RULES_V1.versions.pricing;
    const doc = await CommercialRuleSet.findOneAndUpdate(
      { version },
      {
        $set: { status: "ACTIVE", rules: serializeRules(RULES_V1), activatedAt: new Date(), activatedBy: req.body?.by ?? null },
        $setOnInsert: { notes: "PRD v1.0 baseline (rules.v1.js)" },
      },
      { upsert: true, new: true }
    );
    clearRuleCache();
    res.status(201).json({ success: true, data: doc });
  } catch (error) {
    fail(res, error, "Failed to seed rules");
  }
};

// ── Packages ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/commercial/packages/:packageId?days=&date=&negotiationMode=
 * Stored commercial fields, a live publication evaluation, and runtime
 * pricing for every booking mode (default: 14 days out).
 */
export const getPackageCommercial = async (req, res) => {
  try {
    const pkg = await findPackage(req.params.packageId);
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found" });

    const { days, date, negotiationMode } = req.query;
    const daysToEvent = date ? undefined : days != null ? Number(days) : 14;
    const [evaluation, pricing] = await Promise.all([
      evaluatePackage(pkg),
      previewPackagePricing(pkg, { daysToEvent, eventDate: date, negotiationMode }),
    ]);
    res.status(200).json({
      success: true,
      packageId: pkg._id,
      packageStatus: pkg.packageStatus,
      commercial: pkg.commercial || null,
      evaluation,
      pricing,
    });
  } catch (error) {
    fail(res, error, "Failed to load package commercials");
  }
};

/**
 * PUT /api/admin/commercial/packages/:packageId
 * Body: any of PACKAGE_FIELDS, plus { applyToGroup?: true, by? }.
 * applyToGroup copies the group-level fields (criticality, modes,
 * negotiation, benchmark context) to every variant; prices stay per variant.
 * Re-runs the commercial review afterwards when the package is past review.
 */
export const updatePackageCommercial = async (req, res) => {
  try {
    const pkg = await findPackage(req.params.packageId);
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found" });

    const { set, error } = pickFields(req.body, PACKAGE_FIELDS, "commercial");
    if (error) return bad(res, error);
    if (!Object.keys(set).length) return bad(res, "No commercial fields to update");
    if ("commercial.marketPriceMedian" in set || "commercial.marketPriceLow" in set || "commercial.marketPriceHigh" in set) {
      set["commercial.marketBenchmarkUpdatedAt"] = new Date();
    }

    await Package.updateOne({ _id: pkg._id }, { $set: set });

    if (req.body?.applyToGroup && pkg.packageGroupId) {
      const groupSet = Object.fromEntries(
        Object.entries(set).filter(([k]) => GROUP_FIELDS.includes(k.replace("commercial.", "")))
      );
      if (Object.keys(groupSet).length) {
        await Package.updateMany({ ...buildGroupFilter(pkg.packageGroupId), _id: { $ne: pkg._id } }, { $set: groupSet });
      }
    }

    let review = null;
    if (["Approved", "Live"].includes(pkg.packageStatus)) {
      const groupFilter = pkg.packageGroupId ? buildGroupFilter(pkg.packageGroupId) : { _id: pkg._id };
      review = await reviewGroupCommercials(groupFilter, { by: req.body?.by ?? null });
    }

    const updated = await Package.findById(pkg._id).select("commercial packageStatus").lean();
    res.status(200).json({ success: true, data: updated, review });
  } catch (error) {
    fail(res, error, "Failed to update package commercials");
  }
};

/** POST /api/admin/commercial/packages/group/:packageGroupId/review — re-run publication review. */
export const reviewPackageGroup = async (req, res) => {
  try {
    const results = await reviewGroupCommercials(buildGroupFilter(req.params.packageGroupId), { by: req.body?.by ?? null });
    res.status(200).json({ success: true, data: results });
  } catch (error) {
    fail(res, error, "Failed to run commercial review");
  }
};

/**
 * GET /api/admin/commercial/review-queue?outcome=PRICE_REVIEW_REQUIRED|QUOTE_ONLY&days=30
 * Packages whose commercial review did not clear fixed pricing, plus live
 * lines customers were refused at checkout in the last `days` (default 30).
 */
export const getPriceReviewQueue = async (req, res) => {
  try {
    const outcomes = req.query.outcome ? [req.query.outcome] : ["PRICE_REVIEW_REQUIRED", "QUOTE_ONLY"];
    const days = Math.min(Number(req.query.days) || 30, 365);
    const since = new Date(Date.now() - days * 86400000);

    const [packages, blocked] = await Promise.all([
      Package.find({
        "commercial.publicationOutcome": { $in: outcomes },
        packageStatus: { $in: ["Under Review", "Approved", "Live"] },
      })
        .select(
          "packageGroupId variantType vendorId vendorType packageStatus step1_eventAndCrew.packageName " +
            "commercial.publicationOutcome commercial.reasonCodes commercial.baseline commercial.commercialReviewedAt commercial.vendorB2BPrice"
        )
        .sort({ "commercial.commercialReviewedAt": -1 })
        .lean(),
      CheckoutSession.aggregate([
        { $match: { updatedAt: { $gte: since }, "lockedQuote.commercialBlockedLines.0": { $exists: true } } },
        { $unwind: "$lockedQuote.commercialBlockedLines" },
        {
          $group: {
            _id: "$lockedQuote.commercialBlockedLines.packageId",
            sessions: { $sum: 1 },
            lastSeenAt: { $max: "$updatedAt" },
            statuses: { $addToSet: "$lockedQuote.commercialBlockedLines.status" },
          },
        },
        { $sort: { sessions: -1 } },
      ]),
    ]);

    res.status(200).json({
      success: true,
      packages: packages.map((p) => ({
        packageId: p._id,
        packageGroupId: p.packageGroupId,
        name: p.step1_eventAndCrew?.packageName ?? null,
        variantType: p.variantType,
        vendorId: p.vendorId,
        vendorType: p.vendorType,
        packageStatus: p.packageStatus,
        outcome: p.commercial?.publicationOutcome,
        reasonCodes: p.commercial?.reasonCodes ?? [],
        baseline: p.commercial?.baseline ?? null,
        reviewedAt: p.commercial?.commercialReviewedAt ?? null,
      })),
      blockedAtCheckout: { days, packages: blocked.map((b) => ({ packageId: b._id, ...b, _id: undefined })) },
    });
  } catch (error) {
    fail(res, error, "Failed to load price review queue");
  }
};

/** Lead-time bucket of a stored snapshot (§9/§10 buckets), as an aggregation expression. */
const LEAD_BUCKET_EXPR = {
  $switch: {
    branches: [
      { case: { $gte: ["$commercialSnapshot.daysToEventAtBooking", 21] }, then: "D21_PLUS" },
      { case: { $gte: ["$commercialSnapshot.daysToEventAtBooking", 14] }, then: "D14_20" },
      { case: { $gte: ["$commercialSnapshot.daysToEventAtBooking", 8] }, then: "D8_13" },
      { case: { $gte: ["$commercialSnapshot.daysToEventAtBooking", 4] }, then: "D4_7" },
      { case: { $gte: ["$commercialSnapshot.daysToEventAtBooking", 1] }, then: "D1_3" },
    ],
    default: "SAME_DAY",
  },
};

const GROUP_KEYS = {
  band: "$commercialSnapshot.packageBand",
  category: "$commercialSnapshot.commercialCategory",
  mode: "$commercialSnapshot.bookingMode",
  pciBand: "$commercialSnapshot.pciBand",
  leadTime: LEAD_BUCKET_EXPR,
  vendor: "$vendorId",
  ruleVersion: "$commercialSnapshot.pricing_rule_version",
};

/**
 * GET /api/admin/commercial/analytics?from=&to=&groupBy=band|category|mode|pciBand|leadTime|vendor|ruleVersion
 * Booking economics from the frozen snapshots (PRD §18.1): GMV, platform
 * revenue, variable cost, contribution before CAC, commission (actual and
 * shadow), service fee, rounding — plus the package approval funnel and
 * the customer funnel event counts for the same window.
 */
export const getCommercialAnalytics = async (req, res) => {
  try {
    const groupBy = req.query.groupBy || "band";
    if (!GROUP_KEYS[groupBy]) return bad(res, `groupBy must be one of ${Object.keys(GROUP_KEYS).join(", ")}`);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * 86400000);
    if (isNaN(from) || isNaN(to)) return bad(res, "from/to must be dates");

    const sum = (field) => ({ $sum: { $ifNull: [`$commercialSnapshot.${field}`, 0] } });
    const [economics, cancelled, approvalFunnel, funnelEvents] = await Promise.all([
      Booking.aggregate([
        { $match: { createdAt: { $gte: from, $lte: to }, commercialSnapshot: { $ne: null } } },
        {
          $group: {
            _id: GROUP_KEYS[groupBy],
            bookings: { $sum: 1 },
            gmv: sum("vendorServiceValue"),
            customerCollection: sum("customerPrice"),
            vendorCommission: sum("vendor_commission_at_booking"),
            shadowCommission: sum("shadow_vendor_commission"),
            serviceFee: sum("customer_service_fee_at_booking"),
            platformRevenue: sum("platform_revenue_at_booking"),
            variableCost: sum("variable_cost_at_booking"),
            contributionBeforeCac: sum("contribution_before_cac"),
            customerRounding: sum("customer_rounding_adjustment"),
          },
        },
        { $sort: { gmv: -1 } },
      ]),
      Booking.aggregate([
        { $match: { createdAt: { $gte: from, $lte: to }, commercialSnapshot: { $ne: null }, status: "Cancelled" } },
        { $group: { _id: { key: GROUP_KEYS[groupBy], by: "$cancelledBy" }, count: { $sum: 1 } } },
      ]),
      Package.aggregate([
        { $match: { packageStatus: { $in: ["Approved", "Live"] } } },
        { $group: { _id: { $ifNull: ["$commercial.publicationOutcome", "NOT_REVIEWED"] }, packages: { $sum: 1 } } },
      ]),
      CommercialEvent.aggregate([
        { $match: { at: { $gte: from, $lte: to } } },
        { $group: { _id: "$type", count: { $sum: 1 } } },
      ]),
    ]);

    const round = (n) => Math.round(n * 100) / 100;
    res.status(200).json({
      success: true,
      from,
      to,
      groupBy,
      economics: economics.map((g) => ({
        key: g._id,
        ...Object.fromEntries(Object.entries(g).filter(([k]) => k !== "_id").map(([k, v]) => [k, typeof v === "number" ? round(v) : v])),
        serviceFeeRatePct: g.gmv ? round((g.serviceFee / g.gmv) * 100) : null,
        commissionRatePct: g.gmv ? round((g.vendorCommission / g.gmv) * 100) : null,
        contributionMarginPct: g.gmv ? round((g.contributionBeforeCac / g.gmv) * 100) : null,
        cancelledByVendor: cancelled.find((c) => c._id.key === g._id && c._id.by === "Vendor")?.count ?? 0,
        cancelledByCustomer: cancelled.find((c) => c._id.key === g._id && c._id.by === "Customer")?.count ?? 0,
      })),
      approvalFunnel: Object.fromEntries(approvalFunnel.map((r) => [r._id, r.packages])),
      funnelEvents: Object.fromEntries(funnelEvents.map((r) => [r._id, r.count])),
    });
  } catch (error) {
    fail(res, error, "Failed to load commercial analytics");
  }
};

// ── Simulator ─────────────────────────────────────────────────────────────

const numOrNull = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));

/**
 * POST /api/admin/commercial/simulate — runs the engine on hand-entered
 * inputs. Pure: reads the rule set, writes nothing.
 *
 * Body:
 *   vendor   { bookingsLast12Months, yearsOfOperation, teamSize, gstRegistered,
 *              gstRatePct, monetizationModel, successfulBookingsCount, tierOverride }
 *   package  { criticality, vendorB2BPrice, b2cPriceVerified, verifiedVendorB2CPrice,
 *              marketPriceLow, marketPriceMedian, marketPriceHigh, bookingModesSupported }
 *   runtime  { daysToEvent, negotiationMode, eventoryDiscount,
 *              customer{ loggedIn, outstandingBalance, activeZeroPayBookings, completedBookings } }
 *   rules    optional full rule object (as returned by GET /rules) to test edits
 *            before saving them as a draft; omitted -> the active rule set.
 */
export const simulateEngine = async (req, res) => {
  try {
    const { vendor = {}, package: pkg = {}, runtime = {}, rules: rulesOverride } = req.body || {};
    const rules = rulesOverride ? reviveRules(structuredClone(rulesOverride)) : await getActiveRules();

    const demandInputs = {
      bookingsLast12Months: numOrNull(vendor.bookingsLast12Months),
      yearsOfOperation: numOrNull(vendor.yearsOfOperation),
      teamSize: numOrNull(vendor.teamSize),
    };
    let demand = vendorDemand(demandInputs, null, rules);
    if (vendor.tierOverride) demand = { ...demand, computedTier: demand.tier, tier: vendor.tierOverride, overridden: true };

    const vendorB2B = numOrNull(pkg.vendorB2BPrice);
    if (!(vendorB2B > 0)) return bad(res, "package.vendorB2BPrice must be a positive number");
    const supportedModes = pkg.bookingModesSupported?.length ? pkg.bookingModesSupported : rules.bookingModes;

    const publication = evaluatePublication(
      {
        vendor: { gstRegistered: !!vendor.gstRegistered, gstRatePct: numOrNull(vendor.gstRatePct) ?? 18 },
        demand,
        pkg: {
          eventoryApprovedCriticality: pkg.criticality || null,
          vendorB2BPrice: vendorB2B,
          b2cPriceVerified: !!pkg.b2cPriceVerified,
          verifiedVendorB2CPrice: numOrNull(pkg.verifiedVendorB2CPrice),
          marketPriceLow: numOrNull(pkg.marketPriceLow),
          marketPriceMedian: numOrNull(pkg.marketPriceMedian),
          marketPriceHigh: numOrNull(pkg.marketPriceHigh),
          bookingModesSupported: supportedModes,
        },
      },
      rules
    );

    const c = runtime.customer || {};
    const modes = priceAllModes(
      {
        vendor: {
          gstRegistered: !!vendor.gstRegistered,
          gstRatePct: numOrNull(vendor.gstRatePct) ?? 18,
          monetizationModel: vendor.monetizationModel || "COMMISSION",
          successfulBookingsCount: numOrNull(vendor.successfulBookingsCount) ?? 0,
        },
        baseline: publication.baseline,
        runtime: {
          daysToEvent: numOrNull(runtime.daysToEvent),
          negotiationMode: runtime.negotiationMode || "NONE",
          eventoryDiscount: numOrNull(runtime.eventoryDiscount) ?? 0,
          customer: {
            loggedIn: c.loggedIn !== false,
            outstandingBalance: numOrNull(c.outstandingBalance) ?? 0,
            activeZeroPayBookings: numOrNull(c.activeZeroPayBookings) ?? 0,
            completedBookings: numOrNull(c.completedBookings) ?? 0,
          },
        },
      },
      rules
    );

    res.status(200).json({
      success: true,
      rulesSource: rulesOverride ? "OVERRIDE" : "ACTIVE",
      versions: rules.versions,
      assumptions: rules.assumptions ?? [],
      demand,
      publication,
      modes,
    });
  } catch (error) {
    fail(res, error, "Simulation failed");
  }
};

// ── Vendors ───────────────────────────────────────────────────────────────

/** GET /api/admin/commercial/vendors/:vendorId — inputs, demand, tier history. */
export const getVendorCommercial = async (req, res) => {
  try {
    const vendor = await loadVendor(req.params.vendorId);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    const rules = await getActiveRules();
    const history = await VendorCategoryHistory.find({ vendorId: { $in: [vendor.id, String(vendor._id)] } })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.status(200).json({
      success: true,
      vendorId: vendor.id,
      commercial: vendor.commercial || null,
      demandInputs: vendorDemandInputs(vendor),
      demand: resolveVendorDemand(vendor, rules),
      history,
    });
  } catch (error) {
    fail(res, error, "Failed to load vendor commercials");
  }
};

/**
 * PUT /api/admin/commercial/vendors/:vendorId
 * Body: any of VENDOR_FIELDS, plus { by?, reason? }. Recomputes the tier.
 */
export const updateVendorCommercial = async (req, res) => {
  try {
    const { set, error } = pickFields(req.body, VENDOR_FIELDS, "commercial");
    if (error) return bad(res, error);
    if (!Object.keys(set).length) return bad(res, "No commercial fields to update");

    const result = await Vendor.updateOne(vendorFilter(req.params.vendorId), { $set: set });
    if (!result.matchedCount) return res.status(404).json({ success: false, message: "Vendor not found" });

    const vendor = await loadVendor(req.params.vendorId);
    const demand = await refreshVendorTier(vendor, { by: req.body?.by ?? null, reason: req.body?.reason ?? null });
    res.status(200).json({ success: true, commercial: { ...(vendor.commercial || {}) }, demand });
  } catch (error) {
    fail(res, error, "Failed to update vendor commercials");
  }
};

/**
 * PUT /api/admin/commercial/vendors/:vendorId/tier-override
 * Body: { tier: LOW|MODERATE|HIGH|PROVISIONAL|null, reason, by? } — null clears it.
 */
export const setVendorTierOverride = async (req, res) => {
  try {
    const { tier, reason, by } = req.body || {};
    if (!(tier === null || DEMAND_TIERS.includes(tier))) return bad(res, `tier must be one of ${DEMAND_TIERS.join(", ")} or null`);
    if (tier && !reason) return bad(res, "reason is required for an override");

    const result = await Vendor.updateOne(vendorFilter(req.params.vendorId), {
      $set: {
        "commercial.tierOverride": tier
          ? { tier, reason, by: by ?? null, at: new Date() }
          : { tier: null, reason: null, by: null, at: null },
      },
    });
    if (!result.matchedCount) return res.status(404).json({ success: false, message: "Vendor not found" });

    const vendor = await loadVendor(req.params.vendorId);
    const demand = await refreshVendorTier(vendor, { by: by ?? null, reason: reason ?? "Override cleared" });
    res.status(200).json({ success: true, demand });
  } catch (error) {
    fail(res, error, "Failed to set tier override");
  }
};

/** POST /api/admin/commercial/vendors/refresh-all — monthly demand review for every vendor. */
export const refreshAllTiers = async (req, res) => {
  try {
    const summary = await refreshAllVendorTiers({ by: req.body?.by ?? null });
    res.status(200).json({ success: true, ...summary });
  } catch (error) {
    fail(res, error, "Failed to refresh vendor tiers");
  }
};

/** POST /api/admin/commercial/vendors/:vendorId/refresh-tier — monthly review, on demand. */
export const refreshVendorTierNow = async (req, res) => {
  try {
    const vendor = await loadVendor(req.params.vendorId);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    const demand = await refreshVendorTier(vendor, { source: "MONTHLY_REVIEW", by: req.body?.by ?? null });
    res.status(200).json({ success: true, demand });
  } catch (error) {
    fail(res, error, "Failed to refresh vendor tier");
  }
};
