import mongoose from "mongoose";
import CompareSession from "../models/CompareSession.js";
import Package from "../models/Package.js";
import { PUBLIC_VENDOR_FIELDS } from "../utils/publicFields.js";
import { resolveVendorForPackage } from "../utils/resolveVendor.js";
import { getEffectivePackagePrice } from "../utils/packagePrice.js";

/**
 * Compare-up-to-3-packages — Phase 2 Step 11. Packages only (see
 * CompareSession.js for why not Vendors/Essentials), one vendorType per
 * session (comparing across categories isn't a meaningful comparison, since
 * each vendor type's step2_productsAndPricing shape is entirely
 * different). All routes require protectCustomer.
 */

const COMPARE_PACKAGE_FIELDS =
  "vendorId vendorType variantType packageStatus step1_eventAndCrew step2_productsAndPricing " +
  "step3_policiesAndCharges step4_sampleMedia.media createdAt";

async function getOrCreateSession(customerId) {
  let session = await CompareSession.findOne({ customerId });
  if (!session) {
    session = await CompareSession.create({ customerId, packageIds: [] });
  }
  return session;
}

// Turns a raw, populated CompareSession into the side-by-side comparison
// table the frontend renders. "Normalized" covers the attributes that mean
// the same thing across every vendor type (price, capacity, duration,
// policy, media, vendor identity) — step2_productsAndPricing is passed
// through as-is under categorySpecificDetails rather than force-normalized,
// since its shape genuinely differs per vendor type and flattening it would
// either lose information or fabricate a false equivalence between, say, a
// Caterer's menus and a DJ's equipment list.
function buildComparisonPayload(packages) {
  const items = packages.map((pkg) => {
    const pricing = pkg.step3_policiesAndCharges?.packagePricing || {};
    const cap = pkg.step1_eventAndCrew?.capacity || {};
    const dur = pkg.step1_eventAndCrew?.duration || {};
    const cancellation = pkg.step3_policiesAndCharges?.cancellationPolicy;

    return {
      packageId: pkg._id,
      packageName: pkg.step1_eventAndCrew?.packageName || null,
      variantType: pkg.variantType,
      vendorType: pkg.vendorType,
      eventCategories: pkg.step1_eventAndCrew?.eventCategories || [],
      vendor: pkg.vendorId
        ? {
            id: pkg.vendorId.id,
            businessName: pkg.vendorId.businessName,
            rating: pkg.vendorId.rating,
            reviewsCount: pkg.vendorId.reviewsCount,
            city: pkg.vendorId.city,
          }
        : null,
      price: {
        // getEffectivePackagePrice — see that util's comment: a plain
        // pricing.price read shows ₹0/null for every Caterer/Decorator
        // package in the compare table. Found 2026-09-03 while auditing
        // every other packagePricing read site for the same gap.
        amount: getEffectivePackagePrice(pkg),
        billingUnit: pricing.billingUnit ?? pkg.step3_policiesAndCharges?.teamAndEquipment?.billingUnit ?? null,
        gstInclusive: !!pkg.step3_policiesAndCharges?.gstInclusive,
        gstRatePercent: pkg.step3_policiesAndCharges?.gstRatePercent ?? null,
      },
      capacity: { minGuests: cap.minGuests ?? null, maxGuests: cap.maxGuests ?? null },
      duration: { minHours: dur.minHours ?? null, maxHours: dur.maxHours ?? null },
      coverImage: pkg.step4_sampleMedia?.media?.[0]?.url || null,
      cancellationPolicySummary: cancellation
        ? cancellation.templateTitle || (cancellation.writtenText ? cancellation.writtenText.slice(0, 200) : null)
        : null,
      // Deliberately NOT normalized — passed through as-is, see the note above.
      categorySpecificDetails: pkg.step2_productsAndPricing || {},
    };
  });

  return {
    vendorType: packages[0]?.vendorType || null,
    count: items.length,
    items,
  };
}

async function loadComparisonForSession(session) {
  if (session.packageIds.length === 0) return { vendorType: null, count: 0, items: [] };
  // NOT using .populate("vendorId") — see src/utils/resolveVendor.js: every
  // currently-seeded Package.vendorId fails that populate's implicit
  // ObjectId cast (real bug found via end-to-end testing, testsuite.pdf).
  // Resolved manually below instead.
  const packages = await Package.find({ _id: { $in: session.packageIds } })
    .select(COMPARE_PACKAGE_FIELDS)
    .lean();
  await Promise.all(
    packages.map(async (pkg) => {
      pkg.vendorId = await resolveVendorForPackage(pkg.vendorId);
    })
  );
  // Preserve the order the customer added items in, not Mongo's return order.
  const byId = new Map(packages.map((p) => [String(p._id), p]));
  const ordered = session.packageIds.map((id) => byId.get(String(id))).filter(Boolean);
  return buildComparisonPayload(ordered);
}

/**
 * @desc Get the logged-in customer's current comparison.
 */
export const getCompare = async (req, res) => {
  try {
    const session = await getOrCreateSession(req.customer._id);
    const comparison = await loadComparisonForSession(session);
    return res.status(200).json({ status: "SUCCESS", ...comparison });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch comparison", error: error.message });
  }
};

/**
 * @desc Add a package to the comparison (max 3, single vendorType).
 */
export const addCompareItem = async (req, res) => {
  try {
    const { packageId } = req.body;

    const pkg = await Package.findOne({ _id: packageId, packageStatus: "Live" }).select("vendorType");
    if (!pkg) {
      return res.status(404).json({ status: "FAILED", message: "Package not found or not currently available" });
    }

    const session = await getOrCreateSession(req.customer._id);

    if (session.packageIds.some((id) => String(id) === packageId)) {
      return res.status(409).json({ status: "FAILED", message: "This package is already in your comparison" });
    }
    if (session.packageIds.length >= 3) {
      return res.status(409).json({ status: "FAILED", message: "Comparison is full — remove an item first (max 3)" });
    }
    if (session.packageIds.length > 0) {
      const existing = await Package.findById(session.packageIds[0]).select("vendorType").lean();
      if (existing && existing.vendorType !== pkg.vendorType) {
        return res.status(409).json({
          status: "FAILED",
          message: `Your comparison already contains ${existing.vendorType} packages — clear it first to compare a different category`,
        });
      }
    }

    session.packageIds.push(String(packageId));
    await session.save();

    const comparison = await loadComparisonForSession(session);
    return res.status(201).json({ status: "SUCCESS", message: "Added to comparison", ...comparison });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to add to comparison", error: error.message });
  }
};

/**
 * @desc Remove one package from the comparison.
 */
export const removeCompareItem = async (req, res) => {
  try {
    const { packageId } = req.params;
    if (!packageId || !String(packageId).trim()) {
      return res.status(400).json({ status: "FAILED", message: "Invalid packageId" });
    }

    const session = await getOrCreateSession(req.customer._id);
    const before = session.packageIds.length;
    session.packageIds = session.packageIds.filter((id) => String(id) !== packageId);

    if (session.packageIds.length === before) {
      return res.status(404).json({ status: "FAILED", message: "That package isn't in your comparison" });
    }

    await session.save();
    const comparison = await loadComparisonForSession(session);
    return res.status(200).json({ status: "SUCCESS", message: "Removed from comparison", ...comparison });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to remove from comparison", error: error.message });
  }
};

/**
 * @desc Clear the comparison entirely.
 */
export const clearCompare = async (req, res) => {
  try {
    await CompareSession.updateOne({ customerId: req.customer._id }, { $set: { packageIds: [] } }, { upsert: true });
    return res.status(200).json({ status: "SUCCESS", message: "Comparison cleared" });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to clear comparison", error: error.message });
  }
};

// Flattens the normalized comparison into a CSV string — one column per
// package, one row per attribute, so it opens sensibly in a spreadsheet.
// categorySpecificDetails is deliberately left out of the CSV: it's a
// nested, vendor-type-specific object that doesn't flatten into a single
// cell meaningfully — the JSON export (or the app itself) is the place for
// that level of detail, not a spreadsheet row.
function toCsv(comparison) {
  const rows = [
    ["Attribute", ...comparison.items.map((i) => i.packageName || "Package")],
    ["Vendor", ...comparison.items.map((i) => i.vendor?.businessName || "")],
    ["Vendor rating", ...comparison.items.map((i) => i.vendor?.rating ?? "")],
    ["City", ...comparison.items.map((i) => i.vendor?.city || "")],
    ["Variant", ...comparison.items.map((i) => i.variantType || "")],
    ["Price", ...comparison.items.map((i) => i.price.amount ?? "")],
    ["Billing unit", ...comparison.items.map((i) => i.price.billingUnit || "")],
    ["GST rate %", ...comparison.items.map((i) => i.price.gstRatePercent ?? "")],
    ["Min guests", ...comparison.items.map((i) => i.capacity.minGuests ?? "")],
    ["Max guests", ...comparison.items.map((i) => i.capacity.maxGuests ?? "")],
    ["Min hours", ...comparison.items.map((i) => i.duration.minHours ?? "")],
    ["Max hours", ...comparison.items.map((i) => i.duration.maxHours ?? "")],
    ["Event categories", ...comparison.items.map((i) => (i.eventCategories || []).join("; "))],
    ["Cancellation policy", ...comparison.items.map((i) => i.cancellationPolicySummary || "")],
  ];

  const escapeCell = (cell) => {
    const str = String(cell ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  return rows.map((row) => row.map(escapeCell).join(",")).join("\n");
}

/**
 * @desc Export the current comparison as JSON (same shape as GET) or CSV
 * (Content-Disposition: attachment, so a browser download-prompts it).
 * "Print" itself is inherently a frontend concern (the browser's print
 * dialog against the rendered page) — nothing for the backend to do beyond
 * providing this data, which GET /api/customer/compare already does.
 */
export const exportCompare = async (req, res) => {
  try {
    const session = await getOrCreateSession(req.customer._id);
    const comparison = await loadComparisonForSession(session);

    if (comparison.items.length === 0) {
      return res.status(400).json({ status: "FAILED", message: "Nothing to export — your comparison is empty" });
    }

    if (req.query.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=comparison.csv");
      return res.status(200).send(toCsv(comparison));
    }

    return res.status(200).json({ status: "SUCCESS", ...comparison });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to export comparison", error: error.message });
  }
};
