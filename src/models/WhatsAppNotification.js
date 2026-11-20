import mongoose from "mongoose";

/**
 * One customer WhatsApp message (Interakt template), from the moment we
 * decide to send it until Interakt reports it read or failed.
 *
 * Written only by services/customerWhatsAppService.js. The row is created
 * BEFORE the API call, keyed by `dedupeKey` (unique): a webhook retry, the
 * Cashfree webhook and status poll racing, a restart, or a second backend
 * instance all collapse onto one row, so one business event is one message.
 * A customer who isn't eligible (no consent, feature off, no template) gets
 * no row at all, so a later legitimate send isn't blocked by the key.
 *
 * Status moves forward only (see STATUS_RANK): webhooks can arrive out of
 * order or twice, and a late "sent" must not undo "read".
 */
export const WHATSAPP_STATUSES = [
  "sending", // claimed; the API call is in flight
  "retry_scheduled", // a retryable error; the scheduler tries again at nextAttemptAt
  "submitted", // Interakt accepted it and returned a message id
  "sent",
  "delivered",
  "read",
  "failed", // permanent — not retried
  "unknown", // the call may or may not have gone through (timeout, crash); never retried, a webhook can still settle it
  "dry_run", // WHATSAPP_DRY_RUN: recorded, never sent
];

// Higher rank wins. failed sits below delivered: a "failed" after a
// "delivered" for the same message is noise, not news.
export const STATUS_RANK = {
  sending: 0,
  retry_scheduled: 0,
  unknown: 1,
  submitted: 2,
  sent: 3,
  failed: 4,
  delivered: 5,
  read: 6,
  dry_run: 7,
};

const WebhookEventSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    receivedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const WhatsAppNotificationSchema = new mongoose.Schema(
  {
    // Customer._id (as bookings store it) and the public "CUS…" id.
    customerId: { type: String, required: true, index: true },
    customerPublicId: { type: String, default: null },

    // Catalogue key — constants/customerWhatsAppTypes.js.
    type: { type: String, required: true },
    // One business event = one key, e.g. "bookingCancelled:EVT…:<ms>".
    dedupeKey: { type: String, required: true },

    bookingId: { type: String, default: null }, // public "EVT…"
    enquiryId: { type: String, default: null }, // public "ENQ…"
    paymentId: { type: String, default: null }, // Payment._id
    milestoneId: { type: String, default: null },

    recipient: { type: String, required: true }, // E.164
    templateName: { type: String, required: true },
    languageCode: { type: String, required: true },
    // How many {{n}} values were sent. The values themselves carry personal
    // data: they are held only while a retry is pending (the scheduler needs
    // them to resend) and unset once the message settles.
    variableCount: { type: Number, default: 0 },
    pendingBodyValues: { type: [String], default: undefined, select: false },

    status: { type: String, enum: WHATSAPP_STATUSES, default: "sending", index: true },
    interaktMessageId: { type: String, default: undefined },
    failureReason: { type: String, default: null },
    failureCode: { type: String, default: null },

    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: null },
    // Past this, a message is stale (a "tomorrow" reminder sent the day
    // after) and is not retried.
    expiresAt: { type: Date, default: null },

    submittedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },

    webhookEvents: { type: [WebhookEventSchema], default: [] },
  },
  { timestamps: true, collection: "customer_whatsapp_notifications" }
);

WhatsAppNotificationSchema.index({ dedupeKey: 1 }, { unique: true });
WhatsAppNotificationSchema.index(
  { interaktMessageId: 1 },
  { unique: true, partialFilterExpression: { interaktMessageId: { $type: "string" } } }
);
WhatsAppNotificationSchema.index({ status: 1, nextAttemptAt: 1 });
WhatsAppNotificationSchema.index({ bookingId: 1, type: 1, createdAt: -1 });

export default mongoose.model("WhatsAppNotification", WhatsAppNotificationSchema);
