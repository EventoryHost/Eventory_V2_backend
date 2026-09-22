import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";
import { resolveVendorRefId } from "./resolveVendor.js";

/**
 * Maintenance for Vendor.wishlistCount — the "N+ Wishlisted" stat on the
 * customer-side vendor card. See Vendor.js for why the count is
 * denormalized onto the vendor rather than aggregated per request.
 *
 * Resolving a wishlist row to "the vendor whose counter moves" is the whole
 * reason this lives in its own module rather than inline in the
 * controller — neither item type gives it to you directly:
 *
 *   itemType "Vendor"  — addWishlistItem accepts EITHER the Vendor's Mongo
 *                        _id or its business-facing `id` string
 *                        ("VEN2026...") and stores back whatever the client
 *                        sent, so the stored value can be either form.
 *   itemType "Package" — the owning vendor has to be read off the Package,
 *                        whose own vendorId is subject to the seed-data
 *                        mismatch documented at length in resolveVendor.js
 *                        (it frequently holds Vendor.id, not Vendor._id).
 *
 * Both cases funnel through resolveVendorRefId, the one helper that already
 * encodes that fallback, so this never grows a second, subtly-different
 * copy of the same rule.
 */

/**
 * @desc Resolve one wishlist item to the Mongo _id of the Vendor whose
 * wishlistCount it contributes to. Returns null when no vendor can be
 * resolved (deleted package, unresolvable reference) — callers treat that
 * as "nothing to increment" rather than failing the request, since the
 * wishlist write itself already succeeded and the recompute script repairs
 * any counter that drifts as a result.
 */
export async function vendorRefForWishlistItem(item) {
  if (!item) return null;

  if (item.itemType === "Vendor") {
    return resolveVendorRefId(item.vendorId);
  }

  if (!item.packageId) return null;
  const pkg = await Package.findById(item.packageId).select("vendorId").lean();
  if (!pkg) return null;
  return resolveVendorRefId(pkg.vendorId);
}

/**
 * @desc Apply a delta to one vendor's wishlistCount. Never throws: a
 * counter update must not turn an otherwise-successful wishlist
 * add/remove into a 500 for the customer, so failures are swallowed here
 * and left for recomputeVendorWishlistCounts.mjs to reconcile.
 *
 * $inc is not atomic with the WishlistItem write above it (these are two
 * separate operations, and this codebase has no transaction/replica-set
 * guarantee to lean on), which is exactly why the recompute script exists
 * and is documented as re-runnable rather than one-shot.
 */
export async function bumpVendorWishlistCount(vendorRefId, delta) {
  if (!vendorRefId || !delta) return;
  try {
    await Vendor.updateOne({ _id: vendorRefId }, { $inc: { wishlistCount: delta } });
  } catch {
    // Intentionally ignored — see the note above.
  }
}

/**
 * @desc Apply deltas for many wishlist items at once (clearWishlist).
 * Groups by vendor first so a customer who had five packages from the same
 * vendor saved produces one -5 write, not five -1 writes.
 */
export async function bumpVendorWishlistCounts(items, sign = -1) {
  if (!items?.length) return;

  const deltaByVendor = new Map();
  await Promise.all(
    items.map(async (item) => {
      const vendorRefId = await vendorRefForWishlistItem(item);
      if (!vendorRefId) return;
      const key = String(vendorRefId);
      deltaByVendor.set(key, (deltaByVendor.get(key) || 0) + sign);
    })
  );

  if (!deltaByVendor.size) return;

  try {
    await Vendor.bulkWrite(
      [...deltaByVendor].map(([vendorRefId, delta]) => ({
        updateOne: { filter: { _id: vendorRefId }, update: { $inc: { wishlistCount: delta } } },
      })),
      { ordered: false }
    );
  } catch {
    // Intentionally ignored — see bumpVendorWishlistCount.
  }
}

export default { vendorRefForWishlistItem, bumpVendorWishlistCount, bumpVendorWishlistCounts };
