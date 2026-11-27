import mongoose from "mongoose";
import Package from "../models/Package.js";

const OBJECT_ID_HEX = /^[0-9a-fA-F]{24}$/;

/**
 * The canonical (String) form of a packageGroupId, whatever BSON type it was
 * read as. Legacy documents store it as an ObjectId; String(ObjectId) is the
 * same 24-char hex, so both forms normalise to one value.
 */
export const normalizeGroupId = (value) => {
  if (value === undefined || value === null) return null;
  const id = String(value).trim();
  return id || null;
};

/**
 * @desc Resolve a packageGroupId to a filter that matches EVERY variant in the
 * group, whether its packageGroupId is stored as a String (PKG_GRP…, or the
 * hex of a legacy id) or as a legacy BSON ObjectId.
 *
 * The schema declares the field String, but older data holds raw ObjectIds
 * (see PACKAGE_GROUP_ID_MISMATCH.md). Mongo compares BSON types strictly, so
 * a String query value never matches an ObjectId field.
 *
 * The previous version returned the String-only filter as soon as ONE String
 * document matched. A group became mixed-type the moment a variant was added
 * to a legacy group (the new document is written through Mongoose, which
 * casts the id to String), and from then on every group read returned only
 * the new variant and silently dropped the legacy siblings. Both forms are
 * now always matched.
 *
 * The raw driver is used for the lookup because Mongoose would cast an
 * ObjectId query value back to String for this String path.
 */
export const buildGroupFilter = async (rawId) => {
  const id = normalizeGroupId(rawId) ?? "";
  const stringFilter = { packageGroupId: id };

  if (!OBJECT_ID_HEX.test(id)) return stringFilter;

  const docs = await Package.collection
    .find(
      { packageGroupId: { $in: [id, new mongoose.Types.ObjectId(id)] } },
      { projection: { _id: 1, packageGroupId: 1 } }
    )
    .toArray();

  const hasLegacy = docs.some((d) => typeof d.packageGroupId !== "string");
  return hasLegacy ? { _id: { $in: docs.map((d) => d._id) } } : stringFilter;
};

/**
 * @desc Resolve a single variant's _id to a filter covering its whole group.
 * Documents predating packageGroupId have no siblings, so they resolve to
 * themselves rather than failing — the same fallback duplicatePackage uses.
 * Returns null when the id matches no package at all.
 */
export const buildGroupFilterFromPackageId = async (packageId) => {
  if (!mongoose.isValidObjectId(packageId)) return null;
  const pkg = await Package.findById(packageId).select("packageGroupId").lean();
  if (!pkg) return null;
  return pkg.packageGroupId
    ? await buildGroupFilter(pkg.packageGroupId)
    : { _id: pkg._id };
};

export default { buildGroupFilter, buildGroupFilterFromPackageId, normalizeGroupId };
