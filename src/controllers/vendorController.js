import Vendor from "../models/Vendor.js";
import { generateISTId } from "../utils/idGenerator.js";

// Create a new vendor
export const createVendor = async (req, res, next) => {
  try {
    const vendorData = { ...req.body };
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
    const vendors = await Vendor.find();
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
    const vendor = await Vendor.findOne({ id: req.params.id });
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
    const vendor = await Vendor.findOneAndUpdate(
      { id: req.params.id },
      req.body,
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
