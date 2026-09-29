/**
 * Drops the old unique { bookingId: 1 } index from customer_reviews.
 *
 * WHY THIS EXISTS
 *   Review.js used to allow one review per booking via a unique
 *   { bookingId: 1 } index. It now allows one review per package per
 *   customer ({ customerId: 1, packageId: 1 }, unique, partial on a string
 *   packageId) plus a plain { bookingId: 1 } lookup index. Mongoose's
 *   autoIndex creates the new indexes at startup but never drops the old
 *   one, so the unique bookingId_1 index would otherwise stay in the live
 *   collection. It also has the same name as the new, non-unique index,
 *   which stops Mongoose from building that one until the old one is gone.
 *
 *   Before dropping anything, this reports any customer who already has
 *   more than one review of the same package — the new unique index can't
 *   be built while those exist, and they need a decision, not a silent
 *   delete.
 *
 * Run:  node --env-file=.env drop_review_booking_unique_index.mjs
 * Dry:  node --env-file=.env drop_review_booking_unique_index.mjs --dry-run
 *
 * IT IS SAFE TO RE-RUN. A second run finds no unique bookingId_1 index and
 * does nothing.
 */
import mongoose from "mongoose";

const DRY_RUN = process.argv.includes("--dry-run");
const COLLECTION = "customer_reviews";

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGO_URI (or MONGODB_URI) is not set");
  await mongoose.connect(uri);
  const collection = mongoose.connection.db.collection(COLLECTION);

  const duplicates = await collection
    .aggregate([
      { $match: { packageId: { $type: "string" } } },
      { $group: { _id: { customerId: "$customerId", packageId: "$packageId" }, count: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  if (duplicates.length) {
    console.warn(`${duplicates.length} customer/package pair(s) have more than one review:`);
    for (const d of duplicates) console.warn(`  customer ${d._id.customerId}, package ${d._id.packageId}: ${d.ids.join(", ")}`);
    console.warn("The new unique index can't be built until these are resolved.");
  }

  const indexes = await collection.indexes().catch((err) => {
    if (err.codeName === "NamespaceNotFound") return [];
    throw err;
  });
  const old = indexes.find((index) => index.name === "bookingId_1" && index.unique);
  if (!old) {
    console.log("No unique bookingId_1 index — nothing to drop.");
  } else if (DRY_RUN) {
    console.log("[dry run] Would drop the unique bookingId_1 index.");
  } else {
    await collection.dropIndex("bookingId_1");
    console.log("Dropped the unique bookingId_1 index. Restart the API so Mongoose builds the new indexes.");
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
