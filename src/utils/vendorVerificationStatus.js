import { VENDOR_GROUPS, STEP_BY_KEY } from "../constants/vendorSteps.js";

/**
 * The profile-level status, derived from the two group decisions — highest
 * priority first:
 *
 *   Needs Action       still visible to customers (isVerified) but a group is
 *                      no longer approved: a verified vendor edited a step
 *   Rejected           any group Rejected
 *   Changes Requested  any group Changes Requested
 *   Verified           both groups Approved
 *   Pending            otherwise
 *
 * `isVerified` is what keeps "Needs Action" apart from "Pending": it turns on
 * when both groups are approved and off only when the admin sends a group back
 * or rejects it — a vendor edit leaves it on.
 */
export const deriveStatus = (verification, isVerified) => {
  const statuses = VENDOR_GROUPS.map((g) => verification?.groups?.[g]?.status || "Pending");
  const allApproved = statuses.every((s) => s === "Approved");
  if (isVerified && !allApproved) return "Needs Action";
  if (statuses.includes("Rejected")) return "Rejected";
  if (statuses.includes("Changes Requested")) return "Changes Requested";
  if (allApproved) return "Verified";
  return "Pending";
};

/**
 * Whether the vendor may change a step's fields right now. While its group is
 * Changes Requested, only the steps marked Not correct are open; a Rejected
 * group is redone in full, and anything else is freely editable.
 *
 * A Not correct step the vendor has started fixing since the group was sent
 * back stays open until the group resubmits: the app saves several steps one
 * screen at a time (Team & Experience is three PATCHes, Services & Event Types
 * two), and the first save already resets the step to Pending.
 */
export const isStepEditable = (verification, stepKey) => {
  const group = STEP_BY_KEY[stepKey]?.group;
  const decision = verification?.groups?.[group];
  if (decision?.status !== "Changes Requested") return true;
  const step = verification?.steps?.[stepKey];
  if (step?.status === "Rejected") return true;
  return (
    (step?.status || "Pending") === "Pending" &&
    Boolean(step?.vendorEditedAt) &&
    Boolean(decision.decidedAt) &&
    new Date(step.vendorEditedAt) >= new Date(decision.decidedAt)
  );
};
