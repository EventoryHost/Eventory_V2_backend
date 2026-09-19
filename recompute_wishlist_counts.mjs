/**
 * Vendor.wishlistCount backfill + reconciliation.
 *
 * WHY THIS EXISTS
 *   wishlistCount is a denormalized counter maintained by $inc in
 *   customerWishlistController.js (see src/utils/wishlistCount.js). Those
 *   $inc calls are not atomic with the WishlistItem write they accompany,
 *   and this codebase has no transaction guarantee to lean on, so the
 *   counter drifts: a crash between the two operations, a direct edit in
 *   the database, a package deleted out from under a saved row.
 *
 *   It is also REQUIRED ONCE as a backfill — every wishlist row saved
 *   before the counter existed is invisible to $inc, so without this pass
 *   every vendor card reads 0 Wishlisted no matter how many real saves
 *   exist.
 *
 * IT IS SAFE TO RE-RUN. The count is recomputed from the wishlist rows
 * themselves, never derived from the current value, so running it twice
 * is identical to running it once. Schedule it as often as you like.
 *
 * Counts are resolved through vendorRefForWishlistItem — the SAME helper
 * the live controller uses — rather than a hand-written $lookup pipeline,
 * so the backfill and the incremental path can never disagree about which
 * vendor a saved package belongs to. That matters more than it sounds:
 * Package.vendorId frequently holds Vendor.id rather than Vendor._id (see
 * src/utils/resolveVendor.js), which a naive $lookup silently misses.
 *
 * Run:  node --env-file=.env recompute_wishlist_counts.mjs
 * Dry:  node --env-file=.env recompute_wishlist_counts.mjs --dry-run
 */

import mongoose from "mongoose";
import WishlistItem from "./src/models/WishlistItem.js";
import Vendor from "./src/models/Vendor.js";
import Package from "./src/models/Package.js";
import { resolveVendorRefId } from "./src/utils/resolveVendor.js";

const DRY_RUN = process.argv.includes("--dry-run");

// Package -> owning Vendor._id, memoized: many customers wishlist the same
// popular package, and each lookup is a round trip.
const packageVendorCache = new Map();

async function vendorRefForItem(item) {
  if (item.itemType === "Vendor") return resolveVendorRefId(item.vendorId);
  if (!item.packageId) return null;

  const key = String(item.packageId);
  if (packageVendorCache.has(key)) return packageVendorCache.get(key);

  const pkg = await Package.findById(item.packageId).select("vendorId").lean();
  const ref = pkg ? await resolveVendorRefId(pkg.vendorId) : null;
  packageVendorCache.set(key, ref);
  return ref;
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("❌ MONGO_URI is not set — run with: node --env-file=.env recompute_wishlist_counts.mjs");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`✅ Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  if (DRY_RUN) console.log("🔍 DRY RUN — no writes will be made.\n");

  const items = await WishlistItem.find().select("itemType packageId vendorId").lean();
  console.log(`Wishlist rows: ${items.length}`);

  const trueCounts = new Map();
  let unresolved = 0;
  for (const item of items) {
    const ref = await vendorRefForItem(item);
    if (!ref) {
      unresolved++;
      continue;
    }
    const key = String(ref);
    trueCounts.set(key, (trueCounts.get(key) || 0) + 1);
  }
  if (unresolved) {
    console.log(`⚠️  ${unresolved} row(s) reference a package/vendor that no longer resolves — not counted.`);
  }

  // Every vendor is compared, not just the ones with saves: a vendor whose
  // counter drifted ABOVE its real value (or whose saves were all removed)
  // has to come back down to 0, which a counted-vendors-only pass misses.
  const vendors = await Vendor.find().select("_id id businessName pocName wishlistCount").lean();

  const writes = [];
  for (const vendor of vendors) {
    const expected = trueCounts.get(String(vendor._id)) || 0;
    const current = vendor.wishlistCount || 0;
    // A vendor that predates the field has NO wishlistCount key at all —
    // Mongoose's `default: 0` only applies to documents it creates, so
    // those read back as undefined rather than 0 and reach the frontend
    // as a missing value. Written explicitly here even when the expected
    // count is 0, so every vendor document carries a real number.
    const isMissing = vendor.wishlistCount === undefined || vendor.wishlistCount === null;
    if (expected === current && !isMissing) continue;
    writes.push({ vendor, current, expected, isMissing });
  }

  console.log(`Vendors: ${vendors.length} · with saves: ${trueCounts.size} · needing correction: ${writes.length}\n`);

  for (const { vendor, current, expected, isMissing } of writes.slice(0, 25)) {
    const name = vendor.pocName || vendor.businessName || vendor.id;
    console.log(`  ${isMissing ? "(unset)" : current} → ${expected}   ${name}`);
  }
  if (writes.length > 25) console.log(`  … and ${writes.length - 25} more`);

  if (!writes.length) {
    console.log("\n✅ Every counter already matches — nothing to do.");
  } else if (DRY_RUN) {
    console.log(`\n🔍 DRY RUN — would have corrected ${writes.length} vendor(s).`);
  } else {
    const result = await Vendor.bulkWrite(
      writes.map(({ vendor, expected }) => ({
        updateOne: { filter: { _id: vendor._id }, update: { $set: { wishlistCount: expected } } },
      })),
      { ordered: false }
    );
    console.log(`\n✅ Corrected ${result.modifiedCount} vendor(s).`);
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(`❌ ${error.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
