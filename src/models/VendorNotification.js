import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { generateISTId } from "../utils/idGenerator.js";

/**
 * Vendor in-app inbox (business app → Inbox → Notification tab).
 *
 * One document per thing the vendor is told about. Rows are written by
 * services/vendorNotificationService.js from the type catalogue in
 * constants/vendorNotificationTypes.js — never hand-built in controllers —
 * so the copy and the category/action flags stay in one place.
 *
 * Two independent flags drive the row:
 *  - readAt          null → unread (bold title + dot). Cleared by opening the
 *                    row or "mark all as read".
 *  - needsAction     the row sits under "N actions required" until the thing
 *                    it asks for is done (actionResolvedAt set by the flow
 *                    that does it), not merely when it is read.
 */
export const NOTIFICATION_CATEGORIES = [
  "eventDay",
  "booking",
  "enquiry",
  "payments",
  "profile",
  "package",
  "support",
];

/**
 * Where tapping the row takes the vendor. `id` is the public id of the
 * entity (BKG…, ENQ…, package group id) when the kind needs one.
 */
export const NOTIFICATION_TARGET_KINDS = [
  "booking",
  "eventDay",
  "enquiry",
  "payments",
  "package",
  "packages",
  "profile",
  "documents",
  "support",
  "none",
];

const TargetSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: NOTIFICATION_TARGET_KINDS, default: "none" },
    id: { type: String, default: null },
  },
  { _id: false }
);

const VendorNotificationSchema = new mongoose.Schema(
  {
    notificationId: {
      type: String,
      unique: true,
      required: true,
      // Time-based like other ids, plus a random tail: one event can write
      // several rows within the same millisecond.
      default: () => `${generateISTId("NTF")}${randomBytes(3).toString("hex")}`,
    },
    // Public vendor id ("VEN…"), as bookings and enquiries store it.
    vendorId: { type: String, required: true },
    category: { type: String, enum: NOTIFICATION_CATEGORIES, required: true },
    // Catalogue key, e.g. "booking.newRequest". Lets the app special-case a
    // type later without parsing copy.
    type: { type: String, required: true },

    title: { type: String, required: true },
    body: { type: String, default: "" },

    // Meta line: "Customer · Event", or serviceLabel when there is no customer.
    customerName: { type: String, default: null },
    eventName: { type: String, default: null },
    serviceLabel: { type: String, default: null },

    // Footer line under the body: a venue or an event slot.
    detail: { type: String, default: null },
    detailKind: { type: String, enum: ["location", "schedule"], default: "location" },

    showsPackageImage: { type: Boolean, default: false },
    imageUrl: { type: String, default: null },

    needsAction: { type: Boolean, default: false },
    actionResolvedAt: { type: Date, default: null },
    readAt: { type: Date, default: null },

    target: { type: TargetSchema, default: () => ({}) },

    // Same key twice for one vendor = one row (e.g. a webhook retried, or a
    // reminder that must fire once per booking).
    dedupeKey: { type: String, default: undefined },
  },
  { timestamps: true, collection: "vendor_notifications" }
);

VendorNotificationSchema.index({ vendorId: 1, createdAt: -1, _id: -1 });
VendorNotificationSchema.index({ vendorId: 1, category: 1, createdAt: -1, _id: -1 });
VendorNotificationSchema.index({ vendorId: 1, readAt: 1 });
VendorNotificationSchema.index({ vendorId: 1, "target.id": 1, needsAction: 1 });
VendorNotificationSchema.index(
  { vendorId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } }
);

export default mongoose.model("VendorNotification", VendorNotificationSchema);
