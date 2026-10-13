import Package from "../models/Package.js";

/**
 * The one, authoritative list of event categories that can actually be
 * booked right now — every unique step1_eventAndCrew.eventCategories value
 * across Live packages, both overall and broken down per vendorType (so a
 * category tab's own filter options can be scoped to just the vendor types
 * that tab actually represents). Shared by THREE customer surfaces: the
 * package listing filter, the vendor listing filter, and the landing page
 * search's Event Type field.
 *
 * Real bug this fixes: the vendor listing's own filter used to aggregate
 * Vendor.eventCategories instead (what a vendor SAYS they do, set at
 * onboarding) — a vendor can claim "Baby Shower Decoration" with zero Live
 * packages actually tagged that way, so picking that filter option landed
 * on "no packages found" even though the option itself was real. Sourcing
 * every one of these three surfaces from Package data instead means a
 * filter option can never exist without at least one matching package.
 *
 * Per-vendorType breakdown fixes a related gap (PM-reported 2026-10-14):
 * the package listing's Event Type list used to be the SAME global list on
 * every category tab, so e.g. the Decorator tab still offered "Workshop" —
 * a category that genuinely only has a Live Photographer (PAV) package —
 * which then correctly, but confusingly, resolved to "no packages found"
 * for that tab. Scoping the options per active vendorType means a tab only
 * ever offers event types a package of ITS OWN vendor type actually has.
 *
 * Cached in memory (same plain-Map-with-TTL pattern as
 * services/areaLookupService.js's geocodeCache) — this aggregation gets hit
 * on every visit to any of those three pages, but the real set of live
 * categories only changes when a vendor publishes/unpublishes a package, so
 * recomputing it on every single request is wasted DB work. A 10-minute
 * TTL means a brand-new category shows up for customers within 10 minutes
 * of going live, not instantly — an acceptable trade confirmed against the
 * low rate of change here, not a correctness issue.
 */
const TTL_MS = 10 * 60 * 1000;

let cache = null; // { all: string[], byVendorType: Record<string, string[]>, expiresAt: number }
let inFlight = null; // de-dupes concurrent cache-miss requests into one pair of aggregations

async function fetchLiveEventCategoriesData() {
  const [allRows, byTypeRows] = await Promise.all([
    Package.aggregate([
      { $match: { packageStatus: "Live" } },
      { $unwind: "$step1_eventAndCrew.eventCategories" },
      { $group: { _id: "$step1_eventAndCrew.eventCategories" } },
      { $sort: { _id: 1 } },
    ]),
    Package.aggregate([
      { $match: { packageStatus: "Live" } },
      { $unwind: "$step1_eventAndCrew.eventCategories" },
      { $group: { _id: { vendorType: "$vendorType", category: "$step1_eventAndCrew.eventCategories" } } },
      { $group: { _id: "$_id.vendorType", categories: { $addToSet: "$_id.category" } } },
    ]),
  ]);

  const byVendorType = {};
  byTypeRows.forEach((row) => {
    if (row._id) byVendorType[row._id] = row.categories.sort();
  });

  return { all: allRows.map((r) => r._id), byVendorType };
}

async function ensureFresh() {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache;

  if (!inFlight) {
    inFlight = fetchLiveEventCategoriesData()
      .then((data) => {
        cache = { ...data, expiresAt: Date.now() + TTL_MS };
        return cache;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** `vendorType` omitted (or falsy) returns every live category; passed, returns only that vendor type's own. */
export async function getLiveEventCategories(vendorType) {
  const fresh = await ensureFresh();
  if (!vendorType) return fresh.all;
  return fresh.byVendorType[vendorType] ?? [];
}

/** Forces the next call to recompute — not wired to anything yet (no admin
 * "publish package" hook invalidates this today), but exported so one can be
 * added without touching the cache's own internals. */
export function invalidateLiveEventCategoriesCache() {
  cache = null;
}

export default getLiveEventCategories;
