/**
 * Vendor step verification: backfill `verification` on existing vendors.
 *
 * WHY THIS EXISTS
 *   Vendor review used to be eight `adminReview` sections plus the
 *   isVerified flag. It is now one `verification` object: a verdict per
 *   profile step (src/constants/vendorSteps.js), a decision per review group,
 *   a status derived from those, and a stored completionPercent the admin
 *   review queue filters on. The code reads an
 *   un-migrated vendor correctly (utils/vendorVerificationLegacy.js), but the
 *   queue's status and completion filters only match stored values — so run
 *   this once after deploying.
 *
 * WHAT IT WRITES, per vendor without verification.status
 *   verification.status / groups
 *       isVerified  -> Verified, both groups (businessProfile,
 *                      personalDocuments) Approved, wasVerified
 *       otherwise   -> Pending, both groups Pending
 *       isDeactivated is not a review outcome: it is neither read nor touched.
 *   verification.steps       each adminReview section fans out to its steps
 *                            (status copied, notes -> note); the rest Pending
 *   verification.completionPercent   computeCompletion(vendor).percent
 *   isGstSkipped             false, when absent
 *   verificationHistory      [], when absent
 *
 *   And, for vendors that already have a status, completionPercent when it is
 *   missing (e.g. a vendor migrated lazily by a save before this ran) or
 *   stale — stored but no longer what computeCompletion gives (the schema
 *   default is 0, so a vendor written without the pre-save hook keeps 0).
 *   Customers only see vendors whose STORED percentage is >= 50
 *   (utils/customerVisibility.js), so a stale value hides a vendor.
 *
 * IT IS SAFE TO RE-RUN. Each write is guarded by the same "still missing"
 * condition it was planned from, so a second run finds nothing to do.
 * adminReview is left in place (deprecated, read-only).
 *
 * Run:  node --env-file=.env migrate_vendor_verification.mjs
 * Dry:  node --env-file=.env migrate_vendor_verification.mjs --dry-run
 */

import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import {
  hasVerificationStatus,
  legacyVerification,
} from "./src/utils/vendorVerificationLegacy.js";
import { computeCompletion } from "./src/utils/profileCompletion.js";

/** The update for one raw vendor document, or null when there is nothing to do. */
export function planVendor(doc) {
  const $set = {};
  const filter = { _id: doc._id };

  if (!hasVerificationStatus(doc)) {
    const verification = {
      ...legacyVerification(doc),
      finalNote: null,
      decidedBy: null,
    };
    verification.completionPercent = computeCompletion({ ...doc, verification }).percent;
    $set.verification = verification;
    filter["verification.status"] = null;
  } else {
    const stored = doc.verification.completionPercent;
    const percent = computeCompletion(doc).percent;
    if (typeof stored !== "number") {
      $set["verification.completionPercent"] = percent;
      filter["verification.completionPercent"] = { $exists: false };
    } else if (stored !== percent) {
      $set["verification.completionPercent"] = percent;
      // Only if nothing re-saved the vendor since it was read.
      filter["verification.completionPercent"] = stored;
    }
  }

  if (doc.isGstSkipped === undefined) $set.isGstSkipped = false;
  if (doc.verificationHistory === undefined) $set.verificationHistory = [];

  if (!Object.keys($set).length) return null;
  return { filter, update: { $set } };
}

const describe = (doc, op) => {
  const v = op.update.$set.verification;
  if (v) {
    const flagged = Object.entries(v.steps).filter(([, s]) => s.status === "Rejected").map(([k]) => k);
    const approved = Object.values(v.steps).filter((s) => s.status === "Approved").length;
    return `${doc.id} ${JSON.stringify(doc.businessName || "")}: ${v.status}, ${v.completionPercent}% complete, ${approved} step(s) Approved${flagged.length ? `, flagged: ${flagged.join(", ")}` : ""}`;
  }
  const pct = op.update.$set["verification.completionPercent"];
  const was = doc.verification?.completionPercent;
  if (pct === undefined) return `${doc.id}: defaults only`;
  return `${doc.id}: completionPercent ${typeof was === "number" ? `${was} → ` : "= "}${pct}`;
};

async function main() {
  const DRY_RUN = process.argv.includes("--dry-run");

  if (!process.env.MONGO_URI) {
    console.error(
      "❌ MONGO_URI is not set — run with: node --env-file=.env migrate_vendor_verification.mjs"
    );
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`✅ Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  if (DRY_RUN) console.log("🔍 DRY RUN — no writes will be made.\n");

  // The raw collection: no casting, no defaults, no hooks.
  const collection = mongoose.connection.db.collection("vendors");
  // Every vendor: a stale completionPercent can only be found by recomputing it.
  const cursor = collection.find({});

  const counts = { Pending: 0, Verified: 0 };
  let writes = [];
  let total = 0;
  let hiddenForCompletion = 0;

  const flush = async () => {
    if (!writes.length) return;
    if (!DRY_RUN) {
      const result = await collection.bulkWrite(writes, { ordered: false });
      console.log(`   … wrote ${result.modifiedCount} document(s)`);
    }
    writes = [];
  };

  for await (const doc of cursor) {
    const op = planVendor(doc);
    const finalPercent =
      op?.update.$set.verification?.completionPercent ??
      op?.update.$set["verification.completionPercent"] ??
      doc.verification?.completionPercent;
    if (!(typeof finalPercent === "number" && finalPercent >= 50)) hiddenForCompletion += 1;
    if (!op) continue;
    total += 1;
    const status = op.update.$set.verification?.status;
    if (status) counts[status] += 1;
    console.log(`  ${describe(doc, op)}`);
    writes.push({ updateOne: op });
    if (writes.length >= 500) await flush();
  }
  await flush();

  console.log(
    `\nStatuses assigned: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(" · ")}`
  );
  console.log(`Vendors under 50% complete (hidden from customers): ${hiddenForCompletion}`);
  if (!total) console.log("✅ Every vendor already has a verification — nothing to do.");
  else if (DRY_RUN) console.log(`🔍 DRY RUN — would have updated ${total} vendor(s).`);
  else console.log(`✅ Updated ${total} vendor(s).`);

  await mongoose.disconnect();
}

// Run only when executed directly, so planVendor can be imported and checked
// without a database.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    console.error(`❌ ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
