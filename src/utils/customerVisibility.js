import Vendor from "../models/Vendor.js";

/**
 * Whether customers may see a vendor — and so their profile, packages, cart
 * lines and reviews. One rule, read by every customer-facing controller
 * (added 2026-10-13). A vendor is hidden when:
 *
 *   - the account is deactivated (support, or a pending deletion);
 *   - an admin has made them Unlive (`hiddenByAdmin`) — unlike deactivation
 *     the vendor keeps their app login;
 *   - their profile is under LIVE_MIN_COMPLETION percent complete. Read from
 *     the stored `verification.completionPercent` (kept in sync by the Vendor
 *     pre-save hook and onVendorEdit); a vendor with no stored percentage is
 *     hidden until migrate_vendor_verification.mjs fills it in.
 *
 * Customer booking reads (customerBookingController, resolveVendor.js) do NOT
 * apply this: a customer who already booked a vendor keeps seeing that
 * booking. Admin and vendor-app reads never apply it either.
 */
export const LIVE_MIN_COMPLETION = 50;

/** Mongo clause for Vendor queries: only vendors customers may see. */
export const VISIBLE_VENDOR_FILTER = {
  isDeactivated: { $ne: true },
  hiddenByAdmin: { $ne: true },
  "verification.completionPercent": { $gte: LIVE_MIN_COMPLETION },
};

/** Mongo clause for Vendor queries: the vendors customers may not see. */
export const HIDDEN_VENDOR_FILTER = {
  $or: [
    { isDeactivated: true },
    { hiddenByAdmin: true },
    { "verification.completionPercent": { $not: { $gte: LIVE_MIN_COMPLETION } } },
  ],
};

/**
 * Why a vendor is (or is not) visible to customers. `completionPercent`
 * overrides the stored figure when the caller has just computed it.
 *
 * @returns {{ visible: boolean, reasons: ("unlive"|"deactivated"|"incomplete")[],
 *   completionPercent: number|null, minCompletion: number,
 *   hiddenByAdminAt: Date|null, hiddenByAdminReason: string|null }}
 */
export const customerVisibility = (vendor, { completionPercent } = {}) => {
  const percent = completionPercent ?? vendor?.verification?.completionPercent ?? null;
  const reasons = [];
  if (vendor?.hiddenByAdmin) reasons.push("unlive");
  if (vendor?.isDeactivated) reasons.push("deactivated");
  if (!(typeof percent === "number" && percent >= LIVE_MIN_COMPLETION)) reasons.push("incomplete");
  return {
    visible: reasons.length === 0,
    reasons,
    completionPercent: percent,
    minCompletion: LIVE_MIN_COMPLETION,
    hiddenByAdminAt: vendor?.hiddenByAdminAt ?? null,
    hiddenByAdminReason: vendor?.hiddenByAdminReason ?? null,
  };
};

// ----- hidden vendor keys -------------------------------------------------
//
// Package, CartItem, Review and the like store `vendorId` as either the
// vendor's "VEN…" id or its Mongo _id string (see resolveVendor.js), so the
// key list carries both. Cached briefly: it is read on every browse request,
// and a vendor crossing the completion line can wait a minute to appear.

const CACHE_TTL_MS = 60 * 1000;
let cache = null; // { keys: string[], at: number }
let inflight = null;

/** Every vendorId value that belongs to a hidden vendor. */
export const hiddenVendorKeys = async () => {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.keys;
  if (!inflight) {
    inflight = Vendor.find(HIDDEN_VENDOR_FILTER)
      .select("id _id")
      .lean()
      .then((rows) => {
        const keys = rows.flatMap((v) => [v.id, String(v._id)].filter(Boolean));
        cache = { keys, at: Date.now() };
        return keys;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
};

/** Drop the cache — call after anything that changes a vendor's visibility on purpose. */
export const invalidateHiddenVendors = () => {
  cache = null;
};

/** `{ vendorId: { $nin } }` for a Package / CartItem / Review query. */
export const visibleVendorIdClause = async () => ({
  vendorId: { $nin: await hiddenVendorKeys() },
});

/** Whether a stored vendorId belongs to a hidden vendor. */
export const isHiddenVendorKey = async (vendorId) =>
  vendorId != null && (await hiddenVendorKeys()).includes(String(vendorId));
