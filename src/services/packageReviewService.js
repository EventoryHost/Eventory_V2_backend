import Package from "../models/Package.js";
import { validatePackageSubmission } from "../validators/packageValidators.js";
import { buildGroupFilter } from "../utils/packageGroup.js";

/**
 * The package approval state machine.
 *
 * Every decision is taken on the logical package (the packageGroupId), never on
 * a single variant: approving one variant of a three-variant package and
 * leaving its siblings behind is the bug this service exists to prevent.
 *
 * Within a group, a transition only touches the variants actually sitting in a
 * legal `from` status. Variants of one group do not always agree — a duplicate
 * starts as a Draft beside an already-submitted sibling — and blanket-applying
 * the target status would publish a variant nobody reviewed.
 */

const TRANSITIONS = {
  Submitted: { from: ["Draft", "Action Required"], to: "Under Review" },
  Approved: { from: ["Under Review"], to: "Approved" },
  ActionRaised: { from: ["Under Review"], to: "Action Required" },
  Rejected: { from: ["Under Review"], to: "Deleted" },
  WentLive: { from: ["Approved"], to: "Live" },
};

export class ReviewTransitionError extends Error {
  constructor(message, statusCode = 409, details = undefined) {
    super(message);
    this.name = "ReviewTransitionError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * @desc Run one transition across a package group.
 * `set` adds fields beyond packageStatus; `by` is recorded on the audit row.
 */
const transition = async (groupFilter, event, { set = {}, inc = {}, by } = {}) => {
  const { from, to } = TRANSITIONS[event];

  const eligible = await Package.find({
    ...groupFilter,
    packageStatus: { $in: from },
  })
    .select("_id")
    .lean();

  if (eligible.length === 0) {
    const current = await Package.find(groupFilter).select("packageStatus").lean();
    if (current.length === 0) {
      throw new ReviewTransitionError("Package not found", 404);
    }
    const statuses = [...new Set(current.map((p) => p.packageStatus))];
    throw new ReviewTransitionError(
      `Cannot ${event} a package that is "${statuses.join('", "')}" — expected "${from.join('", "')}"`,
      409,
      { currentStatuses: statuses, expected: from }
    );
  }

  const now = new Date();
  const update = {
    $set: { packageStatus: to, "submission.lastDecisionAt": now, ...set },
    $push: {
      reviewHistory: { event, action: set.emAction || null, by, at: now },
    },
  };
  if (Object.keys(inc).length > 0) update.$inc = inc;

  const result = await Package.updateMany(
    { _id: { $in: eligible.map((p) => p._id) } },
    update,
    { runValidators: true }
  );

  return { matched: result.matchedCount, modified: result.modifiedCount, to };
};

/**
 * @desc Vendor submits (or resubmits) a package for EM review.
 * Every variant being submitted must pass its vendor-type validation — a
 * package is one product, so a half-valid group is not reviewable.
 */
export const submitGroup = async (groupFilter, { by } = {}) => {
  const candidates = await Package.find({
    ...groupFilter,
    packageStatus: { $in: TRANSITIONS.Submitted.from },
  }).lean();

  const failures = candidates
    .map((pkg) => ({
      packageId: pkg._id,
      variantType: pkg.variantType,
      errors: validatePackageSubmission(pkg),
    }))
    .filter((v) => v.errors.length > 0);

  if (failures.length > 0) {
    throw new ReviewTransitionError("Validation failed", 400, { variants: failures });
  }

  return transition(groupFilter, "Submitted", {
    by,
    set: { emAction: null, "submission.submittedAt": new Date() },
    inc: { "submission.count": 1 },
  });
};

/** @desc EM clears the package for sale. The vendor still has to publish it. */
export const approveGroup = async (groupFilter, { by } = {}) =>
  transition(groupFilter, "Approved", { by, set: { emAction: null } });

/**
 * @desc The review as it currently stands. Every variant carries the same
 * copy, so reading one is enough.
 */
export const getGroupAction = async (groupFilter) => {
  const pkg = await Package.findOne(groupFilter).select("emAction").lean();
  if (!pkg) throw new ReviewTransitionError("Package not found", 404);
  return pkg.emAction || null;
};

const writeAction = async (groupFilter, emAction) => {
  const result = await Package.updateMany(
    groupFilter,
    { $set: { emAction } },
    { runValidators: true }
  );
  return { matched: result.matchedCount, emAction };
};

/**
 * @desc Add or update one row of the review.
 *
 * Rows are addressed by `itemId`, or by `label` so that reviewing "Step 1"
 * twice replaces its note instead of stacking a second row for the same step.
 * This never changes packageStatus — the EM builds the review up as they work
 * through the package, then sends it back with raiseActionGroup.
 */
export const upsertReviewItem = async (
  groupFilter,
  { itemId, type, label, note, status } = {}
) => {
  const current = await getGroupAction(groupFilter);
  const items = [...(current?.items || [])];

  // An unlabelled row — a rejection bullet — has nothing to match on, so it is
  // always appended rather than collapsing into an earlier one.
  const index = items.findIndex((i) =>
    itemId
      ? String(i._id) === String(itemId)
      : Boolean(label) &&
        (i.type || "StepReview") === (type || "StepReview") &&
        (i.label || "").trim().toLowerCase() === label.trim().toLowerCase()
  );

  if (itemId && index === -1) {
    throw new ReviewTransitionError("Review item not found", 404);
  }

  const row = {
    type: type || "StepReview",
    label,
    note,
    status: status || "Rejected",
    reviewedAt: new Date(),
  };

  if (index === -1) items.push(row);
  else items[index] = { ...items[index], ...row };

  return writeAction(groupFilter, { ...(current || {}), items });
};

/** @desc Drop one row from the review. */
export const removeReviewItem = async (groupFilter, itemId) => {
  const current = await getGroupAction(groupFilter);
  const before = current?.items || [];
  const items = before.filter((i) => String(i._id) !== String(itemId));

  if (items.length === before.length) {
    throw new ReviewTransitionError("Review item not found", 404);
  }
  return writeAction(groupFilter, { ...(current || {}), items });
};

/**
 * @desc EM sends the package back with the fixes. Recoverable: the vendor
 * edits and resubmits. A terminal refusal is rejectGroup.
 *
 * `action.items` is optional — omit it to send back the review already built
 * up through upsertReviewItem, or pass a full list to raise one in a single
 * call. Either way there has to be something Rejected to act on.
 */
export const raiseActionGroup = async (groupFilter, { action, by } = {}) => {
  const current = await getGroupAction(groupFilter);
  const items = action?.items?.length ? action.items : current?.items || [];

  if (!items.some((i) => (i.status || "Rejected") === "Rejected")) {
    throw new ReviewTransitionError(
      "Nothing to send back — the review has no Rejected items",
      400
    );
  }

  return transition(groupFilter, "ActionRaised", {
    by,
    set: {
      emAction: {
        reasonCategory: action?.reasonCategory ?? current?.reasonCategory,
        summary: action?.summary ?? current?.summary,
        items,
        raisedBy: by,
        raisedAt: new Date(),
      },
    },
  });
};

/** @desc EM refuses the package outright — soft-deleted, not reviewable again. */
export const rejectGroup = async (groupFilter, { reason, by } = {}) =>
  transition(groupFilter, "Rejected", {
    by,
    set: {
      emAction: {
        reasonCategory: reason?.category,
        summary: reason?.summary,
        items: (reason?.items?.length
          ? reason.items
          : [{ note: reason?.summary || "Package rejected" }]
        ).map((i) => ({
          ...i,
          type: "Rejection",
          status: "Rejected",
          reviewedAt: new Date(),
        })),
      },
    },
  });

/** @desc Vendor publishes an approved package to the marketplace. */
export const goLiveGroup = async (groupFilter, { by } = {}) =>
  transition(groupFilter, "WentLive", { by });

/** @desc Convenience wrapper for callers holding a packageGroupId string. */
export const resolveGroup = (packageGroupId) => buildGroupFilter(packageGroupId);

export default {
  submitGroup,
  approveGroup,
  getGroupAction,
  upsertReviewItem,
  removeReviewItem,
  raiseActionGroup,
  rejectGroup,
  goLiveGroup,
  resolveGroup,
  ReviewTransitionError,
};
