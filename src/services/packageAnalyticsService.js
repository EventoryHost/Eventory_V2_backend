import Package from "../models/Package.js";
import PackageViewDaily from "../models/PackageViewDaily.js";
import WishlistItem from "../models/WishlistItem.js";
import CartItem from "../models/CartItem.js";
import Cart from "../models/Cart.js";
import Booking from "../models/Booking.js";

/**
 * The numbers behind the vendor app's package Analytics popup.
 *
 * Views are the only metric that needs its own record (PackageViewDaily);
 * wishlist, cart and bookings are read straight from the collections that
 * already hold them, so they can never drift from what customers actually
 * have saved, carted or booked.
 */

/** Views are compared over two back-to-back windows of this many days. */
export const TREND_WINDOW_DAYS = 30;

// Same rule as the landing page's "often booked" carousel: a declined or
// cancelled booking never went through, so it is not a booking.
const EXCLUDED_BOOKING_STATUSES = ["Declined", "Cancelled"];

const DAY_MS = 24 * 60 * 60 * 1000;

const utcDay = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export class PackageAnalyticsError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "PackageAnalyticsError";
    this.statusCode = statusCode;
  }
}

/**
 * @desc Count one open of a package's detail page. Only Live packages are
 * counted: anything else is not on the marketplace, so a "view" of it is a
 * stale link, not interest.
 */
export const recordPackageView = async (packageId, now = new Date()) => {
  const id = String(packageId ?? "").trim();
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new PackageAnalyticsError(`Invalid packageId: ${packageId}`, 400);
  }

  const isLive = await Package.exists({ _id: id, packageStatus: "Live" });
  if (!isLive) throw new PackageAnalyticsError("Package not found or not Live", 404);

  await PackageViewDaily.updateOne(
    { packageId: id, day: utcDay(now) },
    { $inc: { count: 1 } },
    { upsert: true }
  );
};

/**
 * Most recent move to Live across the group's variants. Packages published
 * before reviewHistory existed have no WentLive row; for those the last
 * review decision is the closest record of when they went Live.
 */
const liveSinceOf = (packages) => {
  const wentLive = packages
    .flatMap((p) => p.reviewHistory || [])
    .filter((e) => e.event === "WentLive" && e.at)
    .map((e) => new Date(e.at).getTime());
  if (wentLive.length) return new Date(Math.max(...wentLive));

  const fallback = packages
    .filter((p) => p.packageStatus === "Live" && p.submission?.lastDecisionAt)
    .map((p) => new Date(p.submission.lastDecisionAt).getTime());
  return fallback.length ? new Date(Math.max(...fallback)) : null;
};

/**
 * @desc Analytics for one logical package — every variant in the group.
 * `viewsChangePercent` compares the last TREND_WINDOW_DAYS with the window
 * before it, and is null when the earlier window has no views to compare
 * against (a percentage of zero is not a number worth showing).
 */
export const getGroupAnalytics = async (groupFilter, now = new Date()) => {
  const packages = await Package.find(groupFilter)
    .select("_id packageStatus reviewHistory submission.lastDecisionAt")
    .lean();
  if (packages.length === 0) throw new PackageAnalyticsError("Package not found", 404);

  const ids = packages.map((p) => String(p._id));
  const today = utcDay(now);
  // Inclusive of today, so the current window is exactly TREND_WINDOW_DAYS days.
  const currentStart = new Date(today.getTime() - (TREND_WINDOW_DAYS - 1) * DAY_MS);
  const previousStart = new Date(currentStart.getTime() - TREND_WINDOW_DAYS * DAY_MS);

  const [views, wishlistCustomers, cartIds, bookingCount] = await Promise.all([
    PackageViewDaily.aggregate([
      { $match: { packageId: { $in: ids } } },
      {
        $group: {
          _id: null,
          total: { $sum: "$count" },
          current: { $sum: { $cond: [{ $gte: ["$day", currentStart] }, "$count", 0] } },
          previous: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ["$day", previousStart] }, { $lt: ["$day", currentStart] }] },
                "$count",
                0,
              ],
            },
          },
        },
      },
    ]),
    // Distinct customers: saving two variants of one package is still one
    // person interested in it.
    WishlistItem.distinct("customerId", { itemType: "Package", packageId: { $in: ids } }),
    CartItem.distinct("cartId", { packageId: { $in: ids } }),
    Booking.countDocuments({
      packageId: { $in: ids },
      status: { $nin: EXCLUDED_BOOKING_STATUSES },
    }),
  ]);

  // Guest carts expire by TTL without taking their items with them, so a
  // cart row is only counted while its cart still exists.
  const cartCount = cartIds.length
    ? await Cart.countDocuments({ _id: { $in: cartIds } })
    : 0;

  const { total = 0, current = 0, previous = 0 } = views[0] || {};

  return {
    liveSince: liveSinceOf(packages),
    totalViews: total,
    viewsLastPeriod: current,
    viewsPreviousPeriod: previous,
    viewsChangePercent: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
    trendWindowDays: TREND_WINDOW_DAYS,
    wishlistCount: wishlistCustomers.length,
    cartCount,
    bookingCount,
  };
};

export default { recordPackageView, getGroupAnalytics, PackageAnalyticsError, TREND_WINDOW_DAYS };
