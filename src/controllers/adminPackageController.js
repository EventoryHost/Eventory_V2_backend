import Package, { PACKAGE_STATUSES } from "../models/Package.js";
import Vendor from "../models/Vendor.js";
import {
  EM_ITEM_TYPES,
  EM_ITEM_STATUSES,
  EM_DOC_KEYS,
} from "../models/schemas/emActionSchema.js";
import {
  buildGroupFilter,
  buildGroupFilterFromPackageId,
} from "../utils/packageGroup.js";
import {
  approveGroup,
  getGroupAction,
  upsertReviewItem,
  removeReviewItem,
  raiseActionGroup,
  rejectGroup,
  ReviewTransitionError,
} from "../services/packageReviewService.js";

/**
 * The EM review surface.
 *
 * Every decision applies to a package group, never to a single variant —
 * approving one variant and leaving its siblings Under Review would put half a
 * package on the marketplace. The per-packageId endpoints are kept for the
 * existing EM panel, but they resolve the id to its group first.
 */

const sendReviewError = (res, error, fallback) => {
  if (error instanceof ReviewTransitionError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      ...(error.details || {}),
    });
  }
  return res
    .status(500)
    .json({ success: false, message: fallback, error: error.message });
};

/** Resolve either a :packageGroupId or a :packageId route param to a group filter. */
const resolveGroupFilter = async (req) => {
  const { packageGroupId, packageId } = req.params;
  if (packageGroupId) {
    if (!String(packageGroupId).trim()) return null;
    return buildGroupFilter(packageGroupId);
  }
  return buildGroupFilterFromPackageId(packageId);
};

/** Normalise one review row. Returns { error } for a bad payload. */
const parseItem = (item) => {
  const type = item?.type ?? "StepReview";
  if (!EM_ITEM_TYPES.includes(type)) {
    return { error: `type must be one of: ${EM_ITEM_TYPES.join(", ")}` };
  }

  const status = item?.status ?? "Rejected";
  if (!EM_ITEM_STATUSES.includes(status)) {
    return { error: `status must be one of: ${EM_ITEM_STATUSES.join(", ")}` };
  }

  const note = typeof item?.note === "string" ? item.note.trim() : "";
  // Only a Rejected row is shown to the vendor, so only it needs to say why.
  if (status === "Rejected" && !note) {
    return { error: "A Rejected item needs a non-empty note" };
  }

  // The app drives its uploader from docKey, so a document row without one
  // gives the vendor something they cannot action.
  const docKey = item?.docKey ?? null;
  if (type === "DocumentRequired") {
    if (!EM_DOC_KEYS.includes(docKey)) {
      return { error: `A DocumentRequired item needs a docKey: ${EM_DOC_KEYS.join(", ")}` };
    }
  } else if (docKey !== null) {
    return { error: "docKey only applies to a DocumentRequired item" };
  }

  return { item: { type, docKey, label: item?.label?.trim(), note, status } };
};

/**
 * Normalise a raise-action body into the emAction shape. `items` is optional:
 * omit it to send back the review already built through review-item.
 */
const parseAction = (body) => {
  const { reasonCategory, summary, items } = body || {};

  if (items !== undefined && (!Array.isArray(items) || items.length === 0)) {
    return { error: "items must be a non-empty array when provided" };
  }

  const parsed = [];
  for (const item of items || []) {
    const { error, item: row } = parseItem(item);
    if (error) return { error };
    parsed.push(row);
  }

  return {
    action: {
      reasonCategory: reasonCategory?.trim(),
      summary: summary?.trim(),
      items: items === undefined ? undefined : parsed,
    },
  };
};

// GET /api/admin/packages/review-queue
export const getReviewQueue = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const skip = (page - 1) * limit;

    const matchStage = { packageStatus: "Under Review" };
    if (search) {
      const vendors = await Vendor.find({ businessName: { $regex: search, $options: "i" } }).select("id").lean();
      const matchingVendorIds = vendors.map(v => v.id);

      matchStage.$or = [
        { "step1_eventAndCrew.packageName": { $regex: search, $options: "i" } },
        { vendorId: { $in: matchingVendorIds } }
      ];
    }

    const groupsRaw = await Package.aggregate([
      { $match: matchStage },
      { $sort: { updatedAt: 1 } },
      {
        $group: {
          _id: { $ifNull: ["$packageGroupId", "$_id"] },
          variants: { $push: "$$ROOT" },
          updatedAt: { $first: "$updatedAt" }
        }
      },
      { $sort: { updatedAt: 1 } },
      { $skip: skip },
      { $limit: parseInt(limit) }
    ]);

    const vendorIds = [...new Set(groupsRaw.flatMap(g => g.variants.map(v => v.vendorId)))];
    const vendors = await Vendor.find({ id: { $in: vendorIds } })
      .select("id businessName city phone isVerified vendorType")
      .lean();

    const vendorMap = {};
    vendors.forEach(v => vendorMap[v.id] = v);

    // The review state belongs to the group, so surface it once on the group
    // rather than making the panel dig it out of an arbitrary variant.
    const groups = groupsRaw.map(g => ({
      ...g,
      emAction: g.variants[0]?.emAction || null,
      submission: g.variants[0]?.submission || null,
      variants: g.variants.map(v => ({
        ...v,
        vendorId: vendorMap[v.vendorId] || v.vendorId
      }))
    }));

    const counts = await Package.aggregate([
      { $match: matchStage },
      { $group: { _id: { $ifNull: ["$packageGroupId", "$_id"] } } },
      { $count: "total" }
    ]);
    const total = counts.length > 0 ? counts[0].total : 0;

    res.status(200).json({
      success: true,
      data: groups,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/packages/review-queue/count
export const getReviewQueueCount = async (req, res) => {
  try {
    const counts = await Package.aggregate([
      { $match: { packageStatus: "Under Review" } },
      { $group: { _id: { $ifNull: ["$packageGroupId", "$_id"] } } },
      { $count: "total" }
    ]);
    const count = counts.length > 0 ? counts[0].total : 0;
    res.status(200).json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/packages/:packageId
export const getPackageDetails = async (req, res) => {
  try {
    const pkgRaw = await Package.findById(req.params.packageId).lean();
    if (!pkgRaw) return res.status(404).json({ success: false, message: "Package not found" });

    const vendor = await Vendor.findOne({ id: pkgRaw.vendorId }).lean();
    const pkg = { ...pkgRaw, vendorId: vendor || pkgRaw.vendorId };

    res.status(200).json({ success: true, data: pkg });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/admin/packages/group/:packageGroupId/approve
 * PUT /api/admin/packages/:packageId/approve
 *
 * Clears the package for sale. It does NOT publish it — the vendor presses Go
 * Live once approved.
 */
export const approvePackage = async (req, res) => {
  try {
    const groupFilter = await resolveGroupFilter(req);
    if (!groupFilter) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }

    const result = await approveGroup(groupFilter, { by: req.body?.reviewedBy });
    const data = await Package.find(groupFilter).lean();

    res.status(200).json({
      success: true,
      packageStatus: result.to,
      count: result.matched,
      data,
    });
  } catch (error) {
    sendReviewError(res, error, "Failed to approve package");
  }
};

/**
 * PUT /api/admin/packages/group/:packageGroupId/raise-action
 * PUT /api/admin/packages/:packageId/raise-action
 * Body: { reasonCategory?, summary?, items?: [{ type?, label?, note, status? }] }
 *
 * Sends the package back to the vendor with the fixes. Omit `items` to send
 * back the review already built through review-item. Recoverable: the vendor
 * edits and resubmits. A terminal refusal is rejectPackage.
 */
export const raiseAction = async (req, res) => {
  try {
    const { error, action } = parseAction(req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    const groupFilter = await resolveGroupFilter(req);
    if (!groupFilter) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }

    const result = await raiseActionGroup(groupFilter, {
      action,
      by: req.body?.reviewedBy,
    });
    const data = await Package.find(groupFilter).lean();

    res.status(200).json({
      success: true,
      packageStatus: result.to,
      count: result.matched,
      data,
    });
  } catch (err) {
    sendReviewError(res, err, "Failed to raise action");
  }
};

/**
 * PUT /api/admin/packages/group/:packageGroupId/review-item
 * PUT /api/admin/packages/:packageId/review-item
 * Body: { label?, note?, status?, itemId? }
 *
 * Records one row of the review as the EM works through the package. A row is
 * matched by `itemId`, or by `label`, so reviewing "Step 1" twice updates that
 * row rather than adding a second one. Anything can be labelled — "Step 1",
 * "Document Requirements", or nothing at all.
 *
 * This never changes packageStatus; the EM finishes with raise-action.
 */
export const reviewItem = async (req, res) => {
  try {
    const { itemId, label, note } = req.body || {};
    // A rejection bullet carries only a note, so a label is not always needed —
    // but a row with none of the three says nothing at all.
    if (!itemId && !label?.trim() && !note?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Provide a label or a note, or an itemId of an existing row",
      });
    }

    const { error, item } = parseItem(req.body);
    if (error) return res.status(400).json({ success: false, message: error });

    const groupFilter = await resolveGroupFilter(req);
    if (!groupFilter) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }

    const result = await upsertReviewItem(groupFilter, { itemId, ...item });

    res.status(200).json({
      success: true,
      count: result.matched,
      emAction: result.emAction,
    });
  } catch (err) {
    sendReviewError(res, err, "Failed to save review item");
  }
};

/**
 * DELETE /api/admin/packages/group/:packageGroupId/review-item/:itemId
 * DELETE /api/admin/packages/:packageId/review-item/:itemId
 */
export const deleteReviewItem = async (req, res) => {
  try {
    const groupFilter = await resolveGroupFilter(req);
    if (!groupFilter) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }

    const result = await removeReviewItem(groupFilter, req.params.itemId);

    res.status(200).json({
      success: true,
      count: result.matched,
      emAction: result.emAction,
    });
  } catch (error) {
    sendReviewError(res, error, "Failed to remove review item");
  }
};

/**
 * PUT /api/admin/packages/:packageId/request-fix
 * Body: { notes }
 *
 * The legacy shape, which used to throw the notes away. It now sends back the
 * review built up through review-item, with `notes` as the general summary.
 */
export const requestFix = async (req, res) => {
  try {
    const { notes } = req.body;

    const groupFilter = await resolveGroupFilter(req);
    if (!groupFilter) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }

    // `notes` on its own is the whole review for this legacy shape. A summary
    // renders no row on the card, so record it as one rather than sending the
    // vendor back a card with nothing to act on.
    const current = await getGroupAction(groupFilter);
    const hasRows = (current?.items || []).some((i) => i.status === "Rejected");
    if (!hasRows && notes?.trim()) {
      await upsertReviewItem(groupFilter, {
        type: "Custom",
        note: notes.trim(),
        status: "Rejected",
      });
    }

    const result = await raiseActionGroup(groupFilter, {
      action: { summary: notes?.trim() },
      by: req.body?.reviewedBy,
    });
    const data = await Package.find(groupFilter).lean();

    res.status(200).json({
      success: true,
      packageStatus: result.to,
      count: result.matched,
      data,
    });
  } catch (error) {
    sendReviewError(res, error, "Failed to request fix");
  }
};

/**
 * PUT /api/admin/packages/group/:packageGroupId/reject
 * PUT /api/admin/packages/:packageId/reject
 * Body: { reason?: { category, summary, items } }
 *
 * Terminal: the package is soft-deleted and does not come back for review.
 */
export const rejectPackage = async (req, res) => {
  try {
    const groupFilter = await resolveGroupFilter(req);
    if (!groupFilter) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }

    const result = await rejectGroup(groupFilter, {
      reason: req.body?.reason,
      by: req.body?.reviewedBy,
    });
    const data = await Package.find(groupFilter).lean();

    res.status(200).json({
      success: true,
      packageStatus: result.to,
      count: result.matched,
      data,
    });
  } catch (error) {
    sendReviewError(res, error, "Failed to reject package");
  }
};

// GET /api/admin/packages/group/:packageGroupId
export const getPackageGroup = async (req, res) => {
  try {
    const packagesRaw = await Package.find(
      await buildGroupFilter(req.params.packageGroupId)
    ).lean();

    const vendorIds = [...new Set(packagesRaw.map(p => p.vendorId))];
    const vendors = await Vendor.find({ id: { $in: vendorIds } }).lean();

    const vendorMap = {};
    vendors.forEach(v => vendorMap[v.id] = v);

    const packages = packagesRaw.map(p => ({
      ...p,
      vendorId: vendorMap[p.vendorId] || p.vendorId
    }));

    res.status(200).json({ success: true, data: packages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/packages/all
export const getAllPackages = async (req, res) => {
  try {
    const { page = 1, limit = 10, packageStatus, vendorType, vendorId } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    if (packageStatus) query.packageStatus = packageStatus;
    if (vendorType) query.vendorType = vendorType;
    if (vendorId) query.vendorId = vendorId;

    const packagesRaw = await Package.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const vendorIds = [...new Set(packagesRaw.map(p => p.vendorId))];
    const vendors = await Vendor.find({ id: { $in: vendorIds } })
      .select("id businessName")
      .lean();

    const vendorMap = {};
    vendors.forEach(v => vendorMap[v.id] = v);

    const packages = packagesRaw.map(p => ({
      ...p,
      vendorId: vendorMap[p.vendorId] || p.vendorId
    }));

    const total = await Package.countDocuments(query);

    res.status(200).json({
      success: true,
      data: packages,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/admin/packages/:packageId/status
 *
 * The support escape hatch: it bypasses the state machine on purpose, so it
 * stays a single-document write.
 */
export const updatePackageStatus = async (req, res) => {
  try {
    const { packageStatus } = req.body;

    if (!PACKAGE_STATUSES.includes(packageStatus)) {
      return res.status(400).json({ success: false, message: "Invalid package status" });
    }

    const pkg = await Package.findByIdAndUpdate(
      req.params.packageId,
      { packageStatus },
      { new: true }
    );
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found" });

    res.status(200).json({ success: true, data: pkg });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/admin/packages/:packageId/review-step
 * Body: { step: "step1".."step4", status, notes }
 *
 * The legacy per-step shape, kept for the existing EM panel. Steps are no
 * longer a separate block — this writes the same review row that review-item
 * does, labelled "Step N". Marking a step never changes packageStatus; the EM
 * finishes with approve or raise-action.
 */
export const reviewPackageStep = async (req, res) => {
  try {
    const { step, status, notes } = req.body;

    const stepNumber = /^step[1-4]$/.test(String(step)) ? String(step).slice(-1) : null;
    if (!stepNumber) {
      return res.status(400).json({ success: false, message: "Invalid step name" });
    }

    const { error, item } = parseItem({ label: `Step ${stepNumber}`, note: notes, status });
    if (error) return res.status(400).json({ success: false, message: error });

    const groupFilter = await buildGroupFilterFromPackageId(req.params.packageId);
    if (!groupFilter) {
      return res.status(404).json({ success: false, message: "Package not found" });
    }

    const result = await upsertReviewItem(groupFilter, item);

    res.status(200).json({
      success: true,
      count: result.matched,
      emAction: result.emAction,
    });
  } catch (error) {
    sendReviewError(res, error, "Failed to review step");
  }
};
