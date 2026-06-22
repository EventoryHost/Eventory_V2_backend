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
    let query = Vendor.find();
    if (!req.query.fullPhotos) {
      query = query.select('-businessPhotos');
    }
    const vendors = await query.lean();
    
    // Optimize base64 photos: unless client explicitly requests full photos (?fullPhotos=true),
    // we truncate the base64 photo data to prevent huge payloads (e.g. 16MB) from slowing down the app.
    if (!req.query.fullPhotos) {
      vendors.forEach(vendor => {
        if (vendor.businessPhotos) {
          vendor.businessPhotos = vendor.businessPhotos.map(photo => {
            if (photo && photo.startsWith('data:image')) {
              return photo.substring(0, 30) + '...[truncated]';
            }
            return photo;
          });
        }
      });
    }

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
    if (!req.query.fullPhotos) {
      query = query.select('-businessPhotos');
    }
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

    // Optimize base64 photos: unless client explicitly requests full photos (?fullPhotos=true),
    // we truncate the base64 photo data to prevent huge payloads (e.g. 16MB) from slowing down the app.
    if (!req.query.fullPhotos && vendor.businessPhotos) {
      vendor.businessPhotos = vendor.businessPhotos.map(photo => {
        if (photo && photo.startsWith('data:image')) {
          return photo.substring(0, 30) + '...[truncated]';
        }
        return photo;
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
