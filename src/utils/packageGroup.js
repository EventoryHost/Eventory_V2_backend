import mongoose from "mongoose";
import Package from "../models/Package.js";

const OBJECT_ID_HEX = /^[0-9a-fA-F]{24}$/;

/**
 * @desc Resolve a packageGroupId to a filter that matches both the current
 * String ids (PKG_GRP…) and legacy rows that still store a BSON ObjectId.
 * The raw driver is used for the legacy lookup because Mongoose would cast an
 * ObjectId back to a string for this now-String path.
 *
 * Lives here rather than in packageController because the admin review
 * endpoints resolve the same ids — see PACKAGE_GROUP_ID_MISMATCH.md for why
 * the legacy fallback cannot be dropped.
 */
export const buildGroupFilter = async (rawId) => {
  const id = String(rawId ?? "").trim();
  const stringFilter = { packageGroupId: id };

  if (!OBJECT_ID_HEX.test(id)) return stringFilter;
  if (await Package.exists(stringFilter)) return stringFilter;

  const legacy = await Package.collection
    .find(
      { packageGroupId: new mongoose.Types.ObjectId(id) },
      { projection: { _id: 1 } }
    )
    .toArray();

  return legacy.length
    ? { _id: { $in: legacy.map((d) => d._id) } }
    : stringFilter;
};

/**
 * @desc Resolve a single variant's _id to a filter covering its whole group.
 * Documents predating packageGroupId have no siblings, so they resolve to
 * themselves rather than failing — the same fallback duplicatePackage uses.
 * Returns null when the id matches no package at all.
 */
export const buildGroupFilterFromPackageId = async (packageId) => {
  const pkg = await Package.findById(packageId).select("packageGroupId").lean();
  if (!pkg) return null;
  return pkg.packageGroupId
    ? await buildGroupFilter(pkg.packageGroupId)
    : { _id: pkg._id };
};

export default { buildGroupFilter, buildGroupFilterFromPackageId };
