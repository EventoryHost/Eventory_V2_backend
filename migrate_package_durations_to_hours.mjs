/**
 * Package Step 1 durations: legacy minute values -> decimal hours.
 *
 * USAGE (never writes unless --apply is passed)
 *   Dry run (default):  node --env-file=.env migrate_package_durations_to_hours.mjs
 *   Apply all:          node --env-file=.env migrate_package_durations_to_hours.mjs --apply
 *   Apply reviewed ids: node --env-file=.env migrate_package_durations_to_hours.mjs --apply --ids=PKG_1,PKG_2
 *   Review the dry-run list before any --apply; --ids limits writes to the listed _ids.
 *
 * WHY THIS EXISTS
 *   Package durations are stored as raw decimal hours (1 hr 30 min = 1.5):
 *
 *     step1_eventAndCrew.duration.minHours
 *     step1_eventAndCrew.duration.maxHours
 *     step1_eventAndCrew.durationOfSetup
 *     step1_eventAndCrew.durationPerPerson
 *
 *   Before eventory_business_app_v2 #70 the Flutter vendor app keyed its
 *   duration dropdowns by MINUTES and saved e.g. 90 for "1 hr 30 min" and
 *   720 for "12 hrs" into these hour-named fields. The web vendor dashboard
 *   always saved hours. Eventory_V2_frontend #33 made the customer site read
 *   the fields as hours, so every app-created package now shows e.g.
 *   "240 hrs - 300 hrs" instead of "4 hrs - 5 hrs".
 *
 * HOW MINUTE-VALUED PACKAGES ARE RECOGNISED (no source/platform field exists)
 *   The old app could only ever save values from one fixed option set:
 *
 *     15 30 45 60 90 120 150 180 240 300 360 480 600 720
 *     840 960 1080 1200 1320 1440
 *
 *   ("Upto N hours" setup options 60/120/300/480/600/720 are a subset.)
 *   Every hours-based writer (web dashboard dropdowns 1..24, "Upto 24 Hours",
 *   new app 0.25..24) stays <= 24. So, looking at a package's non-zero
 *   duration values together:
 *
 *     convert    every value is in the legacy set AND at least one is > 24
 *                -> all four fields are divided by 60
 *     ambiguous  every value is in the legacy set but none is > 24 (only
 *                possible with 15: "15 min" or "15 hrs"?) -> reported only
 *     mixed      some value is > 24 and in the legacy set, some other value
 *                is not in it -> reported only, fix by hand
 *     hours      anything else -> untouched
 *
 *   FALSE-POSITIVE RISK: the web DJ / PAV / Venue / Makeup forms take free
 *   integer input with no max, so a web package could hold e.g. 30 or 60
 *   real hours and would be classed "convert". Always review the dry-run
 *   list, and prefer --ids=<id,id,...> to apply only reviewed packages.
 *
 *   Converted values are <= 24, so a second run never re-converts them.
 *   Old app builds (< #70, no forced update, no version header) can keep
 *   writing minutes after this runs; re-run the dry-run until they are gone.
 *
 * WHERE STEP 1 LIVES
 *   packages   step1_eventAndCrew
 *   templates  data.packages[].step1_eventAndCrew  (Mixed snapshot)
 *   (Booking/enquiry snapshots hold deliverables only, not Step 1.)
 */

import mongoose from "mongoose";
import { pathToFileURL } from "node:url";

export const LEGACY_MINUTE_VALUES = new Set([
  15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600, 720,
  840, 960, 1080, 1200, 1320, 1440,
]);

/** Largest value any hours-based writer could produce from its dropdowns. */
export const MAX_PLAUSIBLE_HOURS = 24;

/** Step 1 duration fields, relative to step1_eventAndCrew. */
export const FIELDS = ["duration.minHours", "duration.maxHours", "durationOfSetup", "durationPerPerson"];

export const minutesToHours = (minutes) => Math.round((minutes / 60) * 100) / 100;

const get = (obj, path) => path.split(".").reduce((node, key) => node?.[key], obj);

/**
 * Classifies one step1_eventAndCrew body.
 * Returns { kind, values, changes } where changes are { path, oldValue, newValue }.
 */
export function classifyStep1(step1, prefix = "step1_eventAndCrew") {
  const values = [];
  for (const field of FIELDS) {
    const raw = get(step1, field);
    const n = typeof raw === "number" ? raw : raw == null || raw === "" ? NaN : Number(raw);
    if (Number.isFinite(n) && n > 0) values.push({ path: `${prefix}.${field}`, value: n });
  }
  if (!values.length) return { kind: "hours", values, changes: [] };

  const inSet = values.filter((v) => LEGACY_MINUTE_VALUES.has(v.value));
  const tooBig = inSet.some((v) => v.value > MAX_PLAUSIBLE_HOURS);

  let kind;
  if (inSet.length === values.length) kind = tooBig ? "convert" : "ambiguous";
  else kind = tooBig ? "mixed" : "hours";

  const changes =
    kind === "convert"
      ? values.map((v) => ({ path: v.path, oldValue: v.value, newValue: minutesToHours(v.value) }))
      : [];
  return { kind, values, changes };
}

export const TARGETS = {
  Package: {
    filter: {},
    bodies: (doc) => [[doc.step1_eventAndCrew, "step1_eventAndCrew", doc.step1_eventAndCrew?.packageName]],
  },
  Template: {
    filter: { "data.packages.step1_eventAndCrew": { $exists: true } },
    bodies: (doc) =>
      Array.isArray(doc.data?.packages)
        ? doc.data.packages.map((pkg, i) => [
            pkg?.step1_eventAndCrew,
            `data.packages.${i}.step1_eventAndCrew`,
            pkg?.step1_eventAndCrew?.packageName,
          ])
        : [],
  },
};

/** Update for one document; the filter pins every old value so a re-run or race can't double-convert. */
export function buildUpdate(docId, changes) {
  if (!changes.length) return null;
  const filter = { _id: docId };
  const $set = {};
  for (const c of changes) {
    filter[c.path] = c.oldValue;
    $set[c.path] = c.newValue;
  }
  return { filter, update: { $set } };
}

const fmt = (vals) => vals.map((v) => `${v.path.split(".").slice(-1)[0]}=${v.value}`).join(", ");

async function main() {
  const APPLY = process.argv.includes("--apply");
  const idsArg = process.argv.find((a) => a.startsWith("--ids="));
  const onlyIds = idsArg ? new Set(idsArg.slice(6).split(",").map((s) => s.trim()).filter(Boolean)) : null;

  if (!process.env.MONGO_URI) {
    console.error(
      "❌ MONGO_URI is not set — run with: node --env-file=.env migrate_package_durations_to_hours.mjs"
    );
    process.exit(1);
  }

  const models = {
    Package: (await import("./src/models/Package.js")).default,
    Template: (await import("./src/models/Template.js")).default,
  };

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`✅ Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  console.log(APPLY ? "⚠️  APPLY — writes WILL be made.\n" : "🔍 DRY RUN (default) — no writes will be made. Pass --apply to write.\n");

  const report = { convert: 0, ambiguous: 0, mixed: 0 };
  for (const [name, target] of Object.entries(TARGETS)) {
    const collection = models[name].collection; // raw driver: no casting / strict stripping
    const docs = await collection.find(target.filter).toArray();
    const writes = [];

    for (const doc of docs) {
      const docChanges = [];
      for (const [step1, prefix, pkgName] of target.bodies(doc)) {
        const { kind, values, changes } = classifyStep1(step1, prefix);
        if (kind === "hours") continue;
        report[kind] += 1;
        const meta = `${doc.vendorType ?? ""} ${doc.packageStatus ?? ""} vendor=${doc.vendorId ?? doc.ownerVendorId ?? ""} updatedAt=${doc.updatedAt?.toISOString?.() ?? doc.updatedAt ?? ""}`;
        console.log(`  [${name}] ${doc._id} "${pkgName ?? ""}" ${meta}`);
        if (kind === "convert") {
          for (const c of changes) console.log(`      ${c.path}: ${c.oldValue} min → ${c.newValue} h`);
          if (!onlyIds || onlyIds.has(String(doc._id))) docChanges.push(...changes);
          else console.log("      (not in --ids, skipped)");
        } else {
          console.log(`      ${kind.toUpperCase()} — LEFT AS IS, fix by hand: ${fmt(values)}`);
        }
      }
      const op = buildUpdate(doc._id, docChanges);
      if (op) writes.push({ updateOne: op });
    }

    console.log(`${name} (${collection.collectionName}): ${docs.length} scanned, ${writes.length} to update\n`);
    if (writes.length && APPLY) {
      const result = await collection.bulkWrite(writes, { ordered: false });
      console.log(`✅ ${name}: updated ${result.modifiedCount} document(s).\n`);
    }
  }

  console.log(`Summary: ${report.convert} convert, ${report.ambiguous} ambiguous, ${report.mixed} mixed.`);
  if (report.ambiguous || report.mixed) {
    console.log("⚠️  Ambiguous/mixed packages were left untouched — see \"LEFT AS IS\" above.");
  }
  if (!APPLY) console.log("🔍 DRY RUN — nothing written.");
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
