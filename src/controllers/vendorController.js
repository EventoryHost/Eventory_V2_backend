import Vendor from "../models/Vendor.js";
import { generateISTId } from "../utils/idGenerator.js";

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
    const vendor = await Vendor.findOneAndUpdate(
      { id: req.params.id },
      { isDeactivated: false },
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
