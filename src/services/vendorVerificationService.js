import Vendor from "../models/Vendor.js";
import {
  STEP_KEYS,
  STEP_BY_KEY,
  STEP_BY_FIELD,
  STEPS_BY_GROUP,
  VENDOR_GROUPS,
  GROUP_LABELS,
  isStepKey,
  isGroupKey,
} from "../constants/vendorSteps.js";
import { STEP_STATUSES } from "../models/schemas/vendorVerificationSchema.js";
import { VENDOR_DOC_FIELDS } from "../models/schemas/emActionSchema.js";
import { legacyVerification } from "../utils/vendorVerificationLegacy.js";
import { computeCompletion } from "../utils/profileCompletion.js";
import { deriveStatus, isStepEditable } from "../utils/vendorVerificationStatus.js";
import { ReviewTransitionError } from "../utils/reviewTransitionError.js";

export { ReviewTransitionError };

/**
 * The vendor profile verification state machine — the vendor-side twin of
 * packageReviewService.js.
 *
 * The admin works through the profile step by step (reviewStep, adminEditStep),
 * which never changes a decision. The steps fall into two review groups
 * (businessProfile, personalDocuments) and the admin decides each group on its
 * own, with a final note: approve, request changes, or reject.
 *
 *   request changes   the vendor fixes the steps marked Not correct
 *   reject            every step in the group is marked Not correct and the
 *                     vendor redoes the group from its first step
 *
 * Either way the vendor's save resets each step it touches (onVendorEdit), and
 * once nothing in the group is flagged the group goes back to Pending on its
 * own. Nothing here deactivates the account.
 *
 * The profile `status` is derived from the groups (vendorVerificationStatus.js)
 * and re-derived after every change.
 *
 * Every exported function takes the public vendor id ("VEN…") and returns the
 * saved Vendor document.
 */

const GROUP_TRANSITIONS = {
  approve: { from: ["Pending", "Changes Requested"], to: "Approved", event: "GroupApproved" },
  requestChanges: {
    from: ["Pending", "Changes Requested", "Approved", "Rejected"],
    to: "Changes Requested",
    event: "GroupChangesRequested",
  },
  reject: {
    from: ["Pending", "Changes Requested", "Approved", "Rejected"],
    to: "Rejected",
    event: "GroupRejected",
  },
  resubmit: { from: ["Changes Requested", "Rejected"], to: "Pending", event: "Resubmitted" },
};

const VERBS = {
  approve: "approve",
  requestChanges: "request changes on",
  reject: "reject",
  resubmit: "resubmit",
};

const clean = (value) => (typeof value === "string" ? value.trim() : "");
const byOf = (by) => clean(by) || "Admin";

// ----- document helpers (pure, no I/O) -----------------------------------

/** Make sure `vendor.verification` is real — legacy documents get theirs derived. */
const ensureVerification = (vendor) => {
  if (!vendor.verification || !vendor.verification.status) {
    vendor.verification = legacyVerification(vendor.toObject());
  }
  if (vendor.$locals?.verificationBackfilled) vendor.markModified("verification");
  return vendor.verification;
};

const stepOf = (vendor, key) => {
  const steps = vendor.verification.steps;
  if (!steps[key]) steps[key] = {};
  return steps[key];
};

const groupOf = (vendor, group) => {
  const groups = vendor.verification.groups;
  if (!groups[group]) groups[group] = {};
  return groups[group];
};

const groupStatus = (vendor, group) => vendor.verification.groups?.[group]?.status || "Pending";

/** stepKeys marked Not correct — in one group, or anywhere. */
const rejectedSteps = (vendor, group) =>
  (group ? STEPS_BY_GROUP[group] : STEP_KEYS).filter(
    (k) => vendor.verification.steps?.[k]?.status === "Rejected"
  );

/** A step the vendor changed after the admin last looked at it. */
const recomputePendingEdits = (vendor) => {
  const steps = vendor.verification.steps || {};
  vendor.verification.hasPendingEdits = STEP_KEYS.some((k) => {
    const s = steps[k];
    return Boolean(s?.vendorEditedAt) && (!s.reviewedAt || s.vendorEditedAt > s.reviewedAt);
  });
};

const syncCompletion = (vendor) => {
  const percent = computeCompletion(vendor).percent;
  if (vendor.verification.completionPercent !== percent) {
    vendor.verification.completionPercent = percent;
  }
  return percent;
};

const pushEvent = (vendor, event) => {
  vendor.verificationHistory.push({ ...event, at: new Date() });
};

/**
 * Re-derive the profile status, recording the moments that matter: the
 * profile becoming Verified, and a verified vendor's edit (Needs Action).
 */
const refreshStatus = (vendor, { by } = {}) => {
  const before = vendor.verification.status;
  const next = deriveStatus(vendor.verification, vendor.isVerified);
  vendor.verification.status = next;
  if (next !== before && next === "Verified") pushEvent(vendor, { event: "Verified", status: next, by });
  if (next !== before && next === "Needs Action") pushEvent(vendor, { event: "NeedsAction", status: next, by });
  return next;
};

/** Move one group to its next status, or throw 409 when that is not allowed from here. */
const moveGroup = (vendor, group, action, { by, finalNote } = {}) => {
  const { from, to, event } = GROUP_TRANSITIONS[action];
  const current = groupStatus(vendor, group);
  if (!from.includes(current)) {
    throw new ReviewTransitionError(
      `Cannot ${VERBS[action]} ${GROUP_LABELS[group]} while it is "${current}" — expected "${from.join('", "')}"`,
      409,
      { group, currentStatus: current, expected: from }
    );
  }
  const decision = groupOf(vendor, group);
  decision.status = to;
  pushEvent(vendor, { event, group, status: to, ...(finalNote ? { finalNote } : {}), by });
  return decision;
};

// ----- persistence ---------------------------------------------------------

const loadVendor = async (vendorId) => {
  if (typeof vendorId !== "string" || !vendorId.trim()) {
    throw new ReviewTransitionError("Vendor not found", 404);
  }
  const vendor = await Vendor.findOne({ id: vendorId.trim() });
  if (!vendor) throw new ReviewTransitionError("Vendor not found", 404);
  ensureVerification(vendor);
  return vendor;
};

// Only what this call changed is validated — an old document with some
// unrelated invalid value must not block a review.
const persist = async (vendor) => {
  syncCompletion(vendor);
  await vendor.save({ validateModifiedOnly: true });
  return vendor;
};

// ----- step review ------------------------------------------------------------

const assertStepKey = (stepKey) => {
  if (!isStepKey(stepKey)) {
    throw new ReviewTransitionError(
      `Unknown stepKey "${stepKey}" — expected one of: ${STEP_KEYS.join(", ")}`,
      400
    );
  }
};

/** Apply one verdict to a loaded vendor. Never changes the profile status. */
const applyStepReview = (vendor, stepKey, { status, note, by } = {}) => {
  assertStepKey(stepKey);
  if (!STEP_STATUSES.includes(status)) {
    throw new ReviewTransitionError(`status must be one of: ${STEP_STATUSES.join(", ")}`, 400);
  }
  const text = clean(note);
  if (status === "Rejected" && !text) {
    throw new ReviewTransitionError(
      `A note is required when marking "${STEP_BY_KEY[stepKey].label}" as not correct — the vendor needs to know what to fix`,
      400
    );
  }

  const step = stepOf(vendor, stepKey);
  step.status = status;
  step.note = text || undefined;
  step.reviewedAt = new Date();
  step.reviewedBy = by;

  pushEvent(vendor, { event: "StepReviewed", stepKey, status, ...(text ? { note: text } : {}), by });
  recomputePendingEdits(vendor);
};

/**
 * @desc Admin marks one step Correct (Approved), Not correct (Rejected, note
 * required) or clears it back to Pending.
 */
export const reviewStep = async (vendorId, stepKey, { status, note, by } = {}) => {
  assertStepKey(stepKey);
  const vendor = await loadVendor(vendorId);
  applyStepReview(vendor, stepKey, { status, note, by: byOf(by) });
  return persist(vendor);
};

/** @desc Several verdicts in one save (the legacy section endpoint). */
export const reviewSteps = async (vendorId, reviews, { by } = {}) => {
  const vendor = await loadVendor(vendorId);
  for (const r of reviews) applyStepReview(vendor, r.stepKey, { ...r, by: byOf(by) });
  return persist(vendor);
};

// ----- admin edit ---------------------------------------------------------

const AADHAAR_RE = /^\d{12}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{9,18}$/;

// Normalise, then validate, each identity number. Blank clears the number.
const ID_NUMBERS = {
  aadharNumber: {
    normalise: (v) => String(v).replace(/[\s-]/g, ""),
    re: AADHAAR_RE,
    message: "Aadhaar must be 12 digits",
    verified: "isAadharVerified",
  },
  panNumber: {
    normalise: (v) => String(v).replace(/\s/g, "").toUpperCase(),
    re: PAN_RE,
    message: "PAN must look like AAAAA9999A",
    verified: "isPanVerified",
  },
  gstNumber: {
    normalise: (v) => String(v).replace(/\s/g, "").toUpperCase(),
    re: GSTIN_RE,
    message: "GSTIN must be a valid 15-character GST number",
    verified: "isGstVerified",
  },
};

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";

const BOOLEAN_FIELDS = new Set([
  "isIndividual",
  "isAgreementAccepted",
  "isAadharVerified",
  "isFaceMatchVerified",
  "isPanVerified",
  "isGstVerified",
  "isGstSkipped",
  "isFssaiVerified",
  "isTradeLicVerified",
]);

/**
 * Bank accounts, in the model's real shape: an array of
 * {beneficiaryId, beneficiaryName, accountNumber, ifscCode, bankName, branchName}.
 *
 * `value` is either the whole list (replaces it) or one account object: with
 * an `_id` it updates that account, without one it is added. beneficiaryId is
 * server-owned — it is kept only for an account whose number and IFSC are
 * unchanged, so a changed account is re-registered with the payout provider.
 */
const buildBankDetails = (vendor, value) => {
  const existing = (vendor.bankDetails || []).map((b) => (b.toObject ? b.toObject() : { ...b }));
  let next;
  if (Array.isArray(value)) {
    next = value;
  } else if (value && typeof value === "object") {
    const index = value._id ? existing.findIndex((b) => String(b._id) === String(value._id)) : -1;
    if (value._id && index === -1) {
      throw new ReviewTransitionError("Bank account not found", 404);
    }
    next = [...existing];
    if (index === -1) next.push(value);
    else next[index] = { ...existing[index], ...value };
  } else {
    throw new ReviewTransitionError("bankDetails must be an account object or a list of accounts", 400);
  }

  return next.map((raw, i) => {
    if (!raw || typeof raw !== "object") {
      throw new ReviewTransitionError(`bankDetails[${i}] must be an object`, 400);
    }
    const accountNumber = String(raw.accountNumber ?? "").replace(/\s/g, "");
    const ifscCode = String(raw.ifscCode ?? "").replace(/\s/g, "").toUpperCase();
    if (!ACCOUNT_RE.test(accountNumber)) {
      throw new ReviewTransitionError(`bankDetails[${i}].accountNumber must be 9-18 digits`, 400);
    }
    if (!IFSC_RE.test(ifscCode)) {
      throw new ReviewTransitionError(`bankDetails[${i}].ifscCode must look like ABCD0123456`, 400);
    }
    const same = existing.find(
      (b) => b.accountNumber === accountNumber && b.ifscCode === ifscCode && b.beneficiaryId
    );
    const account = {
      beneficiaryName: clean(raw.beneficiaryName) || undefined,
      accountNumber,
      ifscCode,
      bankName: clean(raw.bankName) || undefined,
      branchName: clean(raw.branchName) || undefined,
      beneficiaryId: same ? same.beneficiaryId : null,
    };
    if (raw._id) account._id = raw._id;
    return account;
  });
};

/**
 * Pick the step's own fields out of `patch`, validate and normalise them, and
 * apply the side rules a vendor edit has: a changed KYC number or document
 * clears its verified flag. Returns the field names that actually changed.
 */
const applyAdminFields = (vendor, stepKey, patch) => {
  const step = STEP_BY_KEY[stepKey];
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new ReviewTransitionError("fields must be an object", 400);
  }
  const picked = Object.fromEntries(
    step.fields.filter((f) => Object.hasOwn(patch, f)).map((f) => [f, patch[f]])
  );
  if (Object.keys(picked).length === 0) {
    throw new ReviewTransitionError(
      `No editable field for "${step.label}" in the request — expected any of: ${step.fields.join(", ")}`,
      400
    );
  }

  const updates = {};
  for (const [field, value] of Object.entries(picked)) {
    if (BOOLEAN_FIELDS.has(field)) {
      if (typeof value !== "boolean") {
        throw new ReviewTransitionError(`${field} must be true or false`, 400);
      }
      updates[field] = value;
    } else if (ID_NUMBERS[field]) {
      const rule = ID_NUMBERS[field];
      if (isBlank(value)) {
        updates[field] = null;
      } else {
        const normalised = rule.normalise(value);
        if (!rule.re.test(normalised)) throw new ReviewTransitionError(rule.message, 400);
        updates[field] = normalised;
      }
    } else if (field === "bankDetails") {
      updates.bankDetails = buildBankDetails(vendor, value);
    } else if (field === "email" && !isBlank(value)) {
      const email = String(value).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ReviewTransitionError("email is not a valid address", 400);
      }
      updates.email = email;
    } else if (
      (typeof value === "string" && value.startsWith("data:")) ||
      (Array.isArray(value) && value.some((v) => typeof v === "string" && v.startsWith("data:")))
    ) {
      throw new ReviewTransitionError(`${field} must be an uploaded file URL, not inline data`, 400);
    } else {
      updates[field] = value;
    }
  }

  // A changed identity number has not been verified — unless the admin says so
  // in the same edit.
  for (const [field, rule] of Object.entries(ID_NUMBERS)) {
    if (
      Object.hasOwn(updates, field) &&
      (updates[field] ?? null) !== (vendor[field] ?? null) &&
      !Object.hasOwn(updates, rule.verified)
    ) {
      updates[rule.verified] = false;
    }
  }
  // Same for a replaced business document.
  for (const { url, verified } of Object.values(VENDOR_DOC_FIELDS)) {
    if (
      Object.hasOwn(updates, url) &&
      (updates[url] ?? null) !== (vendor[url] ?? null) &&
      !Object.hasOwn(updates, verified)
    ) {
      updates[verified] = false;
    }
  }
  if (updates.isAgreementAccepted === true && !vendor.isAgreementAccepted) {
    updates.agreementAcceptedAt = new Date();
  }

  const before = vendor.toObject();
  vendor.set(updates);
  const after = vendor.toObject();
  return Object.keys(updates).filter((f) => !sameValue(before[f], after[f]));
};

/**
 * @desc Admin adds or corrects a step's data themselves. The step keeps its
 * verdict (the admin made the fix); `markCorrect` also marks it Correct.
 */
export const adminEditStep = async (vendorId, stepKey, patch, { by, markCorrect } = {}) => {
  assertStepKey(stepKey);
  const vendor = await loadVendor(vendorId);
  const who = byOf(by);
  const fields = applyAdminFields(vendor, stepKey, patch);

  const event = { event: "AdminEdited", stepKey, fields, by: who };
  if (markCorrect === true) {
    const step = stepOf(vendor, stepKey);
    step.status = "Approved";
    step.reviewedAt = new Date();
    step.reviewedBy = who;
    event.status = "Approved";
  }
  pushEvent(vendor, event);
  recomputePendingEdits(vendor);
  return persist(vendor);
};

// ----- decisions -------------------------------------------------------------

const assertGroupKey = (group) => {
  if (!isGroupKey(group)) {
    throw new ReviewTransitionError(
      `Unknown group "${group}" — expected one of: ${VENDOR_GROUPS.join(", ")}`,
      400
    );
  }
};

const requireNote = (finalNote, what) => {
  const text = clean(finalNote);
  if (!text) throw new ReviewTransitionError(`A final note is required to ${what}`, 400);
  return text;
};

const recordDecision = (vendor, decision, { by, finalNote }) => {
  const now = new Date();
  decision.finalNote = finalNote || null;
  decision.decidedAt = now;
  decision.decidedBy = by;
  // The profile-level copy is the latest decision, whichever group it was.
  vendor.verification.finalNote = finalNote || null;
  vendor.verification.decidedAt = now;
  vendor.verification.decidedBy = by;
};

const flaggedError = (flagged, where) =>
  new ReviewTransitionError(
    `Clear or fix the ${flagged.length} incorrect step${flagged.length === 1 ? "" : "s"}${where} first`,
    409,
    { flaggedSteps: flagged }
  );

/** Approve one group. Its unreviewed steps are marked Correct. */
const applyApprove = (vendor, group, { by, finalNote }) => {
  const flagged = rejectedSteps(vendor, group);
  if (flagged.length) throw flaggedError(flagged, ` in ${GROUP_LABELS[group]}`);
  const decision = moveGroup(vendor, group, "approve", { by, finalNote });

  const now = new Date();
  for (const key of STEPS_BY_GROUP[group]) {
    const step = stepOf(vendor, key);
    if ((step.status || "Pending") === "Pending") {
      step.status = "Approved";
      step.reviewedAt = now;
      step.reviewedBy = by;
    }
  }
  recordDecision(vendor, decision, { by, finalNote });

  if (VENDOR_GROUPS.every((g) => groupStatus(vendor, g) === "Approved")) {
    vendor.isVerified = true;
    vendor.verification.wasVerified = true;
  }
  recomputePendingEdits(vendor);
};

/** Send one group back with its flagged steps. The vendor loses the verified badge. */
const applyRequestChanges = (vendor, group, { by, finalNote }) => {
  if (rejectedSteps(vendor, group).length === 0) {
    throw new ReviewTransitionError(
      `Nothing to send back — no step in ${GROUP_LABELS[group]} is marked not correct`,
      400
    );
  }
  const decision = moveGroup(vendor, group, "requestChanges", { by, finalNote });
  recordDecision(vendor, decision, { by, finalNote });
  vendor.isVerified = false;
};

/**
 * Reject one group: every counted step in it is Not correct, and the vendor
 * redoes it from step 1. Optional steps (businessDocuments) are left as they
 * are — the app's redo flow doesn't pass through them, so flagging one would
 * leave the group unable to resubmit.
 */
const applyReject = (vendor, group, { by, finalNote }) => {
  const decision = moveGroup(vendor, group, "reject", { by, finalNote });
  const now = new Date();
  for (const key of STEPS_BY_GROUP[group].filter((k) => STEP_BY_KEY[k].counted)) {
    const step = stepOf(vendor, key);
    step.status = "Rejected";
    step.note = finalNote;
    step.reviewedAt = now;
    step.reviewedBy = by;
  }
  recordDecision(vendor, decision, { by, finalNote });
  vendor.isVerified = false;
  recomputePendingEdits(vendor);
};

/** @desc Approve one review group (finalNote optional). */
export const approveGroup = async (vendorId, group, { finalNote, by } = {}) => {
  assertGroupKey(group);
  const vendor = await loadVendor(vendorId);
  const who = byOf(by);
  applyApprove(vendor, group, { by: who, finalNote: clean(finalNote) || null });
  refreshStatus(vendor, { by: who });
  return persist(vendor);
};

/** @desc Send one review group back to the vendor (finalNote required). */
export const requestGroupChanges = async (vendorId, group, { finalNote, by } = {}) => {
  assertGroupKey(group);
  const note = requireNote(finalNote, "request changes");
  const vendor = await loadVendor(vendorId);
  const who = byOf(by);
  applyRequestChanges(vendor, group, { by: who, finalNote: note });
  refreshStatus(vendor, { by: who });
  return persist(vendor);
};

/** @desc Reject one review group (finalNote required). The account stays active. */
export const rejectGroup = async (vendorId, group, { finalNote, by } = {}) => {
  assertGroupKey(group);
  const note = requireNote(finalNote, "reject");
  const vendor = await loadVendor(vendorId);
  const who = byOf(by);
  applyReject(vendor, group, { by: who, finalNote: note });
  refreshStatus(vendor, { by: who });
  return persist(vendor);
};

/** @desc Legacy /verify: approve every group not yet approved. */
export const verify = async (vendorId, { finalNote, by } = {}) => {
  const vendor = await loadVendor(vendorId);
  const who = byOf(by);
  const flagged = rejectedSteps(vendor);
  if (flagged.length) throw flaggedError(flagged, "");
  const open = VENDOR_GROUPS.filter((g) => groupStatus(vendor, g) !== "Approved");
  if (open.length === 0) {
    throw new ReviewTransitionError("This vendor is already verified", 409, {
      currentStatus: vendor.verification.status,
    });
  }
  for (const g of open) applyApprove(vendor, g, { by: who, finalNote: clean(finalNote) || null });
  refreshStatus(vendor, { by: who });
  return persist(vendor);
};

/** @desc Legacy /request-changes: send back every group that has a flagged step. */
export const requestChanges = async (vendorId, { finalNote, by } = {}) => {
  const note = requireNote(finalNote, "request changes");
  const vendor = await loadVendor(vendorId);
  const who = byOf(by);
  const groups = VENDOR_GROUPS.filter((g) => rejectedSteps(vendor, g).length > 0);
  if (groups.length === 0) {
    throw new ReviewTransitionError("Nothing to send back — no step is marked not correct", 400);
  }
  for (const g of groups) applyRequestChanges(vendor, g, { by: who, finalNote: note });
  refreshStatus(vendor, { by: who });
  return persist(vendor);
};

/** @desc Legacy /reject: reject both groups. */
export const reject = async (vendorId, { finalNote, by } = {}) => {
  const note = requireNote(finalNote, "reject a vendor");
  const vendor = await loadVendor(vendorId);
  const who = byOf(by);
  for (const g of VENDOR_GROUPS) applyReject(vendor, g, { by: who, finalNote: note });
  refreshStatus(vendor, { by: who });
  return persist(vendor);
};

export const getHistory = async (vendorId) => {
  const vendor = await loadVendor(vendorId);
  // Reverse first so events written in the same millisecond keep newest-first.
  return [...(vendor.verificationHistory || [])]
    .map((e) => (e.toObject ? e.toObject() : e))
    .reverse()
    .sort((a, b) => new Date(b.at) - new Date(a.at));
};

// ----- vendor edits ------------------------------------------------------------

/** Deep compare of two stored values, ignoring subdocument _ids. */
export const sameValue = (a, b) => JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));

function normalise(value) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalise);
  if (typeof value === "object" && value.constructor?.name === "ObjectId") return String(value);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((k) => k !== "_id")
        .sort()
        .map((k) => [k, normalise(value[k])])
    );
  }
  return value;
}

/**
 * Which of `fields` the vendor may not change right now: while a group is
 * Changes Requested, only its Not correct steps are open (isStepEditable).
 */
export const lockedFields = (verification, fields) =>
  fields.filter((f) => {
    const key = STEP_BY_FIELD[f];
    return key ? !isStepEditable(verification, key) : false;
  });

/**
 * Apply a vendor save to the review. Mutates the document.
 *
 * `changedFields` are the fields whose value changed. `savedFields` are all
 * the fields the vendor sent: in a sent-back group a flagged step counts as
 * fixed once the vendor saves it, even with the same value (a rejected group
 * is redone step by step, and much of it may stay as it was).
 *
 * For each touched step that had been reviewed: back to Pending, the admin's
 * note kept as previousNote. A touched step in an Approved group re-opens that
 * group. A sent-back group with nothing flagged left resubmits itself — the
 * vendor never taps "resubmit". A verified vendor stays visible to customers
 * while the admin looks at the edit (Needs Action).
 */
const applyVendorEdit = (vendor, changedFields, { savedFields = [], by = "Vendor" } = {}) => {
  ensureVerification(vendor);
  const touched = new Set(changedFields.map((f) => STEP_BY_FIELD[f]).filter(Boolean));
  for (const f of savedFields) {
    const key = STEP_BY_FIELD[f];
    if (!key) continue;
    const sentBack = ["Changes Requested", "Rejected"].includes(groupStatus(vendor, STEP_BY_KEY[key].group));
    if (sentBack && vendor.verification.steps?.[key]?.status === "Rejected") touched.add(key);
  }

  const now = new Date();
  const fieldsOf = (key) => [...new Set([...changedFields, ...savedFields])].filter((f) => STEP_BY_FIELD[f] === key);

  for (const key of touched) {
    const step = stepOf(vendor, key);
    const group = STEP_BY_KEY[key].group;
    if (groupStatus(vendor, group) === "Approved") groupOf(vendor, group).status = "Pending";
    if ((step.status || "Pending") === "Pending") continue;
    step.previousNote = step.note || undefined;
    step.note = undefined;
    step.status = "Pending";
    step.vendorEditedAt = now;
    pushEvent(vendor, { event: "Submitted", stepKey: key, group, fields: fieldsOf(key), by });
  }
  recomputePendingEdits(vendor);

  for (const group of VENDOR_GROUPS) {
    const status = groupStatus(vendor, group);
    if (GROUP_TRANSITIONS.resubmit.from.includes(status) && rejectedSteps(vendor, group).length === 0) {
      moveGroup(vendor, group, "resubmit", { by });
      vendor.verification.submission.count = (vendor.verification.submission.count || 0) + 1;
      vendor.verification.submission.lastSubmittedAt = now;
    }
  }
  refreshStatus(vendor, { by });
};

/**
 * @desc Called after the vendor's own PATCH has been written. `vendor` is the
 * updated document; `changedFields` the top-level fields whose value changed;
 * `savedFields` every field the vendor sent. Also refreshes the stored
 * completion percentage, which a findOneAndUpdate does not.
 */
export const onVendorEdit = async (vendor, changedFields, { savedFields = [], by = "Vendor" } = {}) => {
  applyVendorEdit(vendor, changedFields, { savedFields, by });
  syncCompletion(vendor);
  if (vendor.isModified()) await vendor.save({ validateModifiedOnly: true });
  return vendor;
};

/**
 * @desc Save a vendor document the vendor's own action changed (the KYC and
 * bank verification flows), tracking the edit like a PATCH would.
 */
export const saveVendorEdit = async (vendor, { by = "Vendor" } = {}) => {
  const changed = [...new Set(vendor.modifiedPaths().map((p) => p.split(".")[0]))];
  if (changed.length) applyVendorEdit(vendor, changed, { savedFields: changed, by });
  await vendor.save();
  return vendor;
};

/** For tests: the in-memory pieces, no database. */
export const _internal = {
  GROUP_TRANSITIONS,
  ensureVerification,
  applyStepReview,
  applyAdminFields,
  applyVendorEdit,
  applyApprove,
  applyRequestChanges,
  applyReject,
  refreshStatus,
  rejectedSteps,
  recomputePendingEdits,
  buildBankDetails,
};

export default {
  reviewStep,
  reviewSteps,
  adminEditStep,
  approveGroup,
  requestGroupChanges,
  rejectGroup,
  verify,
  requestChanges,
  reject,
  getHistory,
  onVendorEdit,
  saveVendorEdit,
  lockedFields,
  ReviewTransitionError,
};
