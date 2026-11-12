import mongoose from "mongoose";

/**
 * A phone the vendor app is signed in on, and the Firebase Cloud Messaging
 * token pushes for that vendor are sent to (services/pushService.js).
 *
 * One row per FCM token. The token is unique across vendors: when a second
 * vendor signs in on the same phone the row moves to them, so the first
 * vendor's pushes stop reaching it. The app removes its row on logout, and
 * pushService deletes rows FCM reports as no longer registered.
 */
export const DEVICE_PLATFORMS = ["ios", "android"];

const VendorDeviceSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    // Public vendor id ("VEN…").
    vendorId: { type: String, required: true, index: true },
    platform: { type: String, enum: DEVICE_PLATFORMS, required: true },
    appVersion: { type: String, default: null },
    // Last time the app re-registered (launch or token refresh) — lets stale
    // rows be pruned if FCM never reports them.
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "vendor_devices" }
);

export default mongoose.model("VendorDevice", VendorDeviceSchema);
