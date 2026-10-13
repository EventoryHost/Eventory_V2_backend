import mongoose from "mongoose";
import Vendor from "../models/Vendor.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { computeCompletion, completionSummary } from "../utils/profileCompletion.js";
import {
  EFFECTIVE_STATUS_EXPR,
  effectiveVerification,
  hasVerificationStatus,
  statusFilter,
} from "../utils/vendorVerificationLegacy.js";
import { LEGACY_SECTION_STEPS } from "../constants/vendorSteps.js";
import { VERIFICATION_STATUSES } from "../models/schemas/vendorVerificationSchema.js";
import {
  reviewStep,
  reviewSteps,
  adminEditStep,
  requestChanges as requestProfileChanges,
  verify as verifyProfile,
  reject as rejectProfile,
  approveGroup,
  requestGroupChanges,
  rejectGroup,
  getHistory,
  ReviewTransitionError,
} from "../services/vendorVerificationService.js";

// ----- helpers --------------------------------------------------------------

const sendError = (res, error) => {
  if (error instanceof ReviewTransitionError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      ...(error.details || {}),
    });
  }
  if (error?.name === "ValidationError" || error?.name === "CastError") {
    return res.status(400).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: error.message });
};

const str = (value) => (typeof value === "string" ? value.trim() : "");
const reviewerOf = (body) => str(body?.reviewedBy) || str(body?.by) || "Admin";

/** The vendor as the admin screens get it: document + completion, side by side. */
const vendorResponse = (vendor) => {
  const data = typeof vendor.toObject === "function" ? vendor.toObject() : { ...vendor };
  if (!hasVerificationStatus(data)) data.verification = effectiveVerification(data);
  const profileCompletion = computeCompletion(data);
  return { success: true, data: { ...data, profileCompletion }, profileCompletion };
};

/** A lean list row: effective verification plus the queue's completion summary. */
const queueRow = (row) => {
  if (!hasVerificationStatus(row)) {
    row.verification = effectiveVerification(row);
  }
  const summary = completionSummary(row);
  row.verification = { ...row.verification, completionPercent: summary.percent };
  row.profileCompletion = summary;
  return row;
};

const SEARCH_FIELDS = ["pocName", "businessName", "city", "state", "serviceAreas.area", "serviceAreas.sublocalities", "serviceAreas", "phone", "email", "id"];

/** Case-insensitive, regex-escaped match over the admin search fields. */
const searchClause = (search) => {
  const q = str(search).slice(0, 100);
  if (!q) return null;
  const rx = { $regex: escapeRegex(q), $options: "i" };
  return { $or: SEARCH_FIELDS.map((f) => ({ [f]: rx })) };
};

const NOT_COMPLETE = { "verification.completionPercent": { $not: { $gte: 100 } } };
const COMPLETE = { "verification.completionPercent": { $gte: 100 } };

// "incomplete" leaves out the two outcomes a vendor can't be "still filling in".
const NOT_FINAL = VERIFICATION_STATUSES.filter((st) => st !== "Verified" && st !== "Rejected");

/** The review-queue `filter` keys (Amendments 1 and 2). */
export const QUEUE_FILTERS = {
  incomplete: () => ({ $and: [NOT_COMPLETE, statusFilter(NOT_FINAL)] }),
  complete: () => COMPLETE,
  submitted: () => ({ $and: [COMPLETE, statusFilter(["Pending"])] }),
  changes_requested: () => statusFilter(["Changes Requested"]),
  verified: () => statusFilter(["Verified"]),
  unverified: () => statusFilter(VERIFICATION_STATUSES.filter((st) => st !== "Verified")),
  rejected: () => statusFilter(["Rejected"]),
  needs_action: () => statusFilter(["Needs Action"]),
  all: () => null,
};
const DEFAULT_QUEUE_FILTER = "unverified";

const QUEUE_SORTS = {
  createdAt: "createdAt",
  assignedEmName: "assignedEmName",
  businessName: "businessName",
  completionPercent: "verification.completionPercent",
};

/** Build the review-queue Mongo filter from the query string. Returns { error } on bad input. */
const buildQueueFilter = (query) => {
  const clauses = [];

  const status = str(query.status);
  const filter = str(query.filter);

  if (status && status.toLowerCase() !== "all") {
    const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
    const bad = statuses.filter((s) => !VERIFICATION_STATUSES.includes(s));
    if (bad.length) {
      return { error: `Unknown status "${bad.join('", "')}" — expected any of: ${VERIFICATION_STATUSES.join(", ")}` };
    }
    clauses.push(statusFilter(statuses));
  }

  // `filter` defaults to "unverified" only when neither it nor `status` is given.
  const filterKey = filter || (status ? "" : DEFAULT_QUEUE_FILTER);
  if (filterKey) {
    if (!Object.hasOwn(QUEUE_FILTERS, filterKey)) {
      return { error: `Unknown filter "${filterKey}" — expected one of: ${Object.keys(QUEUE_FILTERS).join(", ")}` };
    }
    const clause = QUEUE_FILTERS[filterKey]();
    if (clause) clauses.push(clause);
  }

  const search = searchClause(query.search);
  if (search) clauses.push(search);

  if (query.hasPendingEdits === "true") clauses.push({ "verification.hasPendingEdits": true });
  else if (query.hasPendingEdits === "false") clauses.push({ "verification.hasPendingEdits": { $ne: true } });

  const vendorType = str(query.vendorType);
  if (vendorType) clauses.push({ vendorType });

  const assignedEmId = str(query.assignedEmId);
  if (assignedEmId) {
    clauses.push({ assignedEmId: assignedEmId === "unassigned" ? null : assignedEmId });
  }

  return { mongo: clauses.length ? { $and: clauses } : {} };
};

// ----- review queue ------------------------------------------------------------

// GET /api/admin/vendors/review-queue
// ?filter=incomplete|complete|submitted|changes_requested|verified|unverified|rejected|needs_action|all
//   (default unverified)
// &status=<comma list of VERIFICATION_STATUSES> &search= &hasPendingEdits=true &vendorType=
// &assignedEmId=<id>|unassigned &sortBy=createdAt|assignedEmName|businessName|completionPercent
// &sortOrder=asc|desc (legacy: sort=asc|desc) &page= &limit=
export const getReviewQueue = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const skip = (page - 1) * limit;

    const { mongo, error } = buildQueueFilter(req.query);
    if (error) return res.status(400).json({ success: false, message: error });

    const direction = (str(req.query.sortOrder) || str(req.query.sort) || "desc") === "asc" ? 1 : -1;
    const sortPath = QUEUE_SORTS[str(req.query.sortBy)] || "createdAt";
    const sort = { [sortPath]: direction };
    if (sortPath !== "createdAt") sort.createdAt = -1;

    let find = Vendor.find(mongo).select("-verificationHistory").sort(sort).skip(skip).limit(limit);
    // Names sort case-insensitively, like the package queue's $toLower.
    if (sortPath === "assignedEmName" || sortPath === "businessName") {
      find = find.collation({ locale: "en", strength: 2 });
    }

    const [vendors, total] = await Promise.all([find.lean(), Vendor.countDocuments(mongo)]);

    res.status(200).json({
      success: true,
      data: vendors.map(queueRow),
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    sendError(res, error);
  }
};

// GET /api/admin/vendors/review-queue/count
// `count` keeps its old meaning: Pending and not deactivated.
export const getReviewQueueCount = async (req, res) => {
  try {
    const statusIs = (s) => ({ $eq: ["$status", s] });
    const sumIf = (cond) => ({ $sum: { $cond: [cond, 1, 0] } });
    const complete = { $gte: ["$percent", 100] };

    const [row] = await Vendor.aggregate([
      {
        $project: {
          status: EFFECTIVE_STATUS_EXPR,
          percent: { $ifNull: ["$verification.completionPercent", -1] },
          deactivated: { $eq: ["$isDeactivated", true] },
          pendingEdits: { $eq: ["$verification.hasPendingEdits", true] },
        },
      },
      {
        $group: {
          _id: null,
          all: { $sum: 1 },
          count: sumIf({ $and: [statusIs("Pending"), { $not: ["$deactivated"] }] }),
          Pending: sumIf(statusIs("Pending")),
          ChangesRequested: sumIf(statusIs("Changes Requested")),
          Verified: sumIf(statusIs("Verified")),
          Rejected: sumIf(statusIs("Rejected")),
          NeedsAction: sumIf(statusIs("Needs Action")),
          pendingEdits: sumIf("$pendingEdits"),
          incomplete: sumIf({
            $and: [{ $not: [complete] }, { $in: ["$status", NOT_FINAL] }],
          }),
          complete: sumIf(complete),
          submitted: sumIf({ $and: [complete, statusIs("Pending")] }),
        },
      },
    ]);
    const r = row || {};
    const n = (k) => r[k] || 0;

    res.status(200).json({
      success: true,
      count: n("count"),
      byStatus: {
        Pending: n("Pending"),
        "Changes Requested": n("ChangesRequested"),
        Verified: n("Verified"),
        Rejected: n("Rejected"),
        "Needs Action": n("NeedsAction"),
      },
      pendingEdits: n("pendingEdits"),
      byFilter: {
        incomplete: n("incomplete"),
        complete: n("complete"),
        submitted: n("submitted"),
        changes_requested: n("ChangesRequested"),
        verified: n("Verified"),
        unverified: n("all") - n("Verified"),
        rejected: n("Rejected"),
        needs_action: n("NeedsAction"),
        all: n("all"),
      },
    });
  } catch (error) {
    sendError(res, error);
  }
};

// GET /api/admin/vendors/search-suggestions?q=&limit=8
export const getSearchSuggestions = async (req, res) => {
  try {
    const q = str(req.query.q);
    if (q.length < 2) return res.status(200).json({ success: true, data: [] });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 20);

    const vendors = await Vendor.find(searchClause(q))
      .select("-verificationHistory")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.status(200).json({
      success: true,
      data: vendors.map((v) => ({
        id: v.id,
        businessName: v.businessName ?? null,
        pocName: v.pocName ?? null,
        city: v.city ?? null,
        state: v.state ?? null,
        phone: v.phone ?? null,
        profilePicture: v.profilePicture ?? null,
        verificationStatus: effectiveVerification(v).status,
        completionPercent: computeCompletion(v).percent,
      })),
    });
  } catch (error) {
    sendError(res, error);
  }
};

// ----- one vendor --------------------------------------------------------------

// GET /api/admin/vendors/:id
export const getVendorDetails = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ id: req.params.id });
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    res.status(200).json(vendorResponse(vendor));
  } catch (error) {
    sendError(res, error);
  }
};

// PUT /api/admin/vendors/:id/review-step
// Body: { stepKey, status: "Approved"|"Rejected"|"Pending", note, reviewedBy }
export const reviewVendorStep = async (req, res) => {
  try {
    const { stepKey, status, note } = req.body || {};
    const vendor = await reviewStep(req.params.id, stepKey, { status, note, by: reviewerOf(req.body) });
    res.status(200).json(vendorResponse(vendor));
  } catch (error) {
    sendError(res, error);
  }
};

// PUT /api/admin/vendors/:id/edit-step/:stepKey
// Body: { fields: {...}, markCorrect?, reviewedBy }
export const editVendorStep = async (req, res) => {
  try {
    const { fields, markCorrect } = req.body || {};
    const vendor = await adminEditStep(req.params.id, req.params.stepKey, fields, {
      by: reviewerOf(req.body),
      markCorrect: markCorrect === true,
    });
    res.status(200).json(vendorResponse(vendor));
  } catch (error) {
    sendError(res, error);
  }
};

// PUT /api/admin/vendors/:id/verify — approves both groups
// Body: { finalNote? (legacy: notes), reviewedBy }
export const verifyVendor = async (req, res) => {
  try {
    const body = req.body || {};
    const vendor = await verifyProfile(req.params.id, {
      finalNote: body.finalNote ?? body.notes,
      by: reviewerOf(body),
    });
    res.status(200).json(vendorResponse(vendor));
  } catch (error) {
    sendError(res, error);
  }
};

// PUT /api/admin/vendors/:id/reject — rejects both groups; the account stays active
// Body: { finalNote (legacy: reason), reviewedBy }
export const rejectVendor = async (req, res) => {
  try {
    const body = req.body || {};
    const vendor = await rejectProfile(req.params.id, {
      finalNote: body.finalNote ?? body.reason,
      by: reviewerOf(body),
    });
    res.status(200).json(vendorResponse(vendor));
  } catch (error) {
    sendError(res, error);
  }
};

// PUT /api/admin/vendors/:id/request-changes — every group with a flagged step
// Body: { finalNote (legacy: notes), reviewedBy }
export const requestChanges = async (req, res) => {
  try {
    const body = req.body || {};
    const vendor = await requestProfileChanges(req.params.id, {
      finalNote: body.finalNote ?? body.notes,
      by: reviewerOf(body),
    });
    res.status(200).json(vendorResponse(vendor));
  } catch (error) {
    sendError(res, error);
  }
};

// PUT /api/admin/vendors/:id/groups/:group/approve | request-changes | reject
// group: businessProfile | personalDocuments
// Body: { finalNote (required for request-changes and reject), reviewedBy }
const groupDecision = (decide) => async (req, res) => {
  try {
    const body = req.body || {};
    const vendor = await decide(req.params.id, req.params.group, {
      finalNote: body.finalNote,
      by: reviewerOf(body),
    });
    res.status(200).json(vendorResponse(vendor));
  } catch (error) {
    sendError(res, error);
  }
};

export const approveVendorGroup = groupDecision(approveGroup);
export const requestVendorGroupChanges = groupDecision(requestGroupChanges);
export const rejectVendorGroup = groupDecision(rejectGroup);

// GET /api/admin/vendors/:id/verification-history  (newest first)
export const getVerificationHistory = async (req, res) => {
  try {
    const data = await getHistory(req.params.id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    sendError(res, error);
  }
};

// PUT /api/admin/vendors/:id/review-section  (LEGACY — until the admin panel ships step review)
// Body: { section, status, notes }. Applies the verdict to each of the section's steps.
export const reviewSection = async (req, res) => {
  try {
    const { section, status, notes } = req.body || {};

    if (!Object.hasOwn(LEGACY_SECTION_STEPS, section)) {
      return res.status(400).json({ success: false, message: "Invalid section name" });
    }

    const vendor = await reviewSteps(
      req.params.id,
      LEGACY_SECTION_STEPS[section].map((stepKey) => ({ stepKey, status, note: notes })),
      { by: reviewerOf(req.body) }
    );
    res.status(200).json(vendorResponse(vendor));
  } catch (error) {
    sendError(res, error);
  }
};

// GET /api/admin/vendors/all
export const getAllVendors = async (req, res) => {
  try {
    const { page = 1, limit = 10, vendorType, isVerified, isDeactivated, city, state, search, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    if (vendorType) query.vendorType = vendorType;
    if (isVerified !== undefined && isVerified !== 'all') query.isVerified = isVerified === 'true';
    if (isDeactivated !== undefined && isDeactivated !== 'all') query.isDeactivated = isDeactivated === 'true';
    if (city) query.city = { $regex: `^${escapeRegex(city)}$`, $options: 'i' };
    if (state) query.state = { $regex: `^${escapeRegex(state)}$`, $options: 'i' };
    
    if (search) {
      const rx = { $regex: escapeRegex(String(search).slice(0, 100)), $options: 'i' };
      query.$or = [
        { businessName: rx },
        { pocName: rx },
        { email: rx },
        { phone: rx },
        { id: rx }
      ];
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    console.log("[getAllVendors] req.query:", req.query);
    console.log("[getAllVendors] Constructed query:", JSON.stringify(query));
    
    const vendors = await Vendor.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Vendor.countDocuments(query);

    res.status(200).json({
      success: true,
      data: vendors,
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

// PUT /api/admin/vendors/:id/assign-em
// Body: { emId, emName }
export const assignEmToVendor = async (req, res) => {
  try {
    const { emId, emName } = req.body;
    const isObjectId = mongoose.isValidObjectId(req.params.id);
    const filter = isObjectId
      ? { $or: [{ id: req.params.id }, { _id: req.params.id }] }
      : { id: req.params.id };

    const vendor = await Vendor.findOneAndUpdate(
      filter,
      {
        $set: { assignedEmId: emId || null, assignedEmName: emName || null },
        $push: {
          verificationHistory: {
            event: "EmAssigned",
            emId: emId || null,
            emName: emName || null,
            by: reviewerOf(req.body),
            at: new Date(),
          },
        },
      },
      { new: true }
    );
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    res.status(200).json({ success: true, data: vendor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
