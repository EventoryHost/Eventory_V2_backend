/**
 * Venue in-house service durations: minutes -> decimal hours.
 *
 * WHY THIS EXISTS
 *   Every package duration is stored as raw decimal hours (1 hr 30 min =
 *   1.5). The in-house service bodies a venue carries were the exception:
 *   they stored minutes, under keys that said so —
 *
 *     setupDurationMinutes      (caterer, decorator)
 *     durationPerPersonMinutes  (makeup artist)
 *     minDurationMinutes        (DJ artist)
 *     maxDurationMinutes        (DJ artist)
 *
 *   The schemas now use setupDurationHours / durationPerPersonHours /
 *   minDurationHours / maxDurationHours instead. Mongoose's strict mode
 *   hides any key the schema no longer declares, so without this pass every
 *   duration saved before the rename silently reads back as unset.
 *
 *   Because the old keys are named Minutes, the conversion is unambiguous:
 *   new = old / 60, rounded to 2 decimals (90 -> 1.5, 45 -> 0.75).
 *
 * WHERE THE OLD KEYS CAN LIVE
 *   The step-2 schemas are shared between the standalone packages and the
 *   venue's in-house services, and packages are copied into snapshots, so
 *   every step-2-shaped body is checked, directly and under
 *   inHouseServices.<service>[].data:
 *
 *     packages   step2_productsAndPricing
 *     templates  data.packages[].step2_productsAndPricing  (Mixed snapshot)
 *     bookings   packageSnapshot.deliverables              (Mixed snapshot)
 *     enquiries  packageSnapshot.deliverables              (Mixed snapshot)
 *
 *   Writes go through the raw collections, so Mongoose casting, strict mode
 *   and the `immutable` flag on packageSnapshot don't get in the way. The
 *   snapshots are rewritten too: the value is the same duration, only its
 *   unit changes, and the clients read the new keys.
 *
 * IT IS SAFE TO RE-RUN. Only documents that still hold an old key are
 * touched, and the old key is $unset in the same write, so a second run
 * finds nothing to do. If a document already carries the new key alongside
 * the old one, the new value is kept and only the old key is removed. A
 * non-numeric old value is reported and left alone for manual review.
 *
 * Run:  node --env-file=.env migrate_inhouse_durations_to_hours.mjs
 * Dry:  node --env-file=.env migrate_inhouse_durations_to_hours.mjs --dry-run
 */

import mongoose from "mongoose";
import { pathToFileURL } from "node:url";

export const FIELD_RENAMES = {
  setupDurationMinutes: "setupDurationHours",
  durationPerPersonMinutes: "durationPerPersonHours",
  minDurationMinutes: "minDurationHours",
  maxDurationMinutes: "maxDurationHours",
};

/** Keys under step2_productsAndPricing.inHouseServices (VenueProviderPackage). */
export const IN_HOUSE_SERVICE_KEYS = ["caterer", "decorator", "pav", "djArtist", "makeupArtist"];

export const minutesToHours = (minutes) => Math.round((minutes / 60) * 100) / 100;

const isObject = (v) => v !== null && typeof v === "object";
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * One object that may hold the old keys directly (a step-2 body, or an
 * in-house service's `data`). Appends a change per old key found.
 *
 * kind: "convert"   set new = old/60, unset old
 *       "drop-old"  new key already set — keep it, unset old
 *       "drop-empty" old key is null/empty — unset old, set nothing
 *       "skip"      old value isn't a number — left untouched
 */
function planHolder(holder, prefix, changes) {
  if (!isObject(holder)) return;
  for (const [oldKey, newKey] of Object.entries(FIELD_RENAMES)) {
    if (!has(holder, oldKey)) continue;
    const oldPath = `${prefix}.${oldKey}`;
    const newPath = `${prefix}.${newKey}`;
    const oldValue = holder[oldKey];
    const existing = holder[newKey];

    if (existing !== undefined && existing !== null) {
      changes.push({ kind: "drop-old", oldPath, newPath, oldValue, newValue: existing });
    } else if (oldValue === undefined || oldValue === null || oldValue === "") {
      changes.push({ kind: "drop-empty", oldPath, newPath, oldValue });
    } else {
      const minutes = typeof oldValue === "number" ? oldValue : Number(oldValue);
      if (Number.isFinite(minutes)) {
        changes.push({ kind: "convert", oldPath, newPath, oldValue, newValue: minutesToHours(minutes) });
      } else {
        changes.push({ kind: "skip", oldPath, newPath, oldValue });
      }
    }
  }
}

/** A step-2-shaped body: its own keys, plus every inHouseServices entry's data. */
export function planBody(body, prefix, changes = []) {
  if (!isObject(body)) return changes;
  planHolder(body, prefix, changes);
  const services = body.inHouseServices;
  if (isObject(services)) {
    for (const [service, entries] of Object.entries(services)) {
      if (!Array.isArray(entries)) continue;
      entries.forEach((entry, i) => {
        planHolder(entry?.data, `${prefix}.inHouseServices.${service}.${i}.data`, changes);
      });
    }
  }
  return changes;
}

/**
 * Per collection: which step-2 bodies a document carries (as [body, path]
 * pairs), and the dotted prefixes to query for — dotted paths match through
 * arrays, so `data.packages.step2_productsAndPricing` covers every snapshot.
 */
export const TARGETS = {
  Package: {
    queryPrefixes: ["step2_productsAndPricing"],
    bodies: (doc) => [[doc.step2_productsAndPricing, "step2_productsAndPricing"]],
  },
  Template: {
    queryPrefixes: ["data.packages.step2_productsAndPricing"],
    bodies: (doc) =>
      Array.isArray(doc.data?.packages)
        ? doc.data.packages.map((pkg, i) => [
            pkg?.step2_productsAndPricing,
            `data.packages.${i}.step2_productsAndPricing`,
          ])
        : [],
  },
  Booking: {
    queryPrefixes: ["packageSnapshot.deliverables"],
    bodies: (doc) => [[doc.packageSnapshot?.deliverables, "packageSnapshot.deliverables"]],
  },
  Enquiry: {
    queryPrefixes: ["packageSnapshot.deliverables"],
    bodies: (doc) => [[doc.packageSnapshot?.deliverables, "packageSnapshot.deliverables"]],
  },
};

/** Mongo filter matching any document that still has an old key somewhere. */
export function candidateFilter(queryPrefixes) {
  const or = [];
  for (const prefix of queryPrefixes) {
    for (const oldKey of Object.keys(FIELD_RENAMES)) {
      or.push({ [`${prefix}.${oldKey}`]: { $exists: true } });
      for (const service of IN_HOUSE_SERVICE_KEYS) {
        or.push({ [`${prefix}.inHouseServices.${service}.data.${oldKey}`]: { $exists: true } });
      }
    }
  }
  return { $or: or };
}

/** All changes for one document. */
export function planDocument(target, doc) {
  const changes = [];
  for (const [body, prefix] of target.bodies(doc)) planBody(body, prefix, changes);
  return changes;
}

/**
 * The update for one document, or null when nothing is writable (only
 * "skip" changes). The filter re-checks every old key it removes, so a
 * concurrent re-run can't apply the same conversion twice.
 */
export function buildUpdate(docId, changes) {
  const writable = changes.filter((c) => c.kind !== "skip");
  if (!writable.length) return null;
  const $set = {};
  const $unset = {};
  const filter = { _id: docId };
  for (const c of writable) {
    if (c.kind === "convert") $set[c.newPath] = c.newValue;
    $unset[c.oldPath] = "";
    filter[c.oldPath] = { $exists: true };
  }
  const update = { $unset };
  if (Object.keys($set).length) update.$set = $set;
  return { filter, update };
}

/** Same effect as buildUpdate's update, applied to a plain object (for tests). */
export function applyChangesInMemory(doc, changes) {
  const walk = (path) => {
    const parts = path.split(".");
    const key = parts.pop();
    let node = doc;
    for (const p of parts) node = node?.[p];
    return [node, key];
  };
  for (const c of changes) {
    if (c.kind === "skip") continue;
    if (c.kind === "convert") {
      const [node, key] = walk(c.newPath);
      node[key] = c.newValue;
    }
    const [node, key] = walk(c.oldPath);
    delete node[key];
  }
  return doc;
}

const describe = (c) => {
  switch (c.kind) {
    case "convert":
      return `${c.oldPath}: ${c.oldValue} min → ${c.newPath.split(".").pop()} = ${c.newValue} h`;
    case "drop-old":
      return `${c.oldPath}: ${c.oldValue} min dropped — ${c.newPath.split(".").pop()} already ${c.newValue} h`;
    case "drop-empty":
      return `${c.oldPath}: empty (${JSON.stringify(c.oldValue)}) — removed`;
    default:
      return `${c.oldPath}: ${JSON.stringify(c.oldValue)} is not a number — LEFT AS IS, fix by hand`;
  }
};

async function main() {
  const DRY_RUN = process.argv.includes("--dry-run");

  if (!process.env.MONGO_URI) {
    console.error(
      "❌ MONGO_URI is not set — run with: node --env-file=.env migrate_inhouse_durations_to_hours.mjs"
    );
    process.exit(1);
  }

  const models = {
    Package: (await import("./src/models/Package.js")).default,
    Template: (await import("./src/models/Template.js")).default,
    Booking: (await import("./src/models/Booking.js")).default,
    Enquiry: (await import("./src/models/Enquiry.js")).default,
  };

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`✅ Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  if (DRY_RUN) console.log("🔍 DRY RUN — no writes will be made.\n");

  let totalDocs = 0;
  let totalSkipped = 0;

  for (const [name, target] of Object.entries(TARGETS)) {
    // The native driver collection: no casting, no strict-mode stripping.
    const collection = models[name].collection;
    const docs = await collection.find(candidateFilter(target.queryPrefixes)).toArray();

    const writes = [];
    for (const doc of docs) {
      const changes = planDocument(target, doc);
      if (!changes.length) continue;
      totalSkipped += changes.filter((c) => c.kind === "skip").length;
      console.log(`  [${name}] ${doc._id}`);
      for (const c of changes) console.log(`      ${describe(c)}`);
      const op = buildUpdate(doc._id, changes);
      if (op) writes.push({ updateOne: op });
    }

    console.log(`${name} (${collection.collectionName}): ${docs.length} candidate(s), ${writes.length} to update\n`);
    totalDocs += writes.length;

    if (writes.length && !DRY_RUN) {
      const result = await collection.bulkWrite(writes, { ordered: false });
      console.log(`✅ ${name}: updated ${result.modifiedCount} document(s).\n`);
    }
  }

  if (totalSkipped) {
    console.log(`⚠️  ${totalSkipped} non-numeric value(s) left untouched — see "LEFT AS IS" above.`);
  }
  if (!totalDocs) {
    console.log("✅ No old minute keys left — nothing to do.");
  } else if (DRY_RUN) {
    console.log(`🔍 DRY RUN — would have updated ${totalDocs} document(s).`);
  }

  await mongoose.disconnect();
}

// Run only when executed directly, so the planning helpers above can be
// imported and checked without a database.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error) => {
    console.error(`❌ ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
