import mongoose from "mongoose";
import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";
import Review from "../models/Review.js";
import Booking from "../models/Booking.js";
import { PUBLIC_VENDOR_FIELDS } from "../utils/publicFields.js";
import { utcDayRange } from "../utils/dateRange.js";
import { computeAvailability } from "../utils/packageAvailability.js";
import { round2 } from "../utils/money.js";
import { resolveVendorForPackage } from "../utils/resolveVendor.js";

/**
 * Public (no-auth), read-only discovery endpoints for the customer side:
 * browse/search Live packages and active vendors. Pure projections over the
 * existing vendor-authored Package/Vendor models — no writes, no new models,
 * no changes to vendor-side controllers/routes.
 *
 * Per the Vendor Page PRD (see info.txt PART 3): customers never see a
 * vendor's direct contact info or verification/KYC internals, so every
 * response here is built from an explicit field whitelist (PUBLIC_VENDOR_FIELDS,
 * src/utils/publicFields.js) rather than projecting the full document —
 * that's enforced here, not left to callers.
 */

/**
 * REAL BUG FOUND during end-to-end testing (2026-08-13, testsuite.pdf): every
 * one of the (then) 8 Live packages in the DB has a Package.vendorId that
 * does NOT hold the Vendor's Mongo _id (what the schema declares/expects —
 * `type: ObjectId, ref: "Vendor"`) but instead holds the Vendor's own
 * separate business-facing `id` string (e.g. "VEN20260511163553528") — a
 * seed-data mismatch, not something introduced here. The practical effect:
 * `.populate("vendorId")` silently leaves vendorId undefined (browsePackages
 * — no crash, just missing vendor info), but `.populate("vendorId").lean()`
 * THROWS a CastError trying to cast that string to an ObjectId (getPackageDetail
 * — a hard 500 on every single Live package's PDP, found via a real curl
 * against the live server, not just reasoning about the code).
 *
 * Fixed here by never relying on populate/$lookup's implicit ObjectId cast
 * for this field: resolve the vendor manually, trying the real relation
 * (Vendor._id) first and falling back to Vendor.id (the string the actual
 * data uses) — this SALVAGES full vendor info instead of merely avoiding
 * the crash, since these business-id strings do correctly resolve to a real
 * Vendor document once looked up on the right field. Moved into
 * src/utils/resolveVendor.js so Wishlist/Compare/Cart/Booking (which hit
 * the exact same crash — see testsuite.pdf) can share one implementation.
 */

/**
 * @desc Browse/search Live packages by event category, vendor type, city,
 * guest count, date availability, and price range.
 */
export const browsePackages = async (req, res) => {
  try {
    const { q, eventCategory, vendorType, city, guests, date, minPrice, maxPrice, sort, page, limit } = req.query;

    const query = { packageStatus: "Live" };

    // Free-text search — added 2026-08-29 for the landing-page search box
    // (frontend's /vendors?q= param already existed and was wired up, but
    // only ever did a client-side substring match over whatever single page
    // of results was already loaded; this makes it a real, server-side,
    // all-results match). Matches a typed keyword against the package name,
    // its event categories, OR its vendor's business name — the same three
    // things a customer would plausibly type ("birthday", "sangeet",
    // "Rohan Caterers"). This is a regex match, not a Mongo text index — same
    // "plain regex over a whitelisted, escaped string" approach every other
    // filter in this controller already uses (city/eventCategory/vendorType
    // below), not a new pattern. Deliberately NOT anchored (unlike
    // eventCategory's `^...$` exact match) since this is meant to match
    // substrings/partial words, not a value picked from a dropdown.
    if (q) {
      const qRegex = { $regex: escapeRegex(q), $options: "i" };
      // Vendor's business name lives on Vendor, not Package — resolve
      // matching vendors first, same two-step pattern the `city` filter
      // below uses. Matched against BOTH Vendor._id and Vendor.id (the
      // business-id string), since Package.vendorId is inconsistently
      // stored as either — see resolveVendorForPackage's own comment on why
      // that mismatch exists across this codebase's seed data.
      const qVendors = await Vendor.find({ businessName: qRegex }).select("_id id");
      const qVendorIds = qVendors.flatMap((v) => [v._id, v.id]).filter(Boolean);

      query.$or = [
        { "step1_eventAndCrew.packageName": qRegex },
        { "step1_eventAndCrew.eventCategories": { $elemMatch: qRegex } },
        ...(qVendorIds.length ? [{ vendorId: { $in: qVendorIds } }] : []),
      ];
    }

    if (vendorType) query.vendorType = vendorType;

    if (eventCategory) {
      query["step1_eventAndCrew.eventCategories"] = {
        $elemMatch: { $regex: `^${escapeRegex(eventCategory)}$`, $options: "i" },
      };
    }

    if (guests) {
      query["step1_eventAndCrew.capacity.minGuests"] = { $lte: guests };
      query["step1_eventAndCrew.capacity.maxGuests"] = { $gte: guests };
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      query["step3_policiesAndCharges.packagePricing.price"] = {
        ...(minPrice !== undefined ? { $gte: minPrice } : {}),
        ...(maxPrice !== undefined ? { $lte: maxPrice } : {}),
      };
    }

    if (date) {
      const { start, end } = utcDayRange(date);
      // Exclude packages explicitly Blocked/Booked on the requested day. A
      // package with no calendar entry for that day is treated as available
      // (best-effort — the vendor's calendar isn't guaranteed exhaustive).
      query.availabilityCalendar = {
        $not: {
          $elemMatch: { date: { $gte: start, $lt: end }, status: { $in: ["Blocked", "Booked"] } },
        },
      };
    }

    // City lives on Vendor, not Package — resolve matching vendors first,
    // then scope the package query to their ids.
    if (city) {
      const vendorIds = await Vendor.find({
        $or: [
          { city: { $regex: `^${escapeRegex(city)}$`, $options: "i" } },
          { serviceAreas: { $regex: escapeRegex(city), $options: "i" } },
        ],
      }).select("_id");
      query.vendorId = { $in: vendorIds.map((v) => v._id) };
    }

    const PACKAGE_FIELDS =
      "vendorId vendorType variantType packageGroupId packageStatus " +
      "step1_eventAndCrew.packageName step1_eventAndCrew.eventCategories " +
      "step1_eventAndCrew.capacity step1_eventAndCrew.duration " +
      "step3_policiesAndCharges.packagePricing step3_policiesAndCharges.gstInclusive " +
      "step3_policiesAndCharges.gstRatePercent step3_policiesAndCharges.guestTiers " +
      "step4_sampleMedia.media createdAt";

    let packages;
    const total = await Package.countDocuments(query);

    if (sort === "rating") {
      // Sorting by the OWNING VENDOR's rating can't be done with a plain
      // .find().sort() — that only sorts on the Package document's own
      // fields, and rating lives on Vendor. $lookup + $sort in one
      // aggregation is the only way to order by a joined field.
      // _rawVendorId preserves the pre-$lookup value (see
      // resolveVendorForPackage's comment) so the fallback pass below can
      // still resolve a vendor for a Package whose vendorId is stored as
      // Vendor.id rather than Vendor._id, which $lookup's exact-field-match
      // silently returns nothing for (not a crash, just empty).
      packages = await Package.aggregate([
        { $match: query },
        { $addFields: { _rawVendorId: "$vendorId" } },
        { $lookup: { from: "vendors", localField: "vendorId", foreignField: "_id", as: "vendorId" } },
        { $unwind: { path: "$vendorId", preserveNullAndEmptyArrays: true } },
        { $sort: { "vendorId.rating": -1, "vendorId.reviewsCount": -1, createdAt: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $project: { ...projectionFromFieldList(PACKAGE_FIELDS, PUBLIC_VENDOR_FIELDS), _rawVendorId: 1 } },
      ]);
    } else {
      const sortMap = {
        newest: { createdAt: -1 },
        price_asc: { "step3_policiesAndCharges.packagePricing.price": 1 },
        price_desc: { "step3_policiesAndCharges.packagePricing.price": -1 },
      };
      // NOT using .populate() here — see resolveVendorForPackage's comment:
      // populate silently drops vendorId to undefined whenever it's stored
      // as Vendor.id rather than Vendor._id, which is true of every
      // currently-seeded Live package. Fetch raw + resolve manually instead
      // so vendor info is never silently missing when it's actually
      // resolvable.
      packages = await Package.find(query)
        .select(PACKAGE_FIELDS)
        .sort(sortMap[sort] || sortMap.newest)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();
    }

    // Fallback vendor resolution — covers both paths above: the "rating"
    // aggregate's $lookup miss (vendorId still an empty object after
    // $unwind) and the plain find()'s un-populated raw vendorId.
    await Promise.all(
      packages.map(async (pkg) => {
        const alreadyResolved = pkg.vendorId && typeof pkg.vendorId === "object" && pkg.vendorId.businessName;
        if (alreadyResolved) return;
        const raw = pkg._rawVendorId ?? pkg.vendorId;
        pkg.vendorId = await resolveVendorForPackage(raw);
        delete pkg._rawVendorId;
      })
    );

    return res.status(200).json({
      status: "SUCCESS",
      count: packages.length,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      packages,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to browse packages", error: error.message });
  }
};

// Bookings that never actually happened don't signal real customer demand —
// excluded from the popularity count below. Deliberately NOT reusing
// Booking.js's own exported TERMINAL_STATUSES (["Declined","Cancelled",
// "Completed"]): a Completed booking is exactly the kind of real, finished
// purchase that SHOULD count toward "often booked", so only the two
// statuses that mean "this booking never went through" are excluded here.
const EXCLUDED_FROM_POPULARITY_COUNT = ["Declined", "Cancelled"];

/**
 * @desc Landing page's "Packages Often Booked by our Customers" carousel —
 * previously fully static/hardcoded on the frontend (no backend logic
 * existed for this at all). Ranks Live packages by real booking volume:
 * counts actual Booking documents per packageId (excluding ones that never
 * really happened — see EXCLUDED_FROM_POPULARITY_COUNT above), highest
 * count first, then re-fetches those packageIds as full Package documents
 * so the response is the SAME shape browsePackages already returns (same
 * PACKAGE_FIELDS projection + PUBLIC_VENDOR_FIELDS-whitelisted, resolved
 * vendor) — deliberately, so the frontend can reuse its existing
 * mapPackageToVendor/ProductCard mapping as-is, no new shape to learn.
 *
 * FALLBACK (same reasoning as getPdpReviewsSection's usingVendorFallback,
 * applied here for the same underlying reason — real signal may not exist
 * yet): if fewer than `limit` packages have any qualifying booking at all
 * (there are currently very few real bookings in the dev DB, and a
 * brand-new package has never been booked by definition), the remainder is
 * filled with the newest Live packages instead, so the carousel is never
 * emptier than `limit` just because "often booked" data hasn't accumulated
 * yet. `usingFallback: true` on the response tells the frontend when this
 * happened, in case it wants to visually distinguish "real popularity" from
 * "filler" — using it is optional, the endpoint works fine either way.
 */
export const getPopularPackages = async (req, res) => {
  try {
    const { limit } = req.query;

    const ranked = await Booking.aggregate([
      { $match: { status: { $nin: EXCLUDED_FROM_POPULARITY_COUNT } } },
      { $group: { _id: "$packageId", bookingCount: { $sum: 1 } } },
      { $sort: { bookingCount: -1 } },
      // Overfetch — some of the top-booked packageIds may no longer be Live
      // (paused/deleted since being booked), filtered out below once
      // resolved against the real Package collection.
      { $limit: Math.max(limit * 3, 30) },
    ]);

    const PACKAGE_FIELDS =
      "vendorId vendorType variantType packageGroupId packageStatus " +
      "step1_eventAndCrew.packageName step1_eventAndCrew.eventCategories " +
      "step1_eventAndCrew.capacity step1_eventAndCrew.duration " +
      "step3_policiesAndCharges.packagePricing step3_policiesAndCharges.gstInclusive " +
      "step3_policiesAndCharges.gstRatePercent step3_policiesAndCharges.guestTiers " +
      "step4_sampleMedia.media createdAt";

    const rankedIds = ranked.map((r) => r._id);
    const rankedPackages = rankedIds.length
      ? await Package.find({ _id: { $in: rankedIds }, packageStatus: "Live" })
          .select(PACKAGE_FIELDS)
          .lean()
      : [];

    // Package.find({$in:...}) does not preserve `rankedIds`' order — restore
    // the real booking-count ranking (highest first) before trimming to
    // `limit`. Tied on bookingCount -> newer package first (same
    // "highest-first, then most-recent" tiebreak convention already used
    // elsewhere, e.g. computeReviewAggregate's rating desc/createdAt desc)
    // rather than leaving ties to Mongo's unspecified group order.
    const countByPackageId = new Map(ranked.map((r) => [String(r._id), r.bookingCount]));
    rankedPackages.sort((a, b) => {
      const byCount = (countByPackageId.get(String(b._id)) || 0) - (countByPackageId.get(String(a._id)) || 0);
      if (byCount !== 0) return byCount;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    let packages = rankedPackages.slice(0, limit);
    let usingFallback = false;

    if (packages.length < limit) {
      usingFallback = true;
      const usedIds = new Set(packages.map((p) => String(p._id)));
      const fillerPackages = await Package.find({
        packageStatus: "Live",
        _id: { $nin: [...usedIds] },
      })
        .select(PACKAGE_FIELDS)
        .sort({ createdAt: -1 })
        .limit(limit - packages.length)
        .lean();
      packages = [...packages, ...fillerPackages];
    }

    await Promise.all(
      packages.map(async (pkg) => {
        pkg.vendorId = await resolveVendorForPackage(pkg.vendorId);
      })
    );

    return res.status(200).json({ status: "SUCCESS", count: packages.length, usingFallback, packages });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch popular packages", error: error.message });
  }
};

/**
 * @desc PDP (package detail): the full Live package (event/crew details,
 * products & pricing incl. add-ons, policies, media) plus three computed
 * sections layered on top — availability, a price preview, and reviews.
 * Public, no auth. 404s (rather than showing Draft/Under Review internals)
 * if the package doesn't exist or isn't Live.
 */
export const getPackageDetail = async (req, res) => {
  try {
    const { packageId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(packageId)) {
      return res.status(400).json({ status: "FAILED", message: "Invalid packageId" });
    }

    // NOT using .populate() — see resolveVendorForPackage's comment: with
    // .lean(), populate() actually THROWS (a 500) when vendorId is stored
    // as Vendor.id rather than Vendor._id, which real-world testing found
    // is true of every currently-seeded Live package. Fetch raw + resolve
    // manually instead.
    const pkg = await Package.findOne({ _id: packageId, packageStatus: "Live" })
      .select("-__v")
      .lean();

    if (!pkg) {
      return res.status(404).json({ status: "FAILED", message: "Package not found or not currently available" });
    }
    pkg.vendorId = await resolveVendorForPackage(pkg.vendorId);

    const { date, guests, time } = req.query;
    const [availability, pricingPreview, reviews] = await Promise.all([
      computeAvailability(pkg, { date, guests, time }),
      Promise.resolve(computePricingPreview(pkg, { date, guests })),
      getPdpReviewsSection(pkg),
    ]);

    return res.status(200).json({
      status: "SUCCESS",
      package: pkg,
      availability,
      pricingPreview,
      reviews,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch package detail", error: error.message });
  }
};

// computeAvailability moved to src/utils/packageAvailability.js (Phase 3
// Step 13) so Cart's revalidation can reuse the exact same logic instead of
// a second, potentially-drifting copy — imported at the top of this file.

// Preview only — NOT the authoritative price. Phase 3/4 (cart/checkout
// pricing engine, already scoped in info.txt) recomputes server-side before
// any charge; this exists so the PDP can show a realistic estimate for the
// guest count/date the customer is looking at.
function computePricingPreview(pkg, { date, guests }) {
  const pricing = pkg.step3_policiesAndCharges || {};
  const basePricing = pricing.packagePricing || {};
  let amount = basePricing.price ?? null;
  const billingUnit = basePricing.billingUnit ?? null;

  let guestTierApplied = null;
  if (guests !== undefined && Array.isArray(pricing.guestTiers) && pricing.guestTiers.length) {
    const sorted = [...pricing.guestTiers].sort((a, b) => (a.maxGuests ?? Infinity) - (b.maxGuests ?? Infinity));
    const tier = sorted.find((t) => t.maxGuests == null || guests <= t.maxGuests);
    if (tier && tier.price != null) {
      amount = tier.price;
      guestTierApplied = { maxGuests: tier.maxGuests, price: tier.price };
    }
  }

  let appliedAdjustment = null;
  const unappliedToggles = [];

  if (date && amount != null) {
    const target = new Date(date);

    // Explicit fixed-price override for a date range — shared base-schema
    // field (documented "PAV specific" in the model comment, but present
    // for every vendor type), so it's the highest-precedence signal: it's
    // the one place a vendor sets an actual price, not just a percentage.
    const rangeOverride = (pricing.dateRangeDynamicPricing || []).find(
      (r) => r.fromDate && r.toDate && target >= new Date(r.fromDate) && target <= new Date(r.toDate)
    );

    const dyn = pricing.dynamicPricing || {};

    if (rangeOverride) {
      amount = rangeOverride.price;
      appliedAdjustment = { source: "dateRangeDynamicPricing", price: rangeOverride.price };
    } else if (dyn.customDates?.enabled && dyn.customDates.startDate && dyn.customDates.endDate) {
      const start = new Date(dyn.customDates.startDate);
      const end = new Date(dyn.customDates.endDate);
      if (!isNaN(start) && !isNaN(end) && target >= start && target <= end) {
        if (dyn.customDates.price != null) {
          amount = dyn.customDates.price;
          appliedAdjustment = { source: "customDates", price: dyn.customDates.price };
        } else if (dyn.customDates.percentage != null) {
          amount = round2(amount * (1 + dyn.customDates.percentage / 100));
          appliedAdjustment = { source: "customDates", percentage: dyn.customDates.percentage };
        }
      }
    } else if (dyn.weekends?.enabled && [0, 6].includes(target.getUTCDay())) {
      if (dyn.weekends.price != null) {
        amount = dyn.weekends.price;
        appliedAdjustment = { source: "weekend", price: dyn.weekends.price };
      } else if (dyn.weekends.percentage != null) {
        amount = round2(amount * (1 + dyn.weekends.percentage / 100));
        appliedAdjustment = { source: "weekend", percentage: dyn.weekends.percentage };
      }
    }

    // weddingSeason/festivals toggles exist on the schema but neither one
    // carries a date range to evaluate against (weddingSeason has no
    // start/end fields at all; festivals.details is untyped Mixed) — so
    // there is no reliable way to tell if `date` falls inside either one.
    // Surfaced here rather than guessed at with a hardcoded date range.
    if (dyn.weddingSeason?.enabled) {
      unappliedToggles.push("weddingSeason is enabled on this package but has no date range in the data to evaluate against — not applied.");
    }
    if (dyn.festivals?.enabled) {
      unappliedToggles.push("festivals is enabled on this package but has no structured date range to evaluate against — not applied.");
    }
  }

  const subtotal = amount != null ? round2(amount) : null;
  const gstInclusive = !!pricing.gstInclusive;
  const gstRatePercent = pricing.gstRatePercent ?? null;

  let gstAmount = null;
  let total = subtotal;
  if (subtotal != null && gstRatePercent != null) {
    gstAmount = gstInclusive ? round2(subtotal - subtotal / (1 + gstRatePercent / 100)) : round2((subtotal * gstRatePercent) / 100);
    total = gstInclusive ? subtotal : round2(subtotal + gstAmount);
  }

  return {
    basePrice: basePricing.price ?? null,
    billingUnit,
    guestTierApplied,
    appliedAdjustment,
    unappliedToggles,
    subtotal,
    gstInclusive,
    gstRatePercent,
    gstAmount,
    total,
    note: "Preview estimate only — the authoritative price is recomputed server-side at checkout (Phase 3/4), never trusted from this response.",
  };
}

// Package-level reviews embedded in the PDP response (Step 8) — top 10 +
// a simple average, falling back to the vendor's overall rating/
// reviewsCount when this specific package has none yet. Kept deliberately
// lightweight; getPackageReviews (Step 9, below) is the dedicated
// paginated/filterable/sortable "see all reviews" endpoint with the full
// rating-distribution + category breakdown this one doesn't compute.
async function getPdpReviewsSection(pkg) {
  const [items, aggregate] = await Promise.all([
    Review.find({ packageId: pkg._id, status: "Published" })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate({ path: "customerId", select: "name profilePicture" })
      .lean(),
    Review.aggregate([
      { $match: { packageId: pkg._id, status: "Published" } },
      { $group: { _id: null, avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]),
  ]);

  if (aggregate[0]?.count) {
    return {
      items,
      count: aggregate[0].count,
      averageRating: round2(aggregate[0].avgRating),
      usingVendorFallback: false,
    };
  }

  const vendor = pkg.vendorId; // already populated with PUBLIC_VENDOR_FIELDS
  return {
    items: [],
    count: vendor?.reviewsCount ?? 0,
    averageRating: vendor?.rating ?? null,
    usingVendorFallback: true,
  };
}

// timeWithinSlot/parseTimeToMinutes moved into src/utils/packageAvailability.js
// (only computeAvailability needs them); utcDayRange -> src/utils/dateRange.js;
// round2 -> src/utils/money.js. All imported at the top of this file.

// Shared by getVendorReviews and getPackageReviews below: average rating,
// count, a 1-5 star histogram, and a per-category breakdown computed from
// whatever categoryRatings keys actually appear in the matched reviews (see
// Review.js for why there's no fixed category list to group by instead).
async function computeReviewAggregate(match) {
  const [result] = await Review.aggregate([
    { $match: match },
    {
      $facet: {
        summary: [{ $group: { _id: null, averageRating: { $avg: "$rating" }, count: { $sum: 1 } } }],
        distribution: [{ $group: { _id: "$rating", count: { $sum: 1 } } }],
        categoryBreakdown: [
          { $match: { categoryRatings: { $exists: true } } },
          { $project: { categoryRatings: { $objectToArray: "$categoryRatings" } } },
          { $unwind: "$categoryRatings" },
          { $group: { _id: "$categoryRatings.k", averageRating: { $avg: "$categoryRatings.v" }, count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ]);

  const summary = result.summary[0] || { averageRating: null, count: 0 };
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const bucket of result.distribution) distribution[bucket._id] = bucket.count;

  return {
    averageRating: round2(summary.averageRating),
    count: summary.count,
    distribution,
    categoryBreakdown: result.categoryBreakdown.map((c) => ({
      category: c._id,
      averageRating: round2(c.averageRating),
      count: c.count,
    })),
  };
}

/**
 * @desc Sibling variants of one logical package (packageGroupId) — the PDP's
 * "Standard / Premium / Deluxe" variant picker. Added for the 2026-08-17
 * PDP handoff: the frontend was calling the VENDOR-management router's
 * internal GET /api/packages/group/:packageGroupId as a stopgap (their own
 * code comment flagged this — "no /customer counterpart exists ... used
 * here strictly as a stopgap"), which is a real problem, not just a style
 * issue: that route has no packageStatus filter at all, so a customer could
 * see Draft/Under Review/Deleted sibling variants alongside Live ones, and
 * it returns the full raw document with no vendor field whitelist. This
 * endpoint is the proper customer-safe replacement: Live-only, same
 * resolveVendorForPackage handling as every other customer discovery route.
 * Public, no auth — same as every other package read here.
 */
export const getPackageGroupVariants = async (req, res) => {
  try {
    const { packageGroupId } = req.params;
    if (!packageGroupId || !String(packageGroupId).trim()) {
      return res.status(400).json({ status: "FAILED", message: "Invalid packageGroupId" });
    }

    const PACKAGE_FIELDS =
      "vendorId vendorType variantType packageGroupId packageStatus " +
      "step1_eventAndCrew.packageName step1_eventAndCrew.eventCategories " +
      "step1_eventAndCrew.capacity step1_eventAndCrew.duration " +
      "step2_productsAndPricing.setups step3_policiesAndCharges.packagePricing " +
      "step3_policiesAndCharges.gstInclusive step3_policiesAndCharges.gstRatePercent " +
      "step4_sampleMedia.media createdAt";

    const packages = await Package.find({ packageGroupId, packageStatus: "Live" })
      .select(PACKAGE_FIELDS)
      .sort({ createdAt: 1 })
      .lean();

    if (packages.length === 0) {
      return res.status(404).json({ status: "FAILED", message: "No Live variants found for this package group" });
    }

    await Promise.all(
      packages.map(async (pkg) => {
        pkg.vendorId = await resolveVendorForPackage(pkg.vendorId);
      })
    );

    return res.status(200).json({ status: "SUCCESS", count: packages.length, packageGroupId, packages });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch package group variants", error: error.message });
  }
};

/**
 * @desc Single vendor's public profile — REAL GAP FOUND 2026-08-21 while
 * auditing the Cart page (Eventory_V2_frontend's src/lib/vendorPublicApi.ts,
 * used by customer-cart's getCartPageData.ts to resolve a vendorName/avatar
 * per cart line). No /customer/vendors/:id endpoint existed, so the
 * frontend was calling the VENDOR-MANAGEMENT router's internal
 * GET /vendors/:id (its own code comment says as much) — confirmed via a
 * live call that WITHOUT its optional ?select= param, that route returns
 * the FULL vendor document: phone, email, bankDetails, aadharNumber,
 * panNumber, gstNumber, gstCertificate/fssaiLicense/tradeLicense document
 * URLs, agreementDocUrl, faceMatchScore — the entire KYC/banking surface,
 * on a public unauthenticated route, only "safe" today because every
 * current caller happens to always pass the right ?select=. This endpoint
 * is the proper, safe replacement: server-enforced PUBLIC_VENDOR_FIELDS,
 * never a client-controlled field list.
 */
export const getVendorDetail = async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!vendorId || !String(vendorId).trim()) {
      return res.status(400).json({ status: "FAILED", message: "Invalid vendorId" });
    }

    const query = mongoose.Types.ObjectId.isValid(vendorId)
      ? { $or: [{ _id: vendorId }, { id: vendorId }], isDeactivated: { $ne: true } }
      : { id: vendorId, isDeactivated: { $ne: true } };

    const vendor = await Vendor.findOne(query)
      .select(PUBLIC_VENDOR_FIELDS)
      .lean();

    if (!vendor) {
      return res.status(404).json({ status: "FAILED", message: "Vendor not found" });
    }

    return res.status(200).json({ status: "SUCCESS", vendor });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch vendor", error: error.message });
  }
};

/**
 * @desc Standalone, paginated/filterable/sortable review listing for a
 * vendor (across every one of their packages) — the "Review Page" /
 * vendor-profile use case the PDP's embedded top-10 (Step 8) doesn't cover.
 * Public, no auth.
 */
export const getVendorReviews = async (req, res) => {
  try {
    const { vendorId } = req.params;
    if (!vendorId || !String(vendorId).trim()) {
      return res.status(400).json({ status: "FAILED", message: "Invalid vendorId" });
    }

    const { minRating, sort, page, limit } = req.query;
    const match = { vendorId: String(vendorId), status: "Published" };
    if (minRating) match.rating = { $gte: minRating };

    const sortMap = {
      recent: { createdAt: -1 },
      highest: { rating: -1, createdAt: -1 },
      lowest: { rating: 1, createdAt: -1 },
    };

    const [items, total, aggregate] = await Promise.all([
      Review.find(match)
        .sort(sortMap[sort])
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({ path: "customerId", select: "name profilePicture" })
        .populate({ path: "packageId", select: "step1_eventAndCrew.packageName" })
        .lean(),
      Review.countDocuments(match),
      computeReviewAggregate(match),
    ]);

    return res.status(200).json({
      status: "SUCCESS",
      count: items.length,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items,
      aggregate,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch vendor reviews", error: error.message });
  }
};

/**
 * @desc Standalone, paginated/filterable/sortable review listing for one
 * package — same shape as getVendorReviews, scoped narrower. Public, no
 * auth. Distinct from the PDP's embedded reviews section (Step 8): this is
 * the dedicated "see all reviews" page, with real pagination/sort/filter
 * and the full distribution + category breakdown.
 */
export const getPackageReviews = async (req, res) => {
  try {
    const { packageId } = req.params;
    if (!packageId || !String(packageId).trim()) {
      return res.status(400).json({ status: "FAILED", message: "Invalid packageId" });
    }

    const { minRating, sort, page, limit } = req.query;
    const match = { packageId: String(packageId), status: "Published" };
    if (minRating) match.rating = { $gte: minRating };

    const sortMap = {
      recent: { createdAt: -1 },
      highest: { rating: -1, createdAt: -1 },
      lowest: { rating: 1, createdAt: -1 },
    };

    const [items, total, aggregate] = await Promise.all([
      Review.find(match)
        .sort(sortMap[sort])
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({ path: "customerId", select: "name profilePicture" })
        .lean(),
      Review.countDocuments(match),
      computeReviewAggregate(match),
    ]);

    return res.status(200).json({
      status: "SUCCESS",
      count: items.length,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      items,
      aggregate,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch package reviews", error: error.message });
  }
};

/**
 * @desc Site-wide "Loved by X Happy Customers" carousel on the landing page
 * — the top N Published reviews across the WHOLE platform, not scoped to
 * one package/vendor (getVendorReviews/getPackageReviews above are both
 * scoped). Requested by the frontend team as GET
 * /customer/reviews/featured?limit=8&minRating=4 — built exactly to their
 * own proposed spec (see getFeaturedReviews's doc comment in
 * customerDiscoveryApi.ts on the frontend), used verbatim rather than
 * inventing a different shape. Public, no auth, read-only.
 *
 * Response is pre-flattened per that spec — { status, items: [{ _id,
 * rating, comment, createdAt, customerName, customerAvatar, packageName }] }
 * — deliberately NOT the same shape as getVendorReviews/getPackageReviews
 * (full populated docs + pagination + aggregate): this is a small,
 * fixed-size carousel feed, not a paginated "see all reviews" listing, so
 * there's no total/page/aggregate to report.
 *
 * Sort is fixed (rating desc, then createdAt desc — "highest-rated, most
 * recent" per the spec), not a query param — unlike getVendorReviews/
 * getPackageReviews's user-selectable recent/highest/lowest, a curated
 * carousel has one obvious ordering, not several.
 *
 * NOTE (flagged by the frontend team, not something to fix here — a
 * separate, not-yet-built step per Review.js's own doc comment): there is
 * no review-SUBMISSION endpoint yet, so customer_reviews may currently hold
 * few or zero real entries. An empty/short items[] is therefore expected
 * behaviour right now, not a bug in this endpoint — callers should fall
 * back to static content until real reviews start flowing in.
 */
export const getFeaturedReviews = async (req, res) => {
  try {
    const { limit, minRating } = req.query;
    const match = { status: "Published" };
    if (minRating) match.rating = { $gte: minRating };

    const reviews = await Review.find(match)
      .sort({ rating: -1, createdAt: -1 })
      .limit(limit)
      .populate({ path: "customerId", select: "name profilePicture" })
      .populate({ path: "packageId", select: "step1_eventAndCrew.packageName" })
      .lean();

    const items = reviews.map((r) => ({
      _id: r._id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      customerName: r.customerId?.name || null,
      customerAvatar: r.customerId?.profilePicture || null,
      packageName: r.packageId?.step1_eventAndCrew?.packageName || null,
    }));

    return res.status(200).json({ status: "SUCCESS", items });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch featured reviews", error: error.message });
  }
};

/**
 * @desc Facet/taxonomy endpoint for the package listing page's filter UI:
 * the actual distinct values live inventory currently has, not a hardcoded
 * list. Nothing in this repo defines a static master taxonomy (no shared
 * enum of event categories/cities exists on the backend — see info.txt
 * PART 3), so deriving facets from real Live packages/active vendors is the
 * only option that doesn't fabricate data that might not match what's
 * actually bookable.
 */
export const getPackageFilters = async (req, res) => {
  try {
    const [facets] = await Package.aggregate([
      { $match: { packageStatus: "Live" } },
      {
        $facet: {
          eventCategories: [
            { $unwind: "$step1_eventAndCrew.eventCategories" },
            { $group: { _id: "$step1_eventAndCrew.eventCategories" } },
            { $sort: { _id: 1 } },
          ],
          vendorTypes: [{ $group: { _id: "$vendorType" } }, { $sort: { _id: 1 } }],
          priceRange: [
            {
              $group: {
                _id: null,
                min: { $min: "$step3_policiesAndCharges.packagePricing.price" },
                max: { $max: "$step3_policiesAndCharges.packagePricing.price" },
              },
            },
          ],
          guestRange: [
            {
              $group: {
                _id: null,
                minGuests: { $min: "$step1_eventAndCrew.capacity.minGuests" },
                maxGuests: { $max: "$step1_eventAndCrew.capacity.maxGuests" },
              },
            },
          ],
          vendorIds: [{ $group: { _id: "$vendorId" } }],
        },
      },
    ]);

    // .filter(Boolean) alone isn't enough here — it drops null/undefined
    // but not a malformed vendorId (e.g. a stray business-id string like
    // "VEN20260512181520098" instead of a real ObjectId, however it got
    // there). Package.vendorId is a ref, not a validated foreign key, so
    // Mongoose never enforces the shape on write — one bad document was
    // enough to make Vendor.distinct's $in cast throw and 500 this shared
    // filters endpoint for every customer. Reported by the frontend team
    // 2026-08-13, confirmed against the actual error/code, fixed by
    // validating shape before it ever reaches the query.
    const vendorIds = facets.vendorIds.map((v) => v._id).filter((id) => mongoose.Types.ObjectId.isValid(id));
    const cities = vendorIds.length ? await Vendor.distinct("city", { _id: { $in: vendorIds }, city: { $nin: [null, ""] } }) : [];

    return res.status(200).json({
      status: "SUCCESS",
      filters: {
        eventCategories: facets.eventCategories.map((f) => f._id),
        vendorTypes: facets.vendorTypes.map((f) => f._id),
        cities: cities.sort(),
        priceRange: facets.priceRange[0] || { min: null, max: null },
        guestRange: facets.guestRange[0] || { minGuests: null, maxGuests: null },
        sortOptions: ["newest", "price_asc", "price_desc", "rating"],
      },
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch package filters", error: error.message });
  }
};

/**
 * @desc Facet/taxonomy endpoint for the vendor listing page's filter UI —
 * same "derive from real data" reasoning as getPackageFilters.
 */
export const getVendorFilters = async (req, res) => {
  try {
    const [facets] = await Vendor.aggregate([
      { $match: { isDeactivated: { $ne: true } } },
      {
        $facet: {
          vendorTypes: [
            { $match: { vendorType: { $nin: [null, ""] } } },
            { $group: { _id: "$vendorType" } },
            { $sort: { _id: 1 } },
          ],
          eventCategories: [
            { $unwind: "$eventCategories" },
            { $group: { _id: "$eventCategories" } },
            { $sort: { _id: 1 } },
          ],
          cities: [{ $match: { city: { $nin: [null, ""] } } }, { $group: { _id: "$city" } }, { $sort: { _id: 1 } }],
        },
      },
    ]);

    return res.status(200).json({
      status: "SUCCESS",
      filters: {
        vendorTypes: facets.vendorTypes.map((f) => f._id),
        eventCategories: facets.eventCategories.map((f) => f._id),
        cities: facets.cities.map((f) => f._id),
        sortOptions: ["rating", "newest"],
        // "response-rate" sort is NOT offered: Vendor.js has no responseRate
        // (or equivalent) field to sort on. Adding one is a Vendor schema
        // change — vendor-authored code — so this is flagged in info.txt
        // rather than invented here.
      },
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch vendor filters", error: error.message });
  }
};

/**
 * @desc Browse/search active (non-deactivated) vendors by type, event
 * category, and city.
 */
export const browseVendors = async (req, res) => {
  try {
    const { vendorType, eventCategory, city, sort, page, limit } = req.query;

    // $ne: true (not a strict isDeactivated: false) — most existing Vendor
    // documents predate this field and simply don't have it set, and an
    // absent field must not be read as "deactivated".
    const query = { isDeactivated: { $ne: true } };

    if (vendorType) query.vendorType = { $regex: `^${escapeRegex(vendorType)}$`, $options: "i" };
    if (eventCategory) {
      query.eventCategories = { $elemMatch: { $regex: `^${escapeRegex(eventCategory)}$`, $options: "i" } };
    }
    if (city) {
      query.$or = [
        { city: { $regex: `^${escapeRegex(city)}$`, $options: "i" } },
        { serviceAreas: { $regex: escapeRegex(city), $options: "i" } },
      ];
    }

    const sortMap = {
      rating: { rating: -1, reviewsCount: -1 },
      newest: { createdAt: -1 },
    };

    const [vendors, total] = await Promise.all([
      Vendor.find(query)
        .select(PUBLIC_VENDOR_FIELDS)
        .sort(sortMap[sort] || sortMap.rating)
        .skip((page - 1) * limit)
        .limit(limit),
      Vendor.countDocuments(query),
    ]);

    return res.status(200).json({
      status: "SUCCESS",
      count: vendors.length,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      vendors,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to browse vendors", error: error.message });
  }
};

// Builds a Mongo aggregation $project stage from the same space-separated
// field-list strings .select() takes, so the rating-sort aggregation branch
// returns exactly the same shape as the normal .find().select().populate()
// path above (dot-paths become nested $project objects; "vendorId" is
// special-cased since $lookup already replaced it with a joined
// sub-document that needs its own field whitelist, not a passthrough).
function projectionFromFieldList(packageFields, vendorFields) {
  const project = {};
  for (const field of packageFields.split(/\s+/).filter(Boolean)) {
    setDeep(project, field.split("."), 1);
  }
  for (const field of vendorFields.split(/\s+/).filter(Boolean)) {
    setDeep(project, ["vendorId", ...field.split(".")], 1);
  }
  return project;
}

function setDeep(obj, path, value) {
  const [head, ...rest] = path;
  if (rest.length === 0) {
    obj[head] = value;
  } else {
    obj[head] = typeof obj[head] === "object" ? obj[head] : {};
    setDeep(obj[head], rest, value);
  }
}

// Escapes regex metacharacters in user-supplied filter strings before they're
// interpolated into a $regex — otherwise a filter value like "a.*" or "(" is
// treated as a pattern instead of a literal, either erroring or matching far
// more broadly than the customer typed.
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
