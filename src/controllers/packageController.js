import mongoose from "mongoose";
import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";
import { getModelForVendor } from "../utils/modelRegistry.js";
import { validatePackageSubmission } from "../validators/packageValidators.js";

/**
 * @desc Initialize a new package draft
 */
export const initializePackage = async (req, res) => {
  try {
    const {
      vendorId,
      vendorType,
      packageName,
      variantType,
      packageGroupId,
    } = req.body;

    if (!vendorId || !vendorType) {
      return res.status(400).json({
        status: "FAILED",
        message: "Missing required fields: vendorId, vendorType, or bookingType",
      });
    }

    // Ensure vendorId is in the custom string format (e.g., "VEN...")
    let actualVendorId = vendorId;
    if (mongoose.Types.ObjectId.isValid(vendorId)) {
      const vendorDoc = await Vendor.findById(vendorId).select('id');
      if (vendorDoc && vendorDoc.id) {
        actualVendorId = vendorDoc.id;
      } else {
        return res.status(404).json({
          status: "FAILED",
          message: `Vendor with ObjectId ${vendorId} not found in database`,
        });
      }
    } else if (typeof vendorId === "string" && !vendorId.startsWith("VEN")) {
      return res.status(400).json({
        status: "FAILED",
        message: "Invalid vendorId format",
      });
    }

    const Model = getModelForVendor(vendorType);

    // A logical package can have multiple variants — each is its own document,
    // tied to its siblings by a shared packageGroupId.
    const resolvedName =
      packageName && packageName.trim() ? packageName.trim() : "Untitled Package";
    const resolvedVariant =
      variantType && variantType.trim() ? variantType.trim() : "Premium";

    // The client sends the group id it got back from the first variant so the
    // rest join that group. Reject a malformed one rather than quietly minting a
    // fresh id, which would split the group without any visible error.
    const hasClientGroupId =
      packageGroupId !== undefined && packageGroupId !== null && packageGroupId !== "";
    if (hasClientGroupId && !mongoose.Types.ObjectId.isValid(packageGroupId)) {
      return res.status(400).json({
        status: "FAILED",
        message: `Invalid packageGroupId: ${packageGroupId}`,
      });
    }
    const resolvedGroupId = hasClientGroupId
      ? new mongoose.Types.ObjectId(packageGroupId)
      : new mongoose.Types.ObjectId();

    // Idempotency: reuse an existing draft for the SAME variant of this package.
    // Prefer the group id; fall back to the legacy name match only when the
    // client sent no group id (i.e. a client that predates this field).
    const existingDraft = await Model.findOne(
      hasClientGroupId
        ? {
          packageGroupId: resolvedGroupId,
          packageStatus: "Draft",
          variantType: resolvedVariant,
        }
        : {
          vendorId: actualVendorId,
          packageStatus: "Draft",
          variantType: resolvedVariant,
          "step1_eventAndCrew.packageName": resolvedName,
        }
    );
    if (existingDraft) {
      return res.status(200).json({
        status: "SUCCESS",
        message: "Existing draft package retrieved",
        packageId: existingDraft._id,
        packageGroupId: existingDraft.packageGroupId,
      });
    }

    const newPackage = new Model({
      vendorId: actualVendorId,
      vendorType,
      packageStatus: "Draft",
      packageGroupId: resolvedGroupId,
      variantType: resolvedVariant,
      step1_eventAndCrew: {
        packageName: resolvedName,
        eventCategories: []
      }
    });

    await newPackage.save();

    return res.status(201).json({
      status: "SUCCESS",
      message: "Package initialized successfully",
      packageId: newPackage._id,
      packageGroupId: newPackage.packageGroupId,
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

// Steps 1-4 are the package setup; 5-8 are the booking settings sections,
// which live at the top level rather than under a stepN_ key. Saving through a
// step also records it in completedSteps, so the vendor can resume from
// wherever they left off.
const STEP_FIELDS = {
  1: "step1_eventAndCrew",
  2: "step2_productsAndPricing",
  3: "step3_policiesAndCharges",
  4: "step4_sampleMedia",
  5: "bookingSettings",
  6: "paymentMilestones",
  7: "availabilitySettings",
  8: "bookingCapacity",
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

    const updateField = STEP_FIELDS[stepNumber];
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
 * @desc Update top-level package fields (e.g. variantType for rename).
 * Body: { variantType?: string }
 */
export const updatePackage = async (req, res) => {
  try {
    const { packageId } = req.params;

    // Whitelist the top-level fields that may be updated this way.
    // packageStatus covers soft delete ("Deleted") and restore ("Draft");
    // the schema enum rejects anything else via runValidators below.
    const allowedFields = ["variantType", "packageStatus"];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        status: "FAILED",
        message: "No updatable fields provided",
      });
    }

    const basePkg = await Package.findById(packageId);
    if (!basePkg) {
      return res.status(404).json({ status: "FAILED", message: "Package not found" });
    }

    // Use the subclass model so discriminator-specific fields are preserved.
    const Model = getModelForVendor(basePkg.vendorType);
    const updatedPackage = await Model.findByIdAndUpdate(
      packageId,
      { $set: updates },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      status: "SUCCESS",
      message: "Package updated successfully",
      package: updatedPackage,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to update package", error: error.message });
  }
};

/**
 * @desc Get all packages for a vendor
 */
export const getVendorPackages = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { status, packageGroupId } = req.query;

    // Ensure vendorId is in the custom string format (e.g., "VEN...")
    let actualVendorId = vendorId;
    if (mongoose.Types.ObjectId.isValid(vendorId)) {
      const vendorDoc = await Vendor.findById(vendorId).select('id');
      if (vendorDoc && vendorDoc.id) {
        actualVendorId = vendorDoc.id;
      } else {
        return res.status(200).json({ status: "SUCCESS", count: 0, packages: [] });
      }
    }

    const query = { vendorId: actualVendorId };
    if (status) query.packageStatus = status;
    if (packageGroupId) {
      if (!mongoose.Types.ObjectId.isValid(packageGroupId)) {
        return res.status(400).json({
          status: "FAILED",
          message: `Invalid packageGroupId: ${packageGroupId}`,
        });
      }
      query.packageGroupId = new mongoose.Types.ObjectId(packageGroupId);
    }

    const packages = await Package.find(query).sort({ createdAt: -1 });

    return res.status(200).json({ status: "SUCCESS", count: packages.length, packages });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch vendor packages", error: error.message });
  }
};

/**
 * @desc Get every variant of one logical package, oldest first.
 */
export const getPackageGroup = async (req, res) => {
  try {
    const { packageGroupId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(packageGroupId)) {
      return res.status(400).json({
        status: "FAILED",
        message: `Invalid packageGroupId: ${packageGroupId}`,
      });
    }

    const packages = await Package.find({
      packageGroupId: new mongoose.Types.ObjectId(packageGroupId),
    }).sort({ createdAt: 1 });

    if (packages.length === 0) {
      return res.status(404).json({ status: "FAILED", message: "Package group not found" });
    }

    return res.status(200).json({
      status: "SUCCESS",
      count: packages.length,
      packageGroupId,
      packages,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch package group", error: error.message });
  }
};

/**
 * @desc Rename a logical package across all of its variants in one write.
 */
export const updatePackageGroup = async (req, res) => {
  try {
    const { packageGroupId } = req.params;
    const { packageName, packageStatus, step, data } = req.body;

    if (!mongoose.Types.ObjectId.isValid(packageGroupId)) {
      return res.status(400).json({
        status: "FAILED",
        message: `Invalid packageGroupId: ${packageGroupId}`,
      });
    }

    const set = {};

    if (packageName !== undefined) {
      if (typeof packageName !== "string" || !packageName.trim()) {
        return res.status(400).json({
          status: "FAILED",
          message: "packageName must be a non-empty string",
        });
      }
      set["step1_eventAndCrew.packageName"] = packageName.trim();
    }

    // Soft delete and restore are a status change across the whole group.
    if (packageStatus !== undefined) {
      set.packageStatus = packageStatus;
    }

    const update = {};

    // Booking settings (steps 5-8) belong to the logical package, so they are
    // written to every variant at once rather than one call per variant.
    if (step !== undefined) {
      const field = STEP_FIELDS[step];
      if (!field) {
        return res.status(400).json({ status: "FAILED", message: "Invalid step number" });
      }
      if (data && typeof data === "object" && !Array.isArray(data)) {
        Object.keys(data).forEach((key) => {
          set[`${field}.${key}`] = data[key];
        });
      }
      update.$addToSet = { completedSteps: parseInt(step) };
    }

    if (Object.keys(set).length === 0 && !update.$addToSet) {
      return res.status(400).json({
        status: "FAILED",
        message: "No updatable fields provided",
      });
    }
    if (Object.keys(set).length > 0) update.$set = set;

    // Safe through the base model: every path touched here is on the base
    // schema, and $set never strips discriminator fields.
    const result = await Package.updateMany(
      { packageGroupId: new mongoose.Types.ObjectId(packageGroupId) },
      update,
      { runValidators: true }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ status: "FAILED", message: "Package group not found" });
    }

    return res.status(200).json({
      status: "SUCCESS",
      message: "Package group updated",
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to update package group", error: error.message });
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
 * @desc Permanently delete ONE variant. Irreversible.
 * Deleting a whole package is hardDeletePackage — this strands the siblings.
 */
export const hardDeleteVariant = async (req, res) => {
  try {
    const { packageId } = req.params;
    const deleted = await Package.findByIdAndDelete(packageId);

    if (!deleted) {
      return res.status(404).json({ status: "FAILED", message: "Variant not found" });
    }

    return res.status(200).json({ status: "SUCCESS", message: "Variant permanently deleted" });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to permanently delete variant", error: error.message });
  }
};

/**
 * @desc Permanently delete a whole package — every variant in the group.
 * Irreversible.
 */
export const hardDeletePackage = async (req, res) => {
  try {
    const { packageGroupId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(packageGroupId)) {
      return res.status(400).json({
        status: "FAILED",
        message: `Invalid packageGroupId: ${packageGroupId}`,
      });
    }

    const { deletedCount } = await Package.deleteMany({
      packageGroupId: new mongoose.Types.ObjectId(packageGroupId),
    });

    if (deletedCount === 0) {
      return res.status(404).json({ status: "FAILED", message: "Package not found" });
    }

    return res.status(200).json({
      status: "SUCCESS",
      message: "Package permanently deleted",
      count: deletedCount,
    });
  } catch (error) {
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to permanently delete package",
      error: error.message,
    });
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
 * Recursively deletes every `_id` in a lean document so a duplicate gets fresh
 * ones. Mutates in place.
 */
const stripIds = (node) => {
  if (Array.isArray(node)) {
    node.forEach(stripIds);
  } else if (node && typeof node === "object" && !(node instanceof Date)) {
    delete node._id;
    Object.values(node).forEach(stripIds);
  }
  return node;
};

const copyName = (name) => `${name || "Untitled Package"} (Copy)`;

/**
 * Lean document → unsaved copy: fresh subdocument ids, no timestamps, back to
 * Draft. `completedSteps` is kept on purpose — the copy holds all of the
 * source's data, so wiping its progress would show a finished package as an
 * empty draft.
 */
const buildDuplicate = (leanPkg, { packageGroupId, variantType, packageName }) => {
  const copy = stripIds(leanPkg);
  delete copy.createdAt;
  delete copy.updatedAt;
  delete copy.__v;

  copy.packageGroupId = packageGroupId;
  copy.packageStatus = "Draft";
  if (variantType) copy.variantType = variantType;

  if (!copy.step1_eventAndCrew) copy.step1_eventAndCrew = {};
  if (packageName !== undefined) {
    copy.step1_eventAndCrew.packageName = packageName;
  }
  return copy;
};

/**
 * @desc Duplicate a package — every variant of it.
 *
 * A package is the group, not the document, so this resolves the given id to its
 * group and copies every sibling into ONE new group. Copying documents one at a
 * time would split a three-variant package into three unrelated packages.
 */
export const duplicatePackage = async (req, res) => {
  try {
    const { packageId } = req.params;
    const originalPkg = await Package.findById(packageId).lean();

    if (!originalPkg) {
      return res.status(404).json({ status: "FAILED", message: "Package not found" });
    }

    // Documents predating packageGroupId have no siblings to find — copy the
    // one document rather than failing the whole request.
    const variants = originalPkg.packageGroupId
      ? await Package.find({ packageGroupId: originalPkg.packageGroupId })
          .sort({ createdAt: 1 })
          .lean()
      : [originalPkg];

    const newGroupId = new mongoose.Types.ObjectId();
    const name = copyName(variants[0].step1_eventAndCrew?.packageName);

    const created = [];
    try {
      for (const variant of variants) {
        const Model = getModelForVendor(variant.vendorType);
        const doc = new Model(
          buildDuplicate(variant, { packageGroupId: newGroupId, packageName: name })
        );
        await doc.save();
        created.push(doc._id);
      }
    } catch (error) {
      // No transaction across the writes — undo the partial copy. Safe to delete
      // by the new group id: it was minted here and holds nothing else.
      await Package.deleteMany({ packageGroupId: newGroupId });
      throw error;
    }

    return res.status(201).json({
      status: "SUCCESS",
      message: "Package duplicated",
      packageId: created[0],
      packageGroupId: newGroupId,
      count: created.length,
      packageIds: created,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to duplicate package", error: error.message });
  }
};

/**
 * @desc Duplicate one variant into the package it already belongs to: the copy
 * keeps the source's packageGroupId and name, and takes variantType from body.
 */
export const duplicateVariant = async (req, res) => {
  try {
    const { packageId } = req.params;
    const { variantType } = req.body;

    if (typeof variantType !== "string" || !variantType.trim()) {
      return res.status(400).json({
        status: "FAILED",
        message: "variantType must be a non-empty string",
      });
    }
    const newVariant = variantType.trim();

    const source = await Package.findById(packageId).lean();
    if (!source) {
      return res.status(404).json({ status: "FAILED", message: "Package not found" });
    }

    // Backfill documents predating packageGroupId, so the pair stays one package.
    let groupId = source.packageGroupId;
    if (!groupId) {
      groupId = new mongoose.Types.ObjectId();
      await Package.updateOne({ _id: source._id }, { $set: { packageGroupId: groupId } });
    }

    // Two variants with the same name are indistinguishable to the client.
    const clash = await Package.findOne({
      packageGroupId: groupId,
      variantType: newVariant,
      packageStatus: { $ne: "Deleted" },
    }).select("_id");
    if (clash) {
      return res.status(409).json({
        status: "FAILED",
        message: `Variant "${newVariant}" already exists in this package`,
      });
    }

    const Model = getModelForVendor(source.vendorType);
    const duplicatedVariant = new Model(
      buildDuplicate(source, { packageGroupId: groupId, variantType: newVariant })
    );
    await duplicatedVariant.save();

    return res.status(201).json({
      status: "SUCCESS",
      message: "Variant duplicated",
      packageId: duplicatedVariant._id,
      packageGroupId: groupId,
      variantType: duplicatedVariant.variantType,
    });
  } catch (error) {
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to duplicate variant",
      error: error.message,
    });
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
