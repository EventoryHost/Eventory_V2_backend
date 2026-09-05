import mongoose from "mongoose";
import Package from "../models/Package.js";

const OBJECT_ID_HEX = /^[0-9a-fA-F]{24}$/;

/**
 * Resolve a packageGroupId to a Mongo filter that matches both the current
 * String ids (PKG_GRP…) and legacy rows that still store a BSON ObjectId —
 * Package.js's own packageGroupId field is declared `type: String`, but a
 * real, pre-existing chunk of data (every currently-Live package in both
 * dev and prod, confirmed 2026-09-01 while building the PDP "Most booked"
 * variants work) has it stored as a raw ObjectId instead, from before this
 * field was migrated to String. A plain `Package.find({packageGroupId})`
 * silently 0-matches every one of those documents — not a crash, just
 * always empty/404 — since Mongo compares BSON types strictly (a String
 * query value never matches a document field stored as ObjectId, same hex
 * or not). The raw driver is used for the legacy lookup because Mongoose
 * would cast an ObjectId back to a string for this now-String path.
 *
 * MOVED HERE 2026-09-01, extracted verbatim (same logic, not rewritten)
 * from its original module-private location in packageController.js (the
 * vendor-management router), which had already solved this exact problem
 * for the vendor-side group endpoints (getPackageGroup/updatePackageGroup/
 * hardDeletePackage/getVendorPackages) — but the customer-facing
 * getPackageGroupVariants (customerDiscoveryController.js) never reused it,
 * so the PDP's variant-picker group endpoint was silently broken (404) for
 * every real Live package in both databases until this was found and
 * fixed. Same "an existing fix wasn't reused across the vendor/customer
 * boundary" pattern as resolveVendorForPackage (src/utils/resolveVendor.js)
 * earlier in this engagement.
 */
export const buildGroupFilter = async (rawId) => {
  const id = String(rawId ?? "").trim();
  const stringFilter = { packageGroupId: id };

  if (!OBJECT_ID_HEX.test(id)) return stringFilter;
  if (await Package.exists(stringFilter)) return stringFilter;

  const legacy = await Package.collection
    .find({ packageGroupId: new mongoose.Types.ObjectId(id) }, { projection: { _id: 1 } })
    .toArray();

  return legacy.length ? { _id: { $in: legacy.map((d) => d._id) } } : stringFilter;
};

export default buildGroupFilter;
