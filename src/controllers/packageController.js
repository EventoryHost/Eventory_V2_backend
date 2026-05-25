import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";
import { getModelForVendor } from "../utils/modelRegistry.js";
import { validatePackageSubmission } from "../validators/packageValidators.js";

/**
 * @desc Initialize a new package draft
 */
export const initializePackage = async (req, res) => {
  try {
    const { vendorId, vendorType, bookingType, availabilityCalendar } = req.body;

    if (!vendorId || !vendorType || !bookingType) {
      return res.status(400).json({
        status: "FAILED",
        message: "Missing required fields: vendorId, vendorType, or bookingType",
      });
    }

    // Resolve human-readable custom vendor ID (e.g., "VEN...") to MongoDB ObjectId
    let actualVendorId = vendorId;
    if (typeof vendorId === "string" && vendorId.startsWith("VEN")) {
      const vendorDoc = await Vendor.findOne({ id: vendorId });
      if (vendorDoc) {
        actualVendorId = vendorDoc._id;
      } else {
        return res.status(404).json({
          status: "FAILED",
          message: `Vendor with ID ${vendorId} not found in database`,
        });
      }
    }

    const Model = getModelForVendor(vendorType);

    // Dynamic Idempotency Lock: If a draft already exists for this vendor, reuse it instead of creating duplicates
    const existingDraft = await Model.findOne({ vendorId: actualVendorId, packageStatus: "Draft" });
    if (existingDraft) {
      return res.status(200).json({
        status: "SUCCESS",
        message: "Existing draft package retrieved",
        packageId: existingDraft._id,
      });
    }

    const newPackage = new Model({
      vendorId: actualVendorId,
      vendorType,
      bookingType,
      availabilityCalendar,
      packageStatus: "Draft",
      step1_eventAndCrew: {
        packageName: "Untitled Package",
        eventCategories: []
      }
    });

    await newPackage.save();

    return res.status(201).json({
      status: "SUCCESS",
      message: "Package initialized successfully",
      packageId: newPackage._id,
    });
  } catch (error) {
    console.error("Initialize Package Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to initialize package",
      error: error.message,
    });
  }
};

/**
 * @desc Get package by ID
 */
export const getPackageById = async (req, res) => {
  try {
    const { packageId } = req.params;
    const pkg = await Package.findById(packageId);

    if (!pkg) {
      return res.status(404).json({ status: "FAILED", message: "Package not found" });
    }

    return res.status(200).json({ status: "SUCCESS", package: pkg });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch package", error: error.message });
  }
};

/**
 * @desc Update a specific step of the package (Deep Merge)
 */
export const updatePackageStep = async (req, res) => {
  try {
    const { packageId, stepNumber } = req.params;
    const stepData = req.body;

    const basePkg = await Package.findById(packageId);
    if (!basePkg) {
      return res.status(404).json({ status: "FAILED", message: "Package not found" });
    }

    // Solve discriminator gotcha by using the subclass Model so subclass-specific fields like step2 are kept
    const Model = getModelForVendor(basePkg.vendorType);

    const stepMap = {
      1: "step1_eventAndCrew",
      2: "step2_productsAndPricing",
      3: "step3_policiesAndCharges",
      4: "step4_sampleMedia",
    };

    const updateField = stepMap[stepNumber];
    if (!updateField) {
      return res.status(400).json({ status: "FAILED", message: "Invalid step number" });
    }

    // Convert stepData into flat dot-notation updates to prevent full-object replacement
    const flatUpdates = {};
    Object.keys(stepData).forEach((key) => {
      flatUpdates[`${updateField}.${key}`] = stepData[key];
    });

    // Also update completedSteps if not already there
    const updatedPackage = await Model.findByIdAndUpdate(
      packageId,
      { 
        $set: flatUpdates,
        $addToSet: { completedSteps: parseInt(stepNumber) }
      },
      { new: true, runValidators: true }
    );

    if (!updatedPackage) {
      return res.status(404).json({ status: "FAILED", message: "Package not found" });
    }

    return res.status(200).json({
      status: "SUCCESS",
      message: `Step ${stepNumber} updated successfully`,
      package: updatedPackage,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to update step", error: error.message });
  }
};

/**
 * @desc Get all packages for a vendor
 */
export const getVendorPackages = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { status } = req.query;
    
    // Resolve human-readable custom vendor ID (e.g., "VEN...") to MongoDB ObjectId
    let actualVendorId = vendorId;
    if (typeof vendorId === "string" && vendorId.startsWith("VEN")) {
      const vendorDoc = await Vendor.findOne({ id: vendorId });
      if (vendorDoc) {
        actualVendorId = vendorDoc._id;
      } else {
        return res.status(200).json({ status: "SUCCESS", count: 0, packages: [] });
      }
    }
    
    const query = { vendorId: actualVendorId };
    if (status) query.packageStatus = status;

    const packages = await Package.find(query);

    return res.status(200).json({ status: "SUCCESS", count: packages.length, packages });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch vendor packages", error: error.message });
  }
};

/**
 * @desc Submit package for EM review
 */
export const submitPackage = async (req, res) => {
  try {
    const { packageId } = req.params;
    const pkg = await Package.findById(packageId);

    if (!pkg) {
      return res.status(404).json({ status: "FAILED", message: "Package not found" });
    }

    const errors = validatePackageSubmission(pkg);
    if (errors.length > 0) {
      return res.status(400).json({ status: "FAILED", message: "Validation failed", errors });
    }

    pkg.packageStatus = "Under Review";
    await pkg.save();

    return res.status(200).json({ status: "SUCCESS", message: "Package submitted successfully", packageStatus: pkg.packageStatus });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to submit package", error: error.message });
  }
};

/**
 * @desc Soft delete a package
 */
export const deletePackage = async (req, res) => {
  try {
    const { packageId } = req.params;
    const updatedPackage = await Package.findByIdAndUpdate(
      packageId,
      { packageStatus: "Deleted" },
      { new: true }
    );

    if (!updatedPackage) {
      return res.status(404).json({ status: "FAILED", message: "Package not found" });
    }

    return res.status(200).json({ status: "SUCCESS", message: "Package marked as deleted" });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to delete package", error: error.message });
  }
};

/**
 * @desc Duplicate an existing package
 */
export const duplicatePackage = async (req, res) => {
  try {
    const { packageId } = req.params;
    const originalPkg = await Package.findById(packageId).lean();

    if (!originalPkg) {
      return res.status(404).json({ status: "FAILED", message: "Package not found" });
    }

    // Remove ID and metadata
    delete originalPkg._id;
    delete originalPkg.createdAt;
    delete originalPkg.updatedAt;
    
    // Reset status and progress
    originalPkg.packageStatus = "Draft";
    originalPkg.completedSteps = [];
    originalPkg.step1_eventAndCrew.packageName += " (Copy)";

    const Model = getModelForVendor(originalPkg.vendorType);
    const duplicatedPkg = new Model(originalPkg);
    await duplicatedPkg.save();

    return res.status(201).json({ status: "SUCCESS", message: "Package duplicated", packageId: duplicatedPkg._id });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to duplicate package", error: error.message });
  }
};

// --- Nested CRUD for Step 2 Sub-Items ---

/**
 * @desc Add a nested item (generic)
 * Expected body: { arrayName: "menus", item: { ... } }
 */
export const addNestedItem = async (req, res) => {
  try {
    const { packageId } = req.params;
    const { arrayName, item } = req.body;

    const updatePath = `step2_productsAndPricing.${arrayName}`;
    const updatedPackage = await Package.findByIdAndUpdate(
      packageId,
      { $push: { [updatePath]: item } },
      { new: true, runValidators: true }
    );

    return res.status(200).json({ status: "SUCCESS", package: updatedPackage });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", error: error.message });
  }
};

/**
 * @desc Update a nested item (generic)
 * Expected body: { arrayName: "menus", itemId: "...", updates: { ... } }
 */
export const updateNestedItem = async (req, res) => {
  try {
    const { packageId } = req.params;
    const { arrayName, itemId, updates } = req.body;

    const pkg = await Package.findById(packageId);
    if (!pkg) return res.status(404).json({ message: "Package not found" });

    const array = pkg.step2_productsAndPricing[arrayName];
    const subItem = array.id(itemId);
    if (!subItem) return res.status(404).json({ message: "Item not found" });

    Object.assign(subItem, updates);
    await pkg.save();

    return res.status(200).json({ status: "SUCCESS", package: pkg });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", error: error.message });
  }
};

/**
 * @desc Remove a nested item (generic)
 * Expected body: { arrayName: "menus", itemId: "..." }
 */
export const removeNestedItem = async (req, res) => {
  try {
    const { packageId } = req.params;
    const { arrayName, itemId } = req.body;

    const updatePath = `step2_productsAndPricing.${arrayName}`;
    const updatedPackage = await Package.findByIdAndUpdate(
      packageId,
      { $pull: { [updatePath]: { _id: itemId } } },
      { new: true }
    );

    return res.status(200).json({ status: "SUCCESS", package: updatedPackage });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", error: error.message });
  }
};
