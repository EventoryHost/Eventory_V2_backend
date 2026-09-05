import Vendor from "../models/Vendor.js";
import { generateISTId } from "../utils/idGenerator.js";
import {
  DELETION_RETENTION_DAYS,
  purgeEligibleAt,
} from "../utils/accountDeletion.js";
import { VENDOR_DOC_FIELDS } from "../models/schemas/emActionSchema.js";

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
    const vendorData = sanitizeBase64Fields({ ...req.body });
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
    if (req.query.select) {
      const fields = req.query.select.split(',').join(' ');
      query = query.select(fields);
    }
    const vendor = await query.lean();
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }
    res.status(200).json({
      success: true,
      data: vendor,
    });
  } catch (error) {
    next(error);
  }
};

// Update vendor
export const updateVendor = async (req, res, next) => {
  try {
    const cleanBody = sanitizeBase64Fields(req.body);

    // A freshly uploaded business document has not been checked yet, so
    // writing one always clears its verified flag — however it was uploaded,
    // and whether or not an EM asked for it.
    for (const { url, verified } of Object.values(VENDOR_DOC_FIELDS)) {
      if (cleanBody[url]) cleanBody[verified] = false;
    }

    const vendor = await Vendor.findOneAndUpdate(
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
    res.status(200).json({
      success: true,
      data: vendor,
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
