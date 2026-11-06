import VendorNotification from "../models/VendorNotification.js";
import Package from "../models/Package.js";
import { packageCoverImage } from "../utils/packageCoverImage.js";
import { resolveVendorRefId } from "../utils/resolveVendor.js";
import { VENDOR_NOTIFICATION_TYPES } from "../constants/vendorNotificationTypes.js";

/**
 * Writes rows into the vendor inbox (models/VendorNotification.js).
 *
 * Both entry points are fire-and-forget: they never throw and never reject,
 * so a failed inbox write can't fail the booking, payment or review that
 * caused it. Call them after the triggering change is saved, without
 * awaiting (`notifyVendor(...)`), or await them where ordering matters.
 *
 * Context fields (all optional unless the type needs them):
 *   vendorId*        public "VEN…" id
 *   bookingId        "EVT…"           enquiryId  "ENQ…"
 *   packageGroupId   for package rows
 *   customerName     full name — the row shows the first name
 *   eventName        e.g. "Wedding"
 *   packageName, detail, detailKind ("location" | "schedule"), imageUrl
 *   …plus type-specific fields used by the catalogue's copy.
 *   dedupeKey        one row per (vendor, key); repeats are dropped
 */

const firstName = (name) => {
  const first = String(name ?? "").trim().split(/\s+/)[0];
  return first || null;
};

const IST = "Asia/Kolkata";

/** "24 Oct" in IST, or null. */
export const dateLabel = (date) =>
  date ? new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST }) : null;

/** "9:30 AM" in IST, or null. */
const timeLabel = (date) =>
  new Date(date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: IST });

/**
 * "9:30 AM" when the deadline is today in IST, "9:30 AM tomorrow" for
 * tomorrow, else "24 Oct, 9:30 AM". Null for no/past deadline.
 */
export const deadlineLabel = (date) => {
  if (!date) return null;
  const at = new Date(date);
  if (isNaN(at) || at <= new Date()) return null;
  const day = (d) => d.toLocaleDateString("en-CA", { timeZone: IST });
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  if (day(at) === day(today)) return timeLabel(at);
  if (day(at) === day(tomorrow)) return `${timeLabel(at)} tomorrow`;
  return `${dateLabel(at)}, ${timeLabel(at)}`;
};

/**
 * Shared context for a booking or enquiry document: who, which event, which
 * package, and the venue footer.
 */
export const contextFromDeal = (doc) => {
  if (!doc) return {};
  return {
    vendorId: doc.vendorId ? String(doc.vendorId) : null,
    bookingId: doc.bookingId ?? null,
    enquiryId: doc.enquiryId ?? null,
    customerName: doc.customer?.name ?? null,
    eventName: doc.eventType ?? null,
    packageName: doc.packageSnapshot?.name ?? null,
    imageUrl: doc.packageSnapshot?.image ?? null,
    detail: doc.location ?? doc.venueName ?? null,
    eventDateLabel: dateLabel(doc.eventDate),
    respondByLabel: deadlineLabel(doc.respondByAt),
  };
};

/** "MakeupArtist" → "Makeup Artist". */
const spaced = (value) => (value ? String(value).replace(/([a-z])([A-Z])/g, "$1 $2") : null);

/**
 * Context for a package row, from any variant of the group: its vendor
 * (Package.vendorId is stored both ways, so it is resolved), name, cover and
 * the vendor's service as the meta line.
 */
export const contextFromPackage = async (pkg) => {
  if (!pkg) return {};
  return {
    vendorId: await resolveVendorRefId(pkg.vendorId),
    packageGroupId: pkg.packageGroupId ? String(pkg.packageGroupId) : String(pkg._id),
    packageName: pkg.step1_eventAndCrew?.packageName ?? null,
    imageUrl: packageCoverImage(pkg),
    serviceLabel: spaced(pkg.vendorType),
  };
};

/**
 * notifyVendor() for a package group, looked up by [groupFilter]. Never
 * throws.
 */
export async function notifyPackageGroup(type, groupFilter, extra = {}) {
  try {
    const pkg = await Package.findOne(groupFilter)
      .select("vendorId vendorType packageGroupId step1_eventAndCrew.packageName step4_sampleMedia")
      .lean();
    if (!pkg) return null;
    const ctx = await contextFromPackage(pkg);
    if (extra.resolveActions) {
      await resolveVendorActions(ctx.vendorId, ctx.packageGroupId, extra.resolveActions);
    }
    return type ? await notifyVendor(type, { ...ctx, ...extra }) : null;
  } catch (error) {
    console.error(`[notify] ${type} for package group failed:`, error.message);
    return null;
  }
}

const resolveFlag = (value, ctx) => (typeof value === "function" ? Boolean(value(ctx)) : Boolean(value));

/**
 * Adds one row to a vendor's inbox. Resolves to the saved row, or null when
 * nothing was written (unknown type, no vendor, duplicate, or an error —
 * which is logged).
 */
export async function notifyVendor(type, rawCtx = {}) {
  try {
    const def = VENDOR_NOTIFICATION_TYPES[type];
    if (!def) {
      console.warn(`[notify] unknown notification type "${type}"`);
      return null;
    }
    const ctx = { ...rawCtx, customerName: firstName(rawCtx.customerName) };
    if (!ctx.vendorId) {
      console.warn(`[notify] ${type}: no vendorId, skipped`);
      return null;
    }

    const target = def.target ? def.target(ctx) : { kind: "none", id: null };
    return await VendorNotification.create({
      vendorId: String(ctx.vendorId),
      category: def.category,
      type,
      title: def.title(ctx),
      body: def.body ? def.body(ctx) : "",
      customerName: ctx.customerName,
      eventName: ctx.eventName ?? null,
      serviceLabel: ctx.customerName || ctx.eventName ? null : (ctx.serviceLabel ?? null),
      detail: ctx.detail ?? null,
      detailKind: ctx.detailKind ?? def.detailKind ?? "location",
      showsPackageImage: resolveFlag(def.showsPackageImage, ctx),
      imageUrl: ctx.imageUrl ?? null,
      needsAction: resolveFlag(def.needsAction, ctx),
      target,
      dedupeKey: ctx.dedupeKey,
    });
  } catch (error) {
    if (error?.code === 11000 && rawCtx.dedupeKey) return null; // already sent
    console.error(`[notify] ${type} for vendor ${rawCtx.vendorId} failed:`, error.message);
    return null;
  }
}

/**
 * Clears "needs action" on a vendor's open rows about one booking, enquiry
 * or package — the vendor has done what they asked. Limit with [types];
 * omit it to clear every open action on the target. Never throws.
 */
export async function resolveVendorActions(vendorId, targetId, types) {
  try {
    if (!vendorId || !targetId) return 0;
    const filter = { vendorId: String(vendorId), "target.id": String(targetId), needsAction: true };
    if (types?.length) filter.type = { $in: types };
    const result = await VendorNotification.updateMany(filter, {
      $set: { needsAction: false, actionResolvedAt: new Date() },
    });
    return result.modifiedCount;
  } catch (error) {
    console.error(`[notify] resolving actions on ${targetId} failed:`, error.message);
    return 0;
  }
}

/** Same, for account-level actions that carry no target id (profile). */
export async function resolveVendorActionsByType(vendorId, types) {
  try {
    if (!vendorId || !types?.length) return 0;
    const result = await VendorNotification.updateMany(
      { vendorId: String(vendorId), needsAction: true, type: { $in: types } },
      { $set: { needsAction: false, actionResolvedAt: new Date() } }
    );
    return result.modifiedCount;
  } catch (error) {
    console.error(`[notify] resolving ${types} failed:`, error.message);
    return 0;
  }
}

export default {
  notifyVendor,
  notifyPackageGroup,
  resolveVendorActions,
  resolveVendorActionsByType,
  contextFromDeal,
  contextFromPackage,
};
