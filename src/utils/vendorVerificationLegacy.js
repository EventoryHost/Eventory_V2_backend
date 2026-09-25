import {
  VENDOR_STEPS,
  VENDOR_GROUPS,
  LEGACY_SECTION_STEPS,
} from "../constants/vendorSteps.js";
import { STEP_STATUSES } from "../models/schemas/vendorVerificationSchema.js";

/**
 * Reading vendors saved before step verification existed.
 *
 * Until migrate_vendor_verification.mjs has run, a vendor document may have no
 * `verification` at all. Everything that reads the status goes through here so
 * such a vendor reads the same before and after the migration — and the
 * migration itself uses these same mappings, so there is one definition.
 *
 *   isVerified   -> Verified (both groups Approved)
 *   otherwise    -> Pending  (isDeactivated is not a review outcome and is
 *                             left alone)
 *
 * Each legacy adminReview section fans out to its child steps (legacySteps).
 */

export const hasVerificationStatus = (v) => Boolean(v?.verification?.status);

export const deriveLegacyStatus = (v) => (v?.isVerified ? "Verified" : "Pending");

/**
 * Each adminReview section fans out to its steps. A verified vendor's steps
 * are all Approved, as the old verify endpoint set every section — a stale
 * Rejected section on a verified vendor must not read as an approved group
 * with flagged steps.
 */
export const legacySteps = (adminReview, { verified = false } = {}) => {
  const fallback = verified ? "Approved" : "Pending";
  const steps = Object.fromEntries(
    VENDOR_STEPS.map((s) => [s.key, { status: fallback, reviewedAt: null, vendorEditedAt: null }])
  );
  for (const [section, keys] of Object.entries(LEGACY_SECTION_STEPS)) {
    const review = adminReview?.[section];
    if (!review || !STEP_STATUSES.includes(review.status)) continue;
    for (const key of keys) {
      steps[key] = {
        status: verified ? "Approved" : review.status,
        ...(review.notes ? { note: String(review.notes).trim() } : {}),
        reviewedAt: review.reviewedAt || null,
        vendorEditedAt: null,
      };
    }
  }
  return steps;
};

export const legacyVerification = (v) => {
  const status = deriveLegacyStatus(v);
  const groupStatus = status === "Verified" ? "Approved" : "Pending";
  return {
    status,
    steps: legacySteps(v?.adminReview, { verified: status === "Verified" }),
    groups: Object.fromEntries(
      VENDOR_GROUPS.map((g) => [g, { status: groupStatus, decidedAt: null }])
    ),
    wasVerified: status === "Verified",
    decidedAt: null,
    submission: { count: 0, lastSubmittedAt: null },
    hasPendingEdits: false,
  };
};

/** The vendor's verification, or the one its legacy fields imply. */
export const effectiveVerification = (v) =>
  hasVerificationStatus(v) ? v.verification : legacyVerification(v);

// ----- queries -----------------------------------------------------------

const NO_STATUS = { "verification.status": null };

const LEGACY_STATUS_CLAUSES = {
  Verified: { isVerified: true },
  Pending: { isVerified: { $ne: true } },
};

/** Mongo filter: the vendor's (effective) status is one of `statuses`. */
export const statusFilter = (statuses) => ({
  $or: [
    { "verification.status": { $in: statuses } },
    ...statuses
      .filter((s) => LEGACY_STATUS_CLAUSES[s])
      .map((s) => ({ ...NO_STATUS, ...LEGACY_STATUS_CLAUSES[s] })),
  ],
});

/** Aggregation expression for the (effective) status. */
export const EFFECTIVE_STATUS_EXPR = {
  $ifNull: [
    "$verification.status",
    { $cond: [{ $eq: ["$isVerified", true] }, "Verified", "Pending"] },
  ],
};
