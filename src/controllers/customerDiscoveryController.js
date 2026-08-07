import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";

/**
 * Public (no-auth), read-only discovery endpoints for the customer side:
 * browse/search Live packages and active vendors. Pure projections over the
 * existing vendor-authored Package/Vendor models — no writes, no new models,
 * no changes to vendor-side controllers/routes.
 *
 * Per the Vendor Page PRD (see info.txt PART 3): customers never see a
 * vendor's direct contact info or verification/KYC internals, so every
 * response here is built from an explicit field whitelist rather than
 * projecting the full document — that's enforced here, not left to callers.
 */

// Fields safe to expose on a vendor to a customer. Deliberately excludes:
// email, phone, aadharNumber/panNumber/gstNumber + their doc URLs,
// bankDetails, agreementDocUrl, isDarkMode, faceMatchScore, and the raw
// isAadharVerified/isPanVerified/isGstVerified/isFssaiVerified/isTradeLicVerified
// flags (internal KYC granularity — customers only need the overall isVerified).
const PUBLIC_VENDOR_FIELDS =
  "id businessName isIndividual vendorType eventCategories city state serviceAreas " +
  "teamSize bookingsPerYear experience profilePicture description businessPhotos " +
  "coverImage isVerified rating reviewsCount createdAt";

/**
 * @desc Browse/search Live packages by event category, vendor type, city,
 * guest count, date availability, and price range.
 */
export const browsePackages = async (req, res) => {
  try {
    const { eventCategory, vendorType, city, guests, date, minPrice, maxPrice, sort, page, limit } = req.query;

    const query = { packageStatus: "Live" };

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
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
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
      packages = await Package.aggregate([
        { $match: query },
        { $lookup: { from: "vendors", localField: "vendorId", foreignField: "_id", as: "vendorId" } },
        { $unwind: { path: "$vendorId", preserveNullAndEmptyArrays: true } },
        { $sort: { "vendorId.rating": -1, "vendorId.reviewsCount": -1, createdAt: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $project: projectionFromFieldList(PACKAGE_FIELDS, PUBLIC_VENDOR_FIELDS) },
      ]);
    } else {
      const sortMap = {
        newest: { createdAt: -1 },
        price_asc: { "step3_policiesAndCharges.packagePricing.price": 1 },
        price_desc: { "step3_policiesAndCharges.packagePricing.price": -1 },
      };
      packages = await Package.find(query)
        .select(PACKAGE_FIELDS)
        .populate({ path: "vendorId", select: PUBLIC_VENDOR_FIELDS })
        .sort(sortMap[sort] || sortMap.newest)
        .skip((page - 1) * limit)
        .limit(limit);
    }

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

    const vendorIds = facets.vendorIds.map((v) => v._id).filter(Boolean);
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
