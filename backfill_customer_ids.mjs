/**
 * One-time utility: backfills Booking.customerId / Enquiry.customerId on
 * records that predate the Customer model, by matching their embedded
 * customer.phone against a registered Customer account's phone number.
 *
 * NOT wired into any route or app startup — this only ever runs when someone
 * explicitly executes it from the command line. Not run automatically by
 * this codebase, and not something Claude should execute on its own without
 * being asked — matching a vendor-entered phone number to a customer
 * account is a best-guess operation, not a certainty, and this writes to
 * real Booking/Enquiry documents.
 *
 * Safe by default: runs as a DRY RUN (reports what it WOULD change) unless
 * you pass --apply. Always run without --apply first and read the report.
 *
 *   node backfill_customer_ids.mjs            # dry run, no writes
 * 	node backfill_customer_ids.mjs --apply     # actually writes customerId
 *
 * As of 2026-08-05 this repo's dev database has 0 Booking/Enquiry documents,
 * so there is nothing to backfill yet — this script exists for whenever
 * that changes (e.g. once the vendor booking flow has been used for real,
 * or once Phase 4 checkout starts creating bookings). The new Booking/
 * Enquiry.pre("save") auto-link hooks (see src/models/Booking.js,
 * src/models/Enquiry.js) already cover new documents going forward — this
 * script is only for records that existed before customerId was added and
 * were never re-saved since.
 */
import "dotenv/config";
import mongoose from "mongoose";
import Booking from "./src/models/Booking.js";
import Enquiry from "./src/models/Enquiry.js";
import Customer from "./src/models/Customer.js";
import { normalizePhone } from "./src/utils/phone.js";

const APPLY = process.argv.includes("--apply");

async function backfill(Model, label) {
  const unlinked = await Model.find({
    customerId: null,
    "customer.phone": { $exists: true, $ne: null },
  }).select("_id customer.phone customerId");

  console.log(`\n${label}: ${unlinked.length} record(s) with no customerId and a phone number to try matching.`);

  let matched = 0;
  let ambiguousOrMissing = 0;

  for (const doc of unlinked) {
    const normalized = normalizePhone(doc.customer?.phone);
    if (!normalized) {
      ambiguousOrMissing++;
      console.log(`  [skip] ${doc._id} — phone "${doc.customer?.phone}" doesn't normalize to a real number`);
      continue;
    }

    const match = await Customer.findOne({ phone: normalized }).select("_id id name");
    if (!match) {
      ambiguousOrMissing++;
      console.log(`  [no match] ${doc._id} — no Customer account with phone ${normalized}`);
      continue;
    }

    matched++;
    console.log(`  [match] ${doc._id} -> Customer ${match.id} (${match.name || "unnamed"})${APPLY ? " — WRITING" : " — would write (dry run)"}`);

    if (APPLY) {
      doc.customerId = match._id;
      await doc.save({ validateBeforeSave: false }); // skip full re-validation of unrelated legacy fields
    }
  }

  console.log(`${label} summary: ${matched} matched${APPLY ? " and written" : " (dry run, nothing written)"}, ${ambiguousOrMissing} left unmatched.`);
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected. Mode: ${APPLY ? "APPLY (will write changes)" : "DRY RUN (no writes — pass --apply to write)"}`);

  await backfill(Booking, "Bookings");
  await backfill(Enquiry, "Enquiries");

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
