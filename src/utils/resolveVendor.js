import mongoose from "mongoose";
import Vendor from "../models/Vendor.js";
import { PUBLIC_VENDOR_FIELDS } from "./publicFields.js";

/**
 * REAL BUG FOUND during Phase 0-5 end-to-end testing (2026-08-13,
 * testsuite.pdf): every currently-seeded Package document has a
 * Package.vendorId that holds the Vendor's own business-facing `id`
 * string (e.g. "VEN20260511163553528") instead of the Vendor's Mongo
 * `_id` — which is what Package.js's own schema declares
 * (`type: ObjectId, ref: "Vendor"`) and what every `.populate("vendorId")`
 * / `$lookup` call across this codebase assumes. This is a pre-existing
 * seed-data mismatch, not introduced here — but it breaks EVERY
 * customer-facing read that joins a Package to its Vendor: PDP and
 * browsePackages (a hard 500 via `.populate().lean()`'s CastError, or a
 * silently-missing vendor via plain `.populate()`), Wishlist, Compare, and
 * — most seriously — new Cart/Booking documents that COPY vendorId
 * forward from Package at add-to-cart time, which would otherwise save a
 * value that never matches the real Vendor a vendor's own dashboard
 * queries by, i.e. cross-side breakage, not just a display bug.
 *
 * Centralized here so every call site uses the exact same fallback
 * (Vendor._id first — the correct relation going forward once packages
 * are seeded correctly — then Vendor.id, which is what today's real data
 * actually needs) rather than duplicating this reasoning per controller.
 */

/**
 * @desc Resolves a raw Package.vendorId value (however it's actually
 * stored) to the real Vendor document, safe against a value that fails
 * ObjectId casting. Returns a lean, PUBLIC_VENDOR_FIELDS-shaped object (or
 * a custom `fields` projection) — or null if no vendor can be resolved.
 */
export async function resolveVendorForPackage(vendorIdRaw, fields = PUBLIC_VENDOR_FIELDS) {
  if (!vendorIdRaw) return null;
  // Already a populated Mongoose/plain object (e.g. a prior successful
  // populate) — nothing to resolve.
  if (typeof vendorIdRaw === "object" && !mongoose.Types.ObjectId.isValid(vendorIdRaw) && vendorIdRaw.businessName) {
    return vendorIdRaw;
  }
  if (mongoose.Types.ObjectId.isValid(vendorIdRaw)) {
    const byObjectId = await Vendor.findById(vendorIdRaw).select(fields).lean();
    if (byObjectId) return byObjectId;
  }
  return Vendor.findOne({ id: String(vendorIdRaw) }).select(fields).lean();
}

/**
 * @desc Resolves a raw Package.vendorId value to the real Vendor's Mongo
 * _id (an ObjectId), for use when WRITING a new document's own vendorId
 * field (CartItem, Booking, Enquiry, ...) — never copy Package.vendorId
 * forward verbatim, since today's real data needs this fallback to end up
 * with a value that actually matches what the vendor's own dashboard
 * queries by (Vendor._id). Returns null if no real vendor can be found —
 * callers must decide how to handle that (reject the write rather than
 * silently saving an unresolvable reference).
 */
export async function resolveVendorRefId(vendorIdRaw) {
  const vendor = await resolveVendorForPackage(vendorIdRaw, "_id");
  return vendor?._id || null;
}

export default { resolveVendorForPackage, resolveVendorRefId };
