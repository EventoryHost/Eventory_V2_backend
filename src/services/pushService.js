import admin from "firebase-admin";
import VendorDevice from "../models/VendorDevice.js";

/**
 * Push notifications to the vendor app through Firebase Cloud Messaging.
 *
 * Only ever called after the inbox row is saved (vendorNotificationService),
 * so a push that fails — no credentials, FCM down, phone offline — never
 * loses the notification: the vendor still sees it in the inbox.
 *
 * Credentials: FIREBASE_SERVICE_ACCOUNT_BASE64 holds the whole service
 * account JSON of the eventory-v2-notifications Firebase project, base64
 * encoded. Without it pushes are skipped (logged once) and nothing else
 * changes.
 */

// FCM's per-request limit for sendEachForMulticast.
const MAX_TOKENS_PER_SEND = 500;
const RETRY_DELAYS_MS = [1000, 4000];

// The token itself is dead — the app was uninstalled, its data cleared, or
// the token belongs to another Firebase project. Delete the row.
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/mismatched-credential",
]);

// invalid-argument also covers a bad payload, which fails for every token;
// only the token-specific wording means this token is garbage.
const isDeadToken = (error) =>
  DEAD_TOKEN_CODES.has(error?.code) ||
  (error?.code === "messaging/invalid-argument" && /registration token/i.test(error?.message || ""));

// FCM or APNs hiccups worth another try.
const TRANSIENT_CODES = new Set([
  "messaging/internal-error",
  "messaging/server-unavailable",
  "messaging/unavailable",
  "messaging/quota-exceeded",
  "messaging/message-rate-exceeded",
]);

let messaging; // undefined: not tried yet; null: unavailable
const getMessaging = () => {
  if (messaging !== undefined) return messaging;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!raw) {
    console.warn("[push] FIREBASE_SERVICE_ACCOUNT_BASE64 is not set — push notifications are off");
    return (messaging = null);
  }
  try {
    const serviceAccount = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, "vendor-push");
    return (messaging = app.messaging());
  } catch (error) {
    console.error("[push] could not start Firebase Admin — push notifications are off:", error.message);
    return (messaging = null);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The FCM message for one inbox row. Everything in `data` is a string, as
 * FCM requires. `vendorId` lets the app drop a push meant for a vendor who
 * is no longer the one signed in on this phone.
 */
const buildMessage = (notification) => ({
  notification: { title: notification.pushTitle, body: notification.pushBody },
  data: {
    notificationId: notification.notificationId,
    vendorId: notification.vendorId,
    type: notification.type,
    category: notification.category,
    targetKind: notification.target?.kind || "none",
    targetId: notification.target?.id ?? "",
  },
  android: {
    priority: "high",
    notification: { channelId: "eventory_alerts", tag: notification.notificationId },
  },
  apns: {
    payload: { aps: { sound: "default", "thread-id": notification.category } },
  },
});

/**
 * Sends one push for an inbox row to every phone the vendor is signed in
 * on. Never throws. Resolves to { sent, failed } counts.
 */
export async function pushToVendor(notification) {
  const result = { sent: 0, failed: 0 };
  try {
    const fcm = getMessaging();
    if (!fcm) return result;

    const devices = await VendorDevice.find({ vendorId: String(notification.vendorId) }).select("token").lean();
    let pending = devices.map((d) => d.token);
    if (!pending.length) return result;

    const message = buildMessage(notification);
    const dead = [];

    for (let attempt = 0; pending.length && attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
      const retry = [];
      for (let i = 0; i < pending.length; i += MAX_TOKENS_PER_SEND) {
        const tokens = pending.slice(i, i + MAX_TOKENS_PER_SEND);
        const batch = await fcm.sendEachForMulticast({ ...message, tokens });
        batch.responses.forEach((response, index) => {
          if (response.success) return void result.sent++;
          const code = response.error?.code;
          if (isDeadToken(response.error)) dead.push(tokens[index]);
          else if (TRANSIENT_CODES.has(code)) retry.push(tokens[index]);
          else {
            result.failed++;
            console.error(`[push] ${notification.notificationId} failed: ${code} ${response.error?.message}`);
          }
        });
      }
      pending = retry;
    }

    if (pending.length) {
      result.failed += pending.length;
      console.error(`[push] ${notification.notificationId}: ${pending.length} device(s) still failing after retries`);
    }
    if (dead.length) {
      result.failed += dead.length;
      await VendorDevice.deleteMany({ token: { $in: dead } });
    }
    return result;
  } catch (error) {
    console.error(`[push] ${notification?.notificationId} failed:`, error.message);
    return result;
  }
}

export default { pushToVendor };
