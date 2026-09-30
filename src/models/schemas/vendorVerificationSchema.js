import mongoose from "mongoose";
import { EM_ITEM_STATUSES } from "./emActionSchema.js";
import { VENDOR_STEPS, VENDOR_GROUPS } from "../../constants/vendorSteps.js";

/**
 * The admin review of a vendor profile, step by step — the vendor-side twin of
 * a package's emAction.
 *
 * Each step (see constants/vendorSteps.js) carries its own verdict and note.
 * The steps fall into two review groups (businessProfile, personalDocuments),
 * and the admin decides each group on its own with a final note — Approve,
 * Request changes or Reject, like a package. The profile's `status` is derived
 * from the two groups (see utils/vendorVerificationStatus.js). The state
 * machine lives in services/vendorVerificationService.js; nothing else should
 * write `status` or `groups`.
 */

/** Same vocabulary as package review rows. The UI labels them Correct / Not correct. */
export const STEP_STATUSES = EM_ITEM_STATUSES;

/**
 * The profile status, derived from the groups. Title case, like packageStatus.
 * "Needs Action": a verified vendor edited a step since; they stay visible to
 * customers (isVerified) until the admin sends a group back or rejects it.
 */
export const VERIFICATION_STATUSES = [
  "Pending",
  "Changes Requested",
  "Verified",
  "Rejected",
  "Needs Action",
];

/** One review group's decision. */
export const GROUP_STATUSES = ["Pending", "Changes Requested", "Approved", "Rejected"];

export const VERIFICATION_EVENTS = [
  "Submitted", // the vendor changed a reviewed step (stepKey)
  "StepReviewed",
  "AdminEdited",
  "GroupApproved",
  "GroupChangesRequested",
  "GroupRejected",
  "Resubmitted", // a sent-back group has nothing flagged left and is back to Pending
  "Verified", // both groups approved
  "NeedsAction", // a verified vendor edited a step
  "EmAssigned",
];

export const StepReviewSchema = new mongoose.Schema(
  {
    status: { type: String, enum: STEP_STATUSES, default: "Pending" },
    // What the vendor reads. Required (by the service) on a Rejected step.
    note: { type: String, trim: true },
    // The note the vendor was fixing, kept after their edit resets the step so
    // the admin can see what was asked.
    previousNote: { type: String, trim: true },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, trim: true },
    vendorEditedAt: { type: Date, default: null },
  },
  { _id: false }
);

export const GroupDecisionSchema = new mongoose.Schema(
  {
    status: { type: String, enum: GROUP_STATUSES, default: "Pending" },
    finalNote: { type: String, trim: true },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: String, trim: true },
  },
  { _id: false }
);

const VendorGroupsSchema = new mongoose.Schema(
  Object.fromEntries(
    VENDOR_GROUPS.map((g) => [g, { type: GroupDecisionSchema, default: () => ({}) }])
  ),
  { _id: false }
);

// Explicit keys rather than a Map, so "verification.steps.pan.status" is a
// real schema path that $set validates.
const VendorStepsSchema = new mongoose.Schema(
  Object.fromEntries(
    VENDOR_STEPS.map((s) => [s.key, { type: StepReviewSchema, default: () => ({}) }])
  ),
  { _id: false }
);

export const VendorVerificationSchema = new mongoose.Schema(
  {
    status: { type: String, enum: VERIFICATION_STATUSES, default: "Pending", index: true },
    steps: { type: VendorStepsSchema, default: () => ({}) },
    groups: { type: VendorGroupsSchema, default: () => ({}) },
    // Set once, the first time both groups are approved.
    wasVerified: { type: Boolean, default: false },
    // The latest group decision's note, time and admin (each group keeps its own).
    finalNote: { type: String, trim: true },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: String, trim: true },
    submission: {
      count: { type: Number, default: 0 },
      lastSubmittedAt: { type: Date, default: null },
    },
    // The vendor changed a step after an admin last reviewed it.
    hasPendingEdits: { type: Boolean, default: false, index: true },
    // Denormalised copy of computeCompletion(vendor).percent so the review
    // queue can filter on it. Kept in sync by the Vendor pre-save hook and the
    // verification service; computeCompletion stays the source of truth.
    completionPercent: { type: Number, min: 0, max: 100, default: 0, index: true },
  },
  { _id: false }
);

/** Append-only audit row. */
export const VendorVerificationEventSchema = new mongoose.Schema(
  {
    event: { type: String, enum: VERIFICATION_EVENTS, required: true },
    stepKey: { type: String },
    group: { type: String },
    status: { type: String },
    note: { type: String, trim: true },
    finalNote: { type: String, trim: true },
    fields: { type: [String], default: undefined },
    // EmAssigned only.
    emId: { type: String },
    emName: { type: String, trim: true },
    by: { type: String, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

export default VendorVerificationSchema;
