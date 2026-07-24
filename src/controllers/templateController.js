import Package from "../models/Package.js";
import Template from "../models/Template.js";
import Vendor from "../models/Vendor.js";

const VENDOR_TYPE_LABELS = {
  Caterer: "CATERER",
  Decorator: "DECORATOR",
  PAV: "PAV",
  DJArtist: "DJ ARTIST",
  MakeupArtist: "MAKEUP ARTIST",
  VenueProvider: "VENUE",
};

const isObjectId = (value) => /^[0-9a-fA-F]{24}$/.test(String(value ?? ""));

/**
 * Resolves a human-readable custom vendor ID (e.g. "VEN...") to its Vendor doc.
 * Accepts a raw ObjectId string too. Returns null when no vendor matches.
 */
const resolveVendor = async (vendorId) => {
  if (!vendorId) return null;
  if (typeof vendorId === "string" && vendorId.startsWith("VEN")) {
    return Vendor.findOne({ id: vendorId }).select("_id id businessName");
  }
  if (!isObjectId(vendorId)) return null;
  return Vendor.findById(vendorId).select("_id id businessName");
};

/**
 * The client identifies vendors by their custom "VEN..." id, so expose that as
 * `ownerVendorId` (falling back to the ObjectId for templates saved before the
 * custom id was captured).
 */
const serializeTemplate = (doc) => {
  const t = doc.toObject ? doc.toObject() : doc;
  const { ownerVendorCustomId, ...rest } = t;
  return {
    ...rest,
    ownerVendorId: ownerVendorCustomId || String(t.ownerVendorId ?? ""),
  };
};

const firstMediaUrl = (pkg) => {
  const step4 = pkg?.step4_sampleMedia || {};
  const fromMedia = step4.media?.find((m) => m?.url)?.url;
  if (fromMedia) return fromMedia;
  // VenueProvider keeps its media per-space instead of a flat media[].
  for (const space of step4.spaceMedia || []) {
    const url = space?.media?.find((m) => m?.url)?.url;
    if (url) return url;
  }
  return undefined;
};

/**
 * @desc Save a package (with all of its variants) as a reusable template
 * Body: { sourcePackageId: string, note?: string, packageName?, coverImageUrl?, vendorTypeLabel? }
 */
export const createTemplate = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { sourcePackageId, note, packageName, coverImageUrl, vendorTypeLabel } =
      req.body;

    if (!sourcePackageId) {
      return res.status(400).json({
        status: "FAILED",
        message: "Missing required field: sourcePackageId",
      });
    }

    const vendor = await resolveVendor(vendorId);
    if (!vendor) {
      return res.status(404).json({
        status: "FAILED",
        message: `Vendor with ID ${vendorId} not found in database`,
      });
    }

    const sourcePkg = isObjectId(sourcePackageId)
      ? await Package.findById(sourcePackageId).lean()
      : null;
    if (!sourcePkg) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Source package not found" });
    }

    // A logical package is a group of variant documents sharing vendorId +
    // vendorType + packageName. Snapshot the whole group so "Use Template"
    // restores every variant, not just the card the user tapped. vendorType is
    // part of the key because generic names like "Package" recur across a
    // vendor's different categories.
    const name = sourcePkg.step1_eventAndCrew?.packageName;
    const siblings = await Package.find({
      vendorId: sourcePkg.vendorId,
      vendorType: sourcePkg.vendorType,
      "step1_eventAndCrew.packageName": name,
      packageStatus: { $ne: "Deleted" },
    }).lean();

    const packages = siblings.length ? siblings : [sourcePkg];
    if (!packages.some((p) => String(p._id) === String(sourcePkg._id))) {
      packages.push(sourcePkg);
    }

    const template = await Template.create({
      packageName: packageName?.trim() || name || "Untitled Package",
      note: note?.trim() || undefined,
      coverImageUrl: coverImageUrl || firstMediaUrl(sourcePkg),
      vendorTypeLabel: vendorTypeLabel || VENDOR_TYPE_LABELS[sourcePkg.vendorType],
      ownerVendorId: vendor._id,
      ownerVendorCustomId: vendor.id,
      ownerName: vendor.businessName,
      sourcePackageId: sourcePkg._id,
      data: { packages },
    });

    return res.status(201).json({
      status: "SUCCESS",
      message: "Template created",
      template: serializeTemplate(template),
    });
  } catch (error) {
    console.error("Create Template Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to create template",
      error: error.message,
    });
  }
};

/**
 * @desc Get the shared catalog — every vendor's templates
 */
export const getSharedTemplates = async (req, res) => {
  try {
    const templates = await Template.find().sort({ createdAt: -1 }).lean();

    return res.status(200).json({
      status: "SUCCESS",
      count: templates.length,
      templates: templates.map(serializeTemplate),
    });
  } catch (error) {
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch templates",
      error: error.message,
    });
  }
};

/**
 * @desc Get templates owned by a vendor
 */
export const getVendorTemplates = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const vendor = await resolveVendor(vendorId);
    if (!vendor) {
      return res
        .status(200)
        .json({ status: "SUCCESS", count: 0, templates: [] });
    }

    const templates = await Template.find({ ownerVendorId: vendor._id })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      status: "SUCCESS",
      count: templates.length,
      templates: templates.map(serializeTemplate),
    });
  } catch (error) {
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch vendor templates",
      error: error.message,
    });
  }
};

/**
 * @desc Get a single template by ID
 */
export const getTemplateById = async (req, res) => {
  try {
    const template = isObjectId(req.params.id)
      ? await Template.findById(req.params.id).lean()
      : null;
    if (!template) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Template not found" });
    }

    return res
      .status(200)
      .json({ status: "SUCCESS", template: serializeTemplate(template) });
  } catch (error) {
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch template",
      error: error.message,
    });
  }
};

/**
 * @desc Hard delete a template
 */
export const deleteTemplate = async (req, res) => {
  try {
    const deleted = isObjectId(req.params.id)
      ? await Template.findByIdAndDelete(req.params.id)
      : null;
    if (!deleted) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Template not found" });
    }

    return res
      .status(200)
      .json({ status: "SUCCESS", message: "Template deleted" });
  } catch (error) {
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to delete template",
      error: error.message,
    });
  }
};
