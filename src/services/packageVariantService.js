import Package from "../models/Package.js";
import { getModelForVendor } from "../utils/modelRegistry.js";
import { generateISTId } from "../utils/idGenerator.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { resolveVendorRefId } from "../utils/resolveVendor.js";
import { buildGroupFilter, normalizeGroupId } from "../utils/packageGroup.js";

/**
 * Package variants: the rules shared by the vendor, admin and customer paths.
 *
 * A logical package is every document sharing one packageGroupId. Each variant
 * keeps its own _id, which is what bookings, carts and checkout lines
 * reference. variantType is only the display name: it can be renamed freely
 * and is never used as an identifier.
 *
 * Invariants enforced here:
 *  - every variant in a group has the same vendor and the same vendorType;
 *  - variant names are unique within a group, ignoring case and surrounding
 *    whitespace, among the variants that are not soft-deleted.
 */

export const MAX_VARIANT_NAME_LENGTH = 60;

export class VariantError extends Error {
  constructor(message, statusCode = 400, details = undefined) {
    super(message);
    this.name = "VariantError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** Sends a VariantError in the caller's response envelope; rethrows anything else. */
export const sendVariantError = (res, error, envelope = "status") => {
  if (!(error instanceof VariantError)) throw error;
  const body =
    envelope === "success"
      ? { success: false, message: error.message, ...(error.details || {}) }
      : { status: "FAILED", message: error.message, ...(error.details || {}) };
  return res.status(error.statusCode).json(body);
};

/** Trim and collapse inner whitespace; throws on an empty or over-long name. */
export const validateVariantName = (raw) => {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new VariantError("variantType must be a non-empty string");
  }
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length > MAX_VARIANT_NAME_LENGTH) {
    throw new VariantError(
      `variantType must be at most ${MAX_VARIANT_NAME_LENGTH} characters`
    );
  }
  return name;
};

/** Combine a group filter (which may itself be an { _id: { $in } }) with more clauses. */
export const withinGroup = (groupFilter, ...clauses) => ({
  $and: [groupFilter, ...clauses.filter((c) => c && Object.keys(c).length)],
});

/**
 * The live (non-deleted) variant in this group that already uses `name`, if
 * any. Case- and whitespace-insensitive.
 */
export const findVariantNameClash = (groupFilter, name, { excludeId } = {}) =>
  Package.findOne(
    withinGroup(
      groupFilter,
      {
        variantType: {
          $regex: `^\\s*${escapeRegex(name)}\\s*$`,
          $options: "i",
        },
      },
      { packageStatus: { $ne: "Deleted" } },
      excludeId ? { _id: { $ne: excludeId } } : null
    )
  )
    .select("_id variantType packageStatus")
    .lean();

export const assertVariantNameAvailable = async (groupFilter, name, opts) => {
  const clash = await findVariantNameClash(groupFilter, name, opts);
  if (clash) {
    throw new VariantError(
      `Variant "${name}" already exists in this package`,
      409,
      { conflictingVariantId: clash._id }
    );
  }
};

/** Package.vendorId holds a "VEN…" id or a legacy Mongo _id — compare both forms. */
export const isSameVendor = async (a, b) => {
  if (a == null || b == null) return false;
  if (String(a) === String(b)) return true;
  const [ra, rb] = await Promise.all([resolveVendorRefId(a), resolveVendorRefId(b)]);
  return Boolean(ra) && String(ra) === String(rb);
};

/** The oldest variant in the group — the one that founded it. */
export const groupAnchor = (groupFilter) =>
  Package.findOne(groupFilter)
    .sort({ createdAt: 1, _id: 1 })
    .select("_id vendorId vendorType packageGroupId step1_eventAndCrew.packageName")
    .lean();

/**
 * Refuses to put a new variant into a group owned by another vendor or holding
 * another vendor type. Returns the group's anchor document, or null when the
 * group does not exist yet.
 */
export const assertCanJoinGroup = async (groupFilter, { vendorId, vendorType }) => {
  const anchor = await groupAnchor(groupFilter);
  if (!anchor) return null;
  if (!(await isSameVendor(anchor.vendorId, vendorId))) {
    throw new VariantError("This package belongs to another vendor", 403);
  }
  if (vendorType && anchor.vendorType && anchor.vendorType !== vendorType) {
    throw new VariantError(
      `Every variant of a package must have the same vendor type (this package is "${anchor.vendorType}")`,
      400
    );
  }
  return anchor;
};

/**
 * Every variant in `pkg`'s group that matches `extraFilter`, oldest first,
 * restricted to `pkg`'s own vendor. A sibling with another vendor would be a
 * data error (see migrate_package_groups.mjs); it is logged and left
 * out rather than shown to customers as part of this vendor's package.
 */
export const loadGroupVariants = async (pkg, { extraFilter = {}, select = null } = {}) => {
  const groupFilter = pkg.packageGroupId
    ? await buildGroupFilter(pkg.packageGroupId)
    : { _id: pkg._id };

  let query = Package.find(withinGroup(groupFilter, extraFilter)).sort({ createdAt: 1, _id: 1 });
  if (select) query = query.select(`${select} vendorId`);
  const docs = await query.lean();

  const kept = [];
  for (const doc of docs) {
    if (await isSameVendor(doc.vendorId, pkg.vendorId)) kept.push(doc);
    else {
      console.warn(
        `[packageVariantService] group ${normalizeGroupId(pkg.packageGroupId)}: variant ${doc._id} has vendor ${doc.vendorId}, expected ${pkg.vendorId} — excluded`
      );
    }
  }
  return { groupFilter, variants: kept };
};

// ── Cloning ────────────────────────────────────────────────────────────────

/**
 * Recursively deletes every `_id` in a lean document so a copy gets fresh
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

// Review state belongs to the source document's own history. A new variant
// starts clean and goes through review with its group.
const REVIEW_STATE_FIELDS = ["emAction", "reviewHistory", "submission", "deletedAt"];

/**
 * Lean document → unsaved copy: fresh subdocument ids, no timestamps, back to
 * Draft. `completedSteps` is kept on purpose — the copy holds all of the
 * source's data, so wiping its progress would show a finished package as an
 * empty draft.
 */
export const buildDuplicate = (leanPkg, { packageGroupId, variantType, packageName, resetReview = false }) => {
  // Mutates the lean source in place (structuredClone would turn BSON
  // ObjectIds into plain objects); callers pass a throwaway lean read.
  const copy = stripIds(leanPkg);
  delete copy.createdAt;
  delete copy.updatedAt;
  delete copy.__v;
  if (resetReview) REVIEW_STATE_FIELDS.forEach((f) => delete copy[f]);
  // The copy is a Draft; a soft-deleted source's deletion stamp never carries over.
  delete copy.deletedAt;

  copy.packageGroupId = normalizeGroupId(packageGroupId);
  copy.packageStatus = "Draft";
  if (variantType) copy.variantType = variantType;

  if (!copy.step1_eventAndCrew) copy.step1_eventAndCrew = {};
  if (packageName !== undefined) {
    copy.step1_eventAndCrew.packageName = packageName;
  }
  return copy;
};

/**
 * Add a new variant to an existing package by copying one of its variants.
 * The copy keeps the group's packageGroupId, vendorId and vendorType, gets a
 * new _id, and starts as a Draft so it goes through review before customers
 * can see it.
 *
 * @param source   lean source variant (must belong to the group)
 * @param name     validated, unique variant name
 */
export const createVariantFromSource = async (source, name, { resetReview = false } = {}) => {
  // Backfill documents predating packageGroupId, so the pair stays one package.
  let groupId = normalizeGroupId(source.packageGroupId);
  if (!groupId) {
    groupId = generateISTId("PKG_GRP");
    await Package.updateOne({ _id: source._id }, { $set: { packageGroupId: groupId } });
  }

  const Model = getModelForVendor(source.vendorType);
  const doc = new Model(
    buildDuplicate(source, { packageGroupId: groupId, variantType: name, resetReview })
  );
  await doc.save();
  return doc;
};

export default {
  VariantError,
  sendVariantError,
  validateVariantName,
  withinGroup,
  findVariantNameClash,
  assertVariantNameAvailable,
  isSameVendor,
  groupAnchor,
  assertCanJoinGroup,
  loadGroupVariants,
  buildDuplicate,
  createVariantFromSource,
};
