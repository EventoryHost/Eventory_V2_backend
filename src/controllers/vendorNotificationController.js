import mongoose from "mongoose";
import VendorNotification, { NOTIFICATION_CATEGORIES } from "../models/VendorNotification.js";
import VendorDevice, { DEVICE_PLATFORMS } from "../models/VendorDevice.js";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
// Open actions are returned whole, not paged, so the "N actions required"
// header is right however far the vendor has scrolled. Capped as a guard.
const MAX_OPEN_ACTIONS = 100;

const invalid = (res, message) => res.status(400).json({ status: "FAILED", message });

const failed = (res, message, error) => {
  console.error(`${message}:`, error);
  return res.status(500).json({ status: "ERROR", message, error: error.message });
};

const toJson = (n) => ({
  notificationId: n.notificationId,
  category: n.category,
  type: n.type,
  title: n.title,
  body: n.body,
  customerName: n.customerName,
  eventName: n.eventName,
  serviceLabel: n.serviceLabel,
  detail: n.detail,
  detailKind: n.detailKind,
  showsPackageImage: n.showsPackageImage,
  imageUrl: n.imageUrl,
  needsAction: n.needsAction,
  isUnread: !n.readAt,
  target: { kind: n.target?.kind || "none", id: n.target?.id ?? null },
  createdAt: n.createdAt,
});

/** Cursor = "<createdAt ms>_<_id>" of the last row on the previous page. */
const encodeCursor = (n) => `${new Date(n.createdAt).getTime()}_${n._id}`;

const decodeCursor = (cursor) => {
  const [ms, id] = String(cursor).split("_");
  const time = Number(ms);
  if (!Number.isFinite(time) || !mongoose.Types.ObjectId.isValid(id)) return null;
  return { createdAt: new Date(time), _id: new mongoose.Types.ObjectId(id) };
};

const parseCategory = (raw) => {
  if (raw === undefined || raw === "" || raw === "all") return { value: null };
  return NOTIFICATION_CATEGORIES.includes(raw)
    ? { value: raw }
    : { error: `category must be one of: all, ${NOTIFICATION_CATEGORIES.join(", ")}` };
};

/** Unread count per category plus "all", zero-filled. */
const unreadCounts = async (vendorId) => {
  const rows = await VendorNotification.aggregate([
    { $match: { vendorId, readAt: null } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, 0]));
  let all = 0;
  for (const { _id, count } of rows) {
    if (_id in counts) counts[_id] = count;
    all += count;
  }
  return { all, ...counts };
};

/**
 * @desc   The vendor's inbox. First page (no cursor) also carries every open
 *         action for the filter; `notifications` pages through the rest,
 *         newest first.
 * @route  GET /api/notifications/vendor/:vendorId?category=&cursor=&limit=
 */
export const getVendorNotifications = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const category = parseCategory(req.query.category);
    if (category.error) return invalid(res, category.error);

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;
    if (req.query.cursor && !cursor) return invalid(res, "Invalid cursor");

    const scope = { vendorId };
    if (category.value) scope.category = category.value;

    const feedQuery = { ...scope, needsAction: false };
    if (cursor) {
      feedQuery.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
      ];
    }

    const [actions, page, counts] = await Promise.all([
      cursor
        ? Promise.resolve(null)
        : VendorNotification.find({ ...scope, needsAction: true })
            .sort({ createdAt: -1, _id: -1 })
            .limit(MAX_OPEN_ACTIONS)
            .lean(),
      VendorNotification.find(feedQuery)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean(),
      unreadCounts(vendorId),
    ]);

    const hasMore = page.length > limit;
    const rows = hasMore ? page.slice(0, limit) : page;

    return res.status(200).json({
      status: "SUCCESS",
      actions: actions ? actions.map(toJson) : null,
      notifications: rows.map(toJson),
      nextCursor: hasMore ? encodeCursor(rows[rows.length - 1]) : null,
      unreadCounts: counts,
    });
  } catch (error) {
    return failed(res, "Failed to fetch notifications", error);
  }
};

/**
 * @desc   Mark one notification read (the vendor opened it).
 * @route  PATCH /api/notifications/vendor/:vendorId/:notificationId/read
 */
export const markNotificationRead = async (req, res) => {
  try {
    const { vendorId, notificationId } = req.params;
    // Only an unread row is stamped, so reopening keeps the first readAt.
    const updated =
      (await VendorNotification.findOneAndUpdate(
        { vendorId, notificationId, readAt: null },
        { $set: { readAt: new Date() } },
        { returnDocument: "after" }
      ).lean()) ?? (await VendorNotification.findOne({ vendorId, notificationId }).lean());
    if (!updated) {
      return res.status(404).json({ status: "FAILED", message: "Notification not found" });
    }
    return res.status(200).json({
      status: "SUCCESS",
      notification: toJson(updated),
      unreadCounts: await unreadCounts(vendorId),
    });
  } catch (error) {
    return failed(res, "Failed to mark notification as read", error);
  }
};

/**
 * @desc   Mark everything read, or only one category's rows.
 * @route  PATCH /api/notifications/vendor/:vendorId/read-all?category=
 */
export const markAllNotificationsRead = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const category = parseCategory(req.query.category ?? req.body?.category);
    if (category.error) return invalid(res, category.error);

    const filter = { vendorId, readAt: null };
    if (category.value) filter.category = category.value;
    const result = await VendorNotification.updateMany(filter, { $set: { readAt: new Date() } });

    return res.status(200).json({
      status: "SUCCESS",
      updated: result.modifiedCount,
      unreadCounts: await unreadCounts(vendorId),
    });
  } catch (error) {
    return failed(res, "Failed to mark notifications as read", error);
  }
};

// FCM tokens are ~150 characters; anything far longer is not one.
const MAX_TOKEN_LENGTH = 4096;

const parseDevice = (body = {}) => {
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token || token.length > MAX_TOKEN_LENGTH) return { error: "token is required" };
  if (body.platform !== undefined && !DEVICE_PLATFORMS.includes(body.platform)) {
    return { error: `platform must be one of: ${DEVICE_PLATFORMS.join(", ")}` };
  }
  return { token, platform: body.platform, appVersion: body.appVersion ? String(body.appVersion).slice(0, 32) : null };
};

/**
 * @desc   Register this phone for pushes (called after login, on launch and
 *         when FCM rotates the token). A token another vendor registered
 *         moves to this vendor — one phone gets one vendor's pushes.
 * @route  POST /api/notifications/vendor/:vendorId/devices
 */
export const registerDevice = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const device = parseDevice(req.body);
    if (device.error) return invalid(res, device.error);
    if (!device.platform) return invalid(res, `platform must be one of: ${DEVICE_PLATFORMS.join(", ")}`);

    await VendorDevice.findOneAndUpdate(
      { token: device.token },
      {
        $set: { vendorId, platform: device.platform, appVersion: device.appVersion, lastSeenAt: new Date() },
      },
      { upsert: true }
    );
    return res.status(200).json({ status: "SUCCESS" });
  } catch (error) {
    return failed(res, "Failed to register device", error);
  }
};

/**
 * @desc   Stop pushes to this phone (called on logout, before the session is
 *         cleared). Only removes the token if it is this vendor's.
 * @route  DELETE /api/notifications/vendor/:vendorId/devices
 */
export const unregisterDevice = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const device = parseDevice(req.body);
    if (device.error) return invalid(res, device.error);

    const result = await VendorDevice.deleteOne({ token: device.token, vendorId });
    return res.status(200).json({ status: "SUCCESS", removed: result.deletedCount });
  } catch (error) {
    return failed(res, "Failed to unregister device", error);
  }
};
