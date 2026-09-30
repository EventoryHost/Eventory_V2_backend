import Vendor from "../models/Vendor.js";
import { generateISTId } from "../utils/idGenerator.js";
import {
  DELETION_RETENTION_DAYS,
  purgeEligibleAt,
} from "../utils/accountDeletion.js";
import { VENDOR_DOC_FIELDS } from "../models/schemas/emActionSchema.js";
import { computeCompletion } from "../utils/profileCompletion.js";
import {
  effectiveVerification,
  hasVerificationStatus,
} from "../utils/vendorVerificationLegacy.js";
import {
  onVendorEdit,
  lockedFields,
  sameValue,
} from "../services/vendorVerificationService.js";

/**
 * Fields the vendor's own requests may never write: identity, the admin
 * review and everything derived from it, account state, and counters the
 * server maintains. There is no auth on these routes, so without this a
 * client could PATCH `isVerified: true`.
 */
const SERVER_OWNED_FIELDS = new Set([
  "_id",
  "__v",
  "id",
  "isVerified",
  "verification",
  "verificationHistory",
  "adminReview",
  "isDeactivated",
  "deletionRequestedAt",
  "assignedEmId",
  "assignedEmName",
  "rating",
  "reviewsCount",
  "wishlistCount",
]);

/**
 * Drop server-owned fields, including dotted paths into them
 * ("verification.status") and any update operator ("$set").
 */
function stripServerOwnedFields(payload, { keep = [] } = {}) {
  const cleaned = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (key.startsWith("$")) continue;
    const root = key.split(".")[0];
    if (SERVER_OWNED_FIELDS.has(root) && !keep.includes(root)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/** The stored value at a top-level or dotted ("bankDetails.0.ifscCode") path. */
const valueAt = (doc, path) =>
  path.split(".").reduce((node, part) => (node == null ? undefined : node[part]), doc);

/** The vendor plus its completion, the way the app reads it. */
const withCompletion = (vendor) => {
  const data = typeof vendor.toObject === "function" ? vendor.toObject() : { ...vendor };
  if (!hasVerificationStatus(data)) data.verification = effectiveVerification(data);
  const profileCompletion = computeCompletion(data);
  return { data: { ...data, profileCompletion }, profileCompletion };
};

/**
 * Strip any base64 / data URI values from an update payload.
 * These should never be stored in MongoDB — images must use S3 URLs.
 * Handles top-level strings and arrays of strings (e.g. businessPhotos).
 */
function sanitizeBase64Fields(payload) {
  const sanitized = { ...payload };
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === "string" && value.startsWith("data:")) {
      console.warn(`[vendorController] Blocked base64 write on field: ${key}`);
      delete sanitized[key];
    } else if (Array.isArray(value)) {
      const filtered = value.filter((v) => {
        if (typeof v === "string" && v.startsWith("data:")) {
          console.warn(`[vendorController] Stripped base64 entry from array field: ${key}`);
          return false;
        }
        return true;
      });
      sanitized[key] = filtered;
    }
  }
  return sanitized;
}


// Create a new vendor
export const createVendor = async (req, res, next) => {
  try {
    // `id` may be chosen by the caller (existing behaviour); nothing else server-owned.
    const vendorData = sanitizeBase64Fields(stripServerOwnedFields(req.body, { keep: ["id"] }));
    if (!vendorData.id) {
      vendorData.id = generateISTId("VEN");
    }
    const vendor = new Vendor(vendorData);
    await vendor.save();
    res.status(201).json({
      success: true,
      data: vendor,
    });
  } catch (error) {
    next(error);
  }
};

// Get all vendors
export const getAllVendors = async (req, res, next) => {
  try {
    const vendors = await Vendor.find().lean();
    res.status(200).json({
      success: true,
      count: vendors.length,
      data: vendors,
    });
  } catch (error) {
    next(error);
  }
};

// Get single vendor by ID
export const getVendorById = async (req, res, next) => {
  try {
    let query = Vendor.findOne({ id: req.params.id });
    const select = typeof req.query.select === "string" ? req.query.select : "";
    if (select) {
      const fields = select.split(',').join(' ');
      query = query.select(fields);
    }
    const vendor = await query.lean();
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }
    // A narrow ?select= read skips the completion unless it asks for the
    // verification — the percentage needs the whole profile.
    const wantsCompletion =
      !select || select.split(",").some((f) => f.trim().split(".")[0] === "verification");
    res.status(200).json({
      success: true,
      data: wantsCompletion ? withCompletion(vendor).data : vendor,
    });
  } catch (error) {
    next(error);
  }
};

// Update vendor
export const updateVendor = async (req, res, next) => {
  try {
    const cleanBody = sanitizeBase64Fields(stripServerOwnedFields(req.body));
    const rootOf = (key) => key.split(".")[0];
    const sentFields = Object.keys(cleanBody);

    // A freshly uploaded business document has not been checked yet, so
    // writing one always clears its verified flag — however it was uploaded,
    // and whether or not an EM asked for it.
    for (const { url, verified } of Object.values(VENDOR_DOC_FIELDS)) {
      if (cleanBody[url]) cleanBody[verified] = false;
    }

    const before = await Vendor.findOne({ id: req.params.id }).lean();
    if (!before) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    // While a review group is sent back for changes, only its Not correct
    // steps may change. Anything else in that group is dropped, and the fields
    // the vendor actually tried to change are reported back.
    const locked = new Set(
      lockedFields(effectiveVerification(before), [...new Set(Object.keys(cleanBody).map(rootOf))])
    );
    const ignoredFields = [
      ...new Set(
        sentFields
          .filter((k) => locked.has(rootOf(k)) && !sameValue(valueAt(before, k), cleanBody[k]))
          .map(rootOf)
      ),
    ];
    for (const key of Object.keys(cleanBody)) {
      if (locked.has(rootOf(key))) delete cleanBody[key];
    }

    let vendor = await Vendor.findOneAndUpdate(
      { id: req.params.id },
      cleanBody,
      {
        new: true,
        runValidators: true,
      }
    );
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    // changedFields: what actually changed value (including the server-side
    // flag resets above) — re-sending an unchanged field does not reset a
    // reviewed step. savedFields: what the vendor sent and was written; in a
    // sent-back group, saving a flagged step counts as fixing it even when
    // the value is unchanged.
    const after = vendor.toObject();
    const writtenFields = [...new Set(Object.keys(cleanBody).map(rootOf))];
    const changedFields = writtenFields.filter((f) => !sameValue(before[f], after[f]));
    const savedFields = [
      ...new Set(sentFields.map(rootOf).filter((f) => writtenFields.includes(f))),
    ];

    // The profile is already saved; a failure here must not turn it into an error.
    try {
      vendor = await onVendorEdit(vendor, changedFields, { savedFields });
    } catch (hookError) {
      console.error(`[vendorController] onVendorEdit failed for ${req.params.id}:`, hookError);
    }

    res.status(200).json({
      success: true,
      ...withCompletion(vendor),
      ignoredFields,
    });
  } catch (error) {
    next(error);
  }
};

// Delete vendor
export const deleteVendor = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOneAndDelete({ id: req.params.id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }
    res.status(200).json({
      success: true,
      message: "Vendor deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const deactivateVendor = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOneAndUpdate(
      { id: req.params.id },
      { isDeactivated: true },
      { new: true, runValidators: true }
    );
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }
    res.status(200).json({
      success: true,
      message: "Vendor account has been deactivated",
      data: vendor,
    });
  } catch (error) {
    next(error);
  }
};

export const reactivateVendor = async (req, res, next) => {
  try {
    // Also clears any pending deletion — otherwise a support reactivation
    // would leave the purge armed and the account would vanish later.
    const vendor = await Vendor.findOneAndUpdate(
      { id: req.params.id },
      { isDeactivated: false, deletionRequestedAt: null },
      { new: true, runValidators: true }
    );
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }
    res.status(200).json({
      success: true,
      message: "Vendor account has been reactivated",
      data: vendor,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Vendor-initiated account deletion (App Store guideline 5.1.1(v)).
 *
 * Deactivates the account and starts the retention window. The vendor keeps
 * the ability to sign in during the window solely to cancel; once it lapses
 * the scheduled job purges the account for good.
 */
export const requestVendorDeletion = async (req, res, next) => {
  try {
    const existing = await Vendor.findOne({ id: req.params.id });
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    // Re-requesting must not slide the purge date forward.
    const requestedAt = existing.deletionRequestedAt || new Date();

    const vendor = await Vendor.findOneAndUpdate(
      { id: req.params.id },
      { isDeactivated: true, deletionRequestedAt: requestedAt },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Account deletion requested",
      data: {
        deletionRequestedAt: vendor.deletionRequestedAt,
        scheduledPurgeAt: purgeEligibleAt(vendor.deletionRequestedAt),
        retentionDays: DELETION_RETENTION_DAYS,
      },
    });
  } catch (error) {
    next(error);
  }
};

/** Cancel a pending deletion and restore the account. */
export const cancelVendorDeletion = async (req, res, next) => {
  try {
    const existing = await Vendor.findOne({ id: req.params.id });
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    if (!existing.deletionRequestedAt) {
      return res.status(400).json({
        success: false,
        code: "NO_PENDING_DELETION",
        message: "This account has no pending deletion request",
      });
    }

    const vendor = await Vendor.findOneAndUpdate(
      { id: req.params.id },
      { isDeactivated: false, deletionRequestedAt: null },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Account deletion cancelled",
      data: vendor,
    });
  } catch (error) {
    next(error);
  }
};
