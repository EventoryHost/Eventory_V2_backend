/**
 * Package group / variant consistency migration.
 *
 *   node migrate_package_groups.mjs                     # dry run (default) — writes nothing
 *   node migrate_package_groups.mjs --apply --confirm-db dev     # apply the safe fixes
 *   node migrate_package_groups.mjs --db prod --apply --confirm-db prod
 *
 * --apply always requires --confirm-db naming the database actually
 * connected to, whatever it is called — a mistyped MONGO_URI can't write to
 * the wrong database.
 *   node migrate_package_groups.mjs --report out.json   # also write the full report
 *   node migrate_package_groups.mjs --merge-file plan.json [--apply]
 *                                     # human-reviewed merges only (see below)
 *
 * DO NOT "fix" legacy ObjectId group ids by minting a fresh PKG_GRP id per
 * document: that is what split dev's packages on 2026-09-15 (groups
 * PKG_GRP20260915220526…–…220530…, each holding one former sibling). Fix 1
 * keeps the same value and only changes its BSON type.
 *
 * Connects with MONGO_URI from .env; --db overrides the database name.
 *
 * SAFE FIXES (applied only with --apply; idempotent — re-running is a no-op):
 *   1. packageGroupId stored as a legacy BSON ObjectId → the same 24-char hex
 *      as a String. The value is unchanged, only its type, so every existing
 *      reference (vendor app, notifications, analytics URLs) keeps resolving.
 *   2. packageGroupId missing/null/empty → the document's own _id as a
 *      String. Every reader already treats such a document as a group of one
 *      keyed by its _id ($ifNull: ["$packageGroupId", "$_id"]), so this makes
 *      the stored value match what the code already assumes.
 *   3. Booking.packageGroupId missing → copied from the booked variant's
 *      package (as normalised by 1–2). Bookings whose package no longer
 *      exists are left alone and listed for manual review.
 *
 * NEVER CHANGED — reported for manual review only:
 *   - groups whose variants have different vendors or vendor types;
 *   - groups with two live variants sharing a name;
 *   - same vendor + same package name spread over several groups (possible
 *     accidental splits — never merged on name/price alone);
 *   - groups whose variants carry different package names;
 *   - empty variantType;
 *   - bookings whose package is missing, or belongs to another vendor.
 *
 * No document is deleted and no _id is changed.
 */
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const APPLY = flag("--apply");
const DB_NAME = option("--db");
const REPORT_PATH = option("--report");
const SAMPLE = 50;

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI is not set");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI, DB_NAME ? { dbName: DB_NAME } : {});
const db = mongoose.connection.db;
const dbName = db.databaseName;

if (APPLY && option("--confirm-db") !== dbName) {
  console.error(`Refusing to write: connected to "${dbName}". Re-run with --confirm-db ${dbName} after reviewing a dry run.`);
  await mongoose.disconnect();
  process.exit(1);
}

const Packages = db.collection("packages");
const Bookings = db.collection("bookings");
const log = (...a) => console.log(...a);
log(`\n=== Package group migration — db "${dbName}" — ${APPLY ? "APPLY" : "DRY RUN (no writes)"} ===\n`);

const GROUP_KEY = { $toString: { $ifNull: ["$packageGroupId", "$_id"] } };

// ── Measurements (run before and after) ─────────────────────────────────────

async function measure() {
  const [typeRows, groups, bookingStats] = await Promise.all([
    Packages.aggregate([{ $group: { _id: { $type: "$packageGroupId" }, n: { $sum: 1 } } }]).toArray(),
    Packages.aggregate([
      {
        $group: {
          _id: GROUP_KEY,
          types: { $addToSet: { $type: "$packageGroupId" } },
          vendors: { $addToSet: "$vendorId" },
          vendorTypes: { $addToSet: "$vendorType" },
          names: { $addToSet: "$step1_eventAndCrew.packageName" },
          variants: { $push: { _id: "$_id", v: "$variantType", s: "$packageStatus" } },
          n: { $sum: 1 },
        },
      },
    ]).toArray(),
    Bookings.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          withGroup: { $sum: { $cond: [{ $gt: ["$packageGroupId", null] }, 1, 0] } },
          noSnapshot: { $sum: { $cond: [{ $gt: ["$packageSnapshot", null] }, 0, 1] } },
        },
      },
    ]).toArray(),
  ]);

  const byType = Object.fromEntries(typeRows.map((r) => [r._id, r.n]));
  const dupNameGroups = groups
    .map((g) => {
      const names = g.variants
        .filter((x) => x.s !== "Deleted")
        .map((x) => String(x.v ?? "").trim().toLowerCase());
      const dups = [...new Set(names.filter((x, i) => names.indexOf(x) !== i))];
      return dups.length ? { packageGroupId: g._id, duplicateNames: dups, variantIds: g.variants.map((x) => x._id) } : null;
    })
    .filter(Boolean);

  return {
    packages: Object.values(byType).reduce((a, b) => a + b, 0),
    groupIdString: byType.string ?? 0,
    groupIdObjectId: byType.objectId ?? 0,
    groupIdMissing: (byType.missing ?? 0) + (byType.null ?? 0),
    groupIdEmptyString: await Packages.countDocuments({ packageGroupId: "" }),
    logicalPackages: groups.length,
    mixedTypeGroups: groups.filter((g) => g.types.length > 1).length,
    crossVendorGroups: groups.filter((g) => g.vendors.length > 1),
    crossVendorTypeGroups: groups.filter((g) => g.vendorTypes.length > 1),
    multiNameGroups: groups.filter((g) => g.names.length > 1),
    duplicateNameGroups: dupNameGroups,
    emptyVariantType: await Packages.countDocuments({
      $or: [{ variantType: { $exists: false } }, { variantType: null }, { variantType: { $regex: /^\s*$/ } }],
    }),
    bookings: bookingStats[0]?.total ?? 0,
    bookingsWithGroupId: bookingStats[0]?.withGroup ?? 0,
    bookingsWithoutSnapshot: bookingStats[0]?.noSnapshot ?? 0,
  };
}

const summarize = (m) => ({
  packages: m.packages,
  logicalPackages: m.logicalPackages,
  "packageGroupId: String": m.groupIdString,
  "packageGroupId: ObjectId (legacy)": m.groupIdObjectId,
  "packageGroupId: missing/null": m.groupIdMissing,
  "packageGroupId: empty string": m.groupIdEmptyString,
  mixedTypeGroups: m.mixedTypeGroups,
  crossVendorGroups: m.crossVendorGroups.length,
  crossVendorTypeGroups: m.crossVendorTypeGroups.length,
  groupsWithDuplicateVariantNames: m.duplicateNameGroups.length,
  groupsWithSeveralPackageNames: m.multiNameGroups.length,
  emptyVariantType: m.emptyVariantType,
  bookings: m.bookings,
  bookingsWithPackageGroupId: m.bookingsWithGroupId,
  bookingsWithoutSnapshot: m.bookingsWithoutSnapshot,
});

const before = await measure();
log("BEFORE");
console.table(summarize(before));

// ── Fix 1: legacy ObjectId packageGroupId → String (same hex) ───────────────

const legacy = await Packages.find({ packageGroupId: { $type: "objectId" } }, { projection: { packageGroupId: 1 } }).toArray();
log(`\n[1] ObjectId packageGroupId → String: ${legacy.length} document(s)`);
let fixed1 = 0;
if (APPLY && legacy.length) {
  const res = await Packages.bulkWrite(
    legacy.map((d) => ({
      updateOne: {
        // Re-checks the type, so a concurrent fix or a re-run is a no-op.
        filter: { _id: d._id, packageGroupId: { $type: "objectId" } },
        update: { $set: { packageGroupId: d.packageGroupId.toHexString() } },
      },
    })),
    { ordered: false }
  );
  fixed1 = res.modifiedCount;
}

// ── Fix 2: missing packageGroupId → the document's own _id ──────────────────

const ungrouped = await Packages.find(
  { $or: [{ packageGroupId: { $exists: false } }, { packageGroupId: null }, { packageGroupId: "" }] },
  { projection: { _id: 1 } }
).toArray();
log(`[2] Missing packageGroupId → own _id: ${ungrouped.length} document(s)`);
let fixed2 = 0;
if (APPLY && ungrouped.length) {
  const res = await Packages.bulkWrite(
    ungrouped.map((d) => ({
      updateOne: {
        filter: { _id: d._id, $or: [{ packageGroupId: { $exists: false } }, { packageGroupId: null }, { packageGroupId: "" }] },
        update: { $set: { packageGroupId: d._id.toHexString() } },
      },
    })),
    { ordered: false }
  );
  fixed2 = res.modifiedCount;
}

// ── Fix 3: Booking.packageGroupId backfill + booking reference review ───────

const bookingRows = await Bookings.aggregate([
  { $project: { bookingId: 1, vendorId: 1, packageId: 1, packageGroupId: 1, hasSnapshot: { $gt: ["$packageSnapshot", null] } } },
  { $addFields: { pid: { $convert: { input: "$packageId", to: "objectId", onError: null, onNull: null } } } },
  {
    $lookup: {
      from: "packages",
      localField: "pid",
      foreignField: "_id",
      as: "pkg",
      pipeline: [{ $project: { packageGroupId: 1, vendorId: 1, packageStatus: 1 } }],
    },
  },
  { $addFields: { pkg: { $arrayElemAt: ["$pkg", 0] } } },
]).toArray();

// Vendor refs may be the public "VEN…" id or a legacy Mongo _id — map both
// to the public id before comparing, so a format difference isn't flagged.
const vendorDocs = await db.collection("vendors").find({}, { projection: { id: 1 } }).toArray();
const vendorKey = new Map();
for (const v of vendorDocs) {
  if (v.id) vendorKey.set(String(v.id), String(v.id));
  vendorKey.set(String(v._id), String(v.id || v._id));
}
const canonVendor = (ref) => (ref == null ? null : vendorKey.get(String(ref)) ?? String(ref));

const bookingsMissingPackage = [];
const bookingsVendorMismatch = [];
const backfill = [];
for (const b of bookingRows) {
  if (!b.pkg) {
    bookingsMissingPackage.push({ bookingId: b.bookingId, packageId: b.packageId, hasSnapshot: b.hasSnapshot });
    continue;
  }
  if (canonVendor(b.pkg.vendorId) !== canonVendor(b.vendorId)) {
    bookingsVendorMismatch.push({ bookingId: b.bookingId, bookingVendor: b.vendorId, packageVendor: b.pkg.vendorId });
  }
  if (b.packageGroupId == null) {
    const groupId = b.pkg.packageGroupId == null || b.pkg.packageGroupId === ""
      ? String(b.pkg._id)
      : String(b.pkg.packageGroupId); // ObjectId → hex, String unchanged
    backfill.push({ _id: b._id, groupId });
  }
}
log(`[3] Booking.packageGroupId backfill: ${backfill.length} booking(s)`);
let fixed3 = 0;
if (APPLY && backfill.length) {
  const res = await Bookings.bulkWrite(
    backfill.map((b) => ({
      updateOne: {
        filter: { _id: b._id, packageGroupId: { $in: [null] } },
        update: { $set: { packageGroupId: b.groupId } },
      },
    })),
    { ordered: false }
  );
  fixed3 = res.modifiedCount;
}

// ── Report-only findings ────────────────────────────────────────────────────

const splitCandidates = await Packages.aggregate([
  { $match: { packageStatus: { $ne: "Deleted" } } },
  {
    $group: {
      _id: {
        vendorId: "$vendorId",
        name: { $toLower: { $trim: { input: { $ifNull: ["$step1_eventAndCrew.packageName", ""] } } } },
      },
      groups: { $addToSet: GROUP_KEY },
      variantTypes: { $addToSet: "$variantType" },
    },
  },
  { $match: { "groups.1": { $exists: true } } },
]).toArray();

// ── Optional: human-reviewed merges (--merge-file plan.json) ────────────────
//
// Never inferred. An admin reviews `possibleAccidentalSplits` and writes the
// merges they have confirmed (e.g. with the vendor):
//   [{ "packageGroupId": "<group to keep>", "packageIds": ["<variant _id>", …] }]
// Each listed variant moves into packageGroupId; its _id never changes, so
// carts, checkouts and bookings still point at the same variant. Bookings of
// the moved variants get the new packageGroupId (same logical package now);
// their packageSnapshot is untouched.
// An entry is refused unless: every document exists; all of them, and the
// target group's current members, have one vendor and one vendor type; the
// merged package has no two live variants with the same name; and every
// source group is moved WHOLE (a merge must not leave half a package behind).

const MERGE_FILE = option("--merge-file");
const mergeResults = [];
if (MERGE_FILE) {
  const plan = JSON.parse(fs.readFileSync(MERGE_FILE, "utf8"));
  log(`\n[merge] ${plan.length} reviewed merge(s) from ${MERGE_FILE}`);
  for (const entry of plan) {
    const target = String(entry.packageGroupId ?? "").trim();
    const rawIds = (entry.packageIds || []).map(String);
    const result = { packageGroupId: target, packageIds: entry.packageIds, ok: false, reason: null, moved: 0, bookings: 0 };
    mergeResults.push(result);
    const fail = (reason) => {
      result.reason = reason;
      log(`  ✗ ${target || "(no packageGroupId)"}: ${reason}`);
    };
    if (!target) { fail("packageGroupId is required"); continue; }
    const badIds = rawIds.filter((id) => !/^[0-9a-f]{24}$/i.test(id));
    if (badIds.length) { fail(`not valid package ids: ${badIds.join(", ")}`); continue; }
    if (new Set(rawIds).size !== rawIds.length) { fail("packageIds lists the same id twice"); continue; }
    const ids = rawIds.map((id) => new mongoose.Types.ObjectId(id));

    // Match group ids in both BSON forms, so a dry run (before fix 1 has
    // retyped legacy ObjectId ids) validates exactly what --apply would.
    const bothForms = (g) => (/^[0-9a-f]{24}$/i.test(g) ? [g, new mongoose.Types.ObjectId(g)] : [g]);
    const moving = await Packages.find({ _id: { $in: ids } }).toArray();
    const members = await Packages.find({ packageGroupId: { $in: bothForms(target) } }).toArray();
    const sourceGroups = [...new Set(moving.map((d) => String(d.packageGroupId ?? d._id)))].filter((g) => g !== target);
    const sourceMembers = sourceGroups.length
      ? await Packages.find({ packageGroupId: { $in: sourceGroups.flatMap(bothForms) } }, { projection: { _id: 1 } }).toArray()
      : [];
    const all = [...members, ...moving.filter((d) => String(d.packageGroupId) !== target)];

    if (moving.length !== ids.length) { fail("some packageIds do not exist"); continue; }
    if (!members.length) { fail("target packageGroupId has no documents"); continue; }
    if (new Set(all.map((d) => canonVendor(d.vendorId))).size !== 1) { fail("documents belong to different vendors"); continue; }
    if (new Set(all.map((d) => d.vendorType)).size !== 1) { fail("documents have different vendor types"); continue; }
    const liveNames = all
      .filter((d) => d.packageStatus !== "Deleted")
      .map((d) => String(d.variantType ?? "").trim().toLowerCase());
    const dup = liveNames.find((n, i) => liveNames.indexOf(n) !== i);
    if (dup !== undefined) { fail(`two live variants would both be named "${dup}" — rename one first`); continue; }
    const movingIds = new Set(moving.map((d) => String(d._id)));
    const leftBehind = sourceMembers.filter((d) => !movingIds.has(String(d._id)));
    if (leftBehind.length) { fail(`would split a source group — also list ${leftBehind.map((d) => d._id).join(", ")}`); continue; }

    result.ok = true;
    const toMove = moving.filter((d) => String(d.packageGroupId) !== target);
    log(`  ✓ ${target}: move ${toMove.length} variant(s) into it${APPLY ? "" : " (dry run)"}`);
    if (APPLY && toMove.length) {
      const moveIds = toMove.map((d) => d._id);
      result.moved = (await Packages.updateMany({ _id: { $in: moveIds } }, { $set: { packageGroupId: target } })).modifiedCount;
      result.bookings = (
        await Bookings.updateMany({ packageId: { $in: moveIds.map(String) } }, { $set: { packageGroupId: target } })
      ).modifiedCount;
    }
  }
}

const after = APPLY ? await measure() : before;

const manualReview = {
  crossVendorGroups: before.crossVendorGroups.map((g) => ({ packageGroupId: g._id, vendors: g.vendors, variantIds: g.variants.map((v) => v._id) })),
  crossVendorTypeGroups: before.crossVendorTypeGroups.map((g) => ({ packageGroupId: g._id, vendorTypes: g.vendorTypes })),
  duplicateVariantNames: before.duplicateNameGroups,
  severalPackageNamesInOneGroup: before.multiNameGroups.map((g) => ({ packageGroupId: g._id, names: g.names })),
  possibleAccidentalSplits: splitCandidates.map((s) => ({
    vendorId: s._id.vendorId,
    packageName: s._id.name,
    packageGroupIds: s.groups,
    variantTypes: s.variantTypes,
  })),
  bookingsWhosePackageIsMissing: bookingsMissingPackage,
  bookingsWhosePackageHasAnotherVendor: bookingsVendorMismatch,
};

log("\nMANUAL REVIEW (nothing below is changed by this script)");
console.table(Object.fromEntries(Object.entries(manualReview).map(([k, v]) => [k, v.length])));
for (const [k, v] of Object.entries(manualReview)) {
  if (!v.length) continue;
  log(`\n-- ${k} (showing ${Math.min(v.length, SAMPLE)} of ${v.length})`);
  for (const row of v.slice(0, SAMPLE)) log("  ", JSON.stringify(row));
}

if (APPLY) {
  log(`\nAPPLIED: ${fixed1} group id(s) retyped, ${fixed2} group id(s) assigned, ${fixed3} booking(s) backfilled`);
  log("AFTER");
  console.table(summarize(after));
} else {
  log("\nDry run — nothing was written. Re-run with --apply to make the safe fixes above.");
}

if (REPORT_PATH) {
  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        db: dbName,
        mode: APPLY ? "apply" : "dry-run",
        at: new Date().toISOString(),
        before: summarize(before),
        after: summarize(after),
        planned: { retypeGroupIds: legacy.length, assignGroupIds: ungrouped.length, backfillBookings: backfill.length },
        applied: APPLY ? { retypeGroupIds: fixed1, assignGroupIds: fixed2, backfillBookings: fixed3 } : null,
        reviewedMerges: mergeResults,
        manualReview,
      },
      null,
      2
    )
  );
  log(`\nReport written to ${REPORT_PATH}`);
}

await mongoose.disconnect();
