import crypto from "crypto";
import mongoose from "mongoose";
import WhatsAppNotification, { STATUS_RANK } from "../models/WhatsAppNotification.js";
import { whatsappConfig } from "../config/whatsapp.js";
import { log } from "../services/customerWhatsAppService.js";

/**
 * Interakt message-status webhook — POST /api/webhooks/interakt.
 *
 * Contract (Interakt docs, "Message Webhook Format"):
 *  - Header `Interakt-Signature: sha256=<hex HMAC-SHA256 of the raw body>`,
 *    keyed with the secret entered in Interakt → Developer Settings →
 *    Webhooks. We hold the same secret in INTERAKT_WEBHOOK_SECRET and check
 *    it against req.rawBody (captured in app.js) before reading anything.
 *  - Body: { version, timestamp, type, data: { customer, message } } where
 *    type is message_api_sent | _delivered | _read | _failed for template
 *    messages sent through the API, and message.id is the id the send API
 *    returned. message.meta_data.source_data.callback_data echoes our
 *    callbackData (the log row's _id) — the fallback match.
 *  - Interakt does NOT retry, expects a 200 within 3 seconds, and disables
 *    the webhook after 5 failures in 10 minutes. So anything authentic gets
 *    a 200 — including event types we don't track — and only a bad or
 *    missing signature is refused.
 *
 * Updates only move a message forward (STATUS_RANK), so duplicate or
 * out-of-order events are harmless.
 */

const STATUS_BY_TYPE = {
  message_api_sent: "sent",
  message_api_delivered: "delivered",
  message_api_read: "read",
  message_api_failed: "failed",
};

/** Constant-time check of the Interakt-Signature header. */
export function verifyInteraktSignature(rawBody, header, secret) {
  if (!rawBody || !header || !secret) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header).trim());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Interakt sends "2022-06-03T05:43:33.133000" — UTC, no offset.
export const parseUtc = (value) => {
  if (!value || typeof value !== "string") return null;
  const text = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** The parts of a webhook we act on, or null for anything else. */
export function parseInteraktEvent(body) {
  const status = STATUS_BY_TYPE[body?.type];
  const message = body?.data?.message;
  if (!status || !message || typeof message !== "object") return null;
  const messageId = message.id ? String(message.id) : null;
  const callbackData = message.meta_data?.source_data?.callback_data ?? null;
  if (!messageId && !callbackData) return null;
  const eventAt = parseUtc(body.timestamp) || new Date();
  return {
    type: body.type,
    status,
    messageId,
    callbackData: callbackData ? String(callbackData) : null,
    sentAt: status === "sent" ? parseUtc(message.received_at_utc) || eventAt : null,
    deliveredAt: parseUtc(message.delivered_at_utc) || (status === "delivered" ? eventAt : null),
    readAt: parseUtc(message.seen_at_utc) || (status === "read" ? eventAt : null),
    failedAt: status === "failed" ? eventAt : null,
    failureReason: status === "failed" ? String(message.channel_failure_reason || "Failed").slice(0, 300) : null,
    failureCode: status === "failed" && message.channel_error_code != null ? String(message.channel_error_code) : null,
  };
}

export const mongoWebhookStore = {
  async findRow({ messageId, callbackData }) {
    if (messageId) {
      const byMessage = await WhatsAppNotification.findOne({ interaktMessageId: messageId }).select("_id status interaktMessageId").lean();
      if (byMessage) return byMessage;
    }
    if (callbackData && mongoose.Types.ObjectId.isValid(callbackData)) {
      const byId = await WhatsAppNotification.findById(callbackData).select("_id status interaktMessageId").lean();
      // Never re-point a row that already belongs to another message.
      if (byId && (!byId.interaktMessageId || !messageId || byId.interaktMessageId === messageId)) return byId;
    }
    return null;
  },
  /** Fills timestamps that are still empty; never overwrites one. */
  async fillTimestamps(id, event) {
    const fill = {};
    for (const field of ["sentAt", "deliveredAt", "readAt", "failedAt"]) {
      if (event[field]) fill[field] = { $ifNull: [`$${field}`, { $literal: event[field] }] };
    }
    if (event.messageId) fill.interaktMessageId = { $ifNull: ["$interaktMessageId", { $literal: event.messageId }] };
    if (Object.keys(fill).length) await WhatsAppNotification.updateOne({ _id: id }, [{ $set: fill }]);
  },
  /** Moves status forward; false when the row is already at or past it. */
  async advanceStatus(id, event) {
    const rank = STATUS_RANK[event.status];
    const lower = Object.keys(STATUS_RANK).filter((s) => STATUS_RANK[s] < rank && s !== "dry_run");
    const set = { status: event.status };
    if (event.status === "failed") {
      set.failureReason = event.failureReason;
      set.failureCode = event.failureCode;
    }
    const result = await WhatsAppNotification.updateOne(
      { _id: id, status: { $in: lower } },
      {
        $set: set,
        $unset: { pendingBodyValues: 1 },
        $push: { webhookEvents: { $each: [{ type: event.type, receivedAt: new Date() }], $slice: -20 } },
      }
    );
    return result.modifiedCount > 0;
  },
};

export function createInteraktWebhookHandler({ getConfig = whatsappConfig, store = mongoWebhookStore } = {}) {
  let warnedNoSecret = false;

  return async function handleInteraktWebhook(req, res) {
    const config = getConfig();
    if (!config.webhookSecret) {
      if (!warnedNoSecret) {
        warnedNoSecret = true;
        log("error", "webhook_secret_missing", { hint: "set INTERAKT_WEBHOOK_SECRET to accept Interakt webhooks" });
      }
      return res.status(503).json({ success: false, message: "Webhook not configured" });
    }

    const rawBody = req.rawBody ? req.rawBody.toString("utf8") : null;
    if (!verifyInteraktSignature(rawBody, req.headers["interakt-signature"], config.webhookSecret)) {
      log("warn", "webhook_bad_signature", { ip: req.ip });
      return res.status(401).json({ success: false, message: "Invalid signature" });
    }

    try {
      const event = parseInteraktEvent(req.body);
      if (!event) return res.status(200).json({ success: true, message: "Ignored" });

      const row = await store.findRow(event);
      if (!row) {
        // Not one of ours (a campaign, a dashboard send, or another system).
        log("info", "webhook_unmatched", { type: event.type, interaktMessageId: event.messageId });
        return res.status(200).json({ success: true, message: "Unknown message" });
      }

      await store.fillTimestamps(row._id, event);
      const advanced = await store.advanceStatus(row._id, event);
      log("info", advanced ? "webhook_status" : "webhook_duplicate", {
        notificationId: String(row._id),
        status: event.status,
        ...(event.failureCode ? { failureCode: event.failureCode } : {}),
      });
      return res.status(200).json({ success: true });
    } catch (error) {
      // Still 200: Interakt never retries, and failures would get the
      // webhook disabled. The error is logged for follow-up.
      log("error", "webhook_failed", { message: error?.message });
      return res.status(200).json({ success: false, message: "Processing failed" });
    }
  };
}

export const handleInteraktWebhook = createInteraktWebhookHandler();

export default handleInteraktWebhook;
