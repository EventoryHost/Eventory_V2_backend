import mongoose from "mongoose";
import Customer from "../models/Customer.js";
import WhatsAppNotification from "../models/WhatsAppNotification.js";
import { whatsappConfig } from "../config/whatsapp.js";
import { CUSTOMER_WHATSAPP_TYPES } from "../constants/customerWhatsAppTypes.js";
import { createInteraktClient } from "./interaktClient.js";
import { maskPhone, normalizePhone, splitE164 } from "../utils/phone.js";

/**
 * Sends one customer WhatsApp template through Interakt — the only place
 * that does. Business code calls the event helpers in
 * customerWhatsAppEvents.js, which call notify() here.
 *
 * notify() never throws and never rejects: a WhatsApp problem must not fail
 * the booking, payment or signup that caused it. Call it without awaiting.
 *
 * For each call:
 *  1. Feature on, credentials present, template configured for the type?
 *  2. Customer found, not deactivated, opted in (whatsappConsent.status
 *     "opted_in"), a verified phone
 *     that is the number consent was given for, valid E.164?
 *     Any "no" → logged and skipped, nothing written.
 *  3. Insert the log row with the event's dedupeKey (unique). Already there
 *     → this event was handled before; stop.
 *  4. Send, retrying retryable errors with exponential backoff; leftovers
 *     go to "retry_scheduled" for the scheduler (retryDue). Ambiguous
 *     errors (timeouts) are never retried — that could double-send.
 *
 * Logs are JSON lines without phone numbers, names, message values or keys.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const STALE_SENDING_MS = 15 * MINUTE;
const RETRY_BATCH = 50;
// WhatsApp rejects a parameter with newlines, tabs or 4+ spaces in a row.
const MAX_VALUE_LENGTH = 200;

export function log(level, event, fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, scope: "whatsapp", event, ...fields });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0] || null;

/** One template parameter, cleaned so WhatsApp accepts it. Never empty. */
export const cleanValue = (value) => {
  if (value === null || value === undefined) return "-";
  const text = String(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  if (!text) return "-";
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1)}…` : text;
};

/** The template's bodyValues, in the catalogue's order. */
export function buildBodyValues(type, vars = {}) {
  const def = CUSTOMER_WHATSAPP_TYPES[type];
  if (!def) throw new Error(`unknown WhatsApp notification type "${type}"`);
  return def.variables.map((name) => cleanValue(vars[name]));
}

/**
 * Whether this customer may get a WhatsApp message now. Returns
 * { ok: true, recipient } or { ok: false, reason }.
 */
export function checkEligibility(customer, config) {
  if (!customer) return { ok: false, reason: "no_customer_account" };
  if (customer.isDeactivated) return { ok: false, reason: "customer_deactivated" };
  const consent = customer.whatsappConsent;
  // The consent record decides, not preferences.notification.whatsapp: a
  // profile PATCH replaces `preferences` wholesale, so the toggle can be
  // reset by an unrelated change. Explicit toggles are synced into the
  // record (whatsappConsentService.syncConsentFromPreferences).
  if (consent?.status !== "opted_in" || !consent.optedInAt) return { ok: false, reason: "no_consent" };
  if (!customer.phone) return { ok: false, reason: "no_phone" };
  if (!customer.isPhoneVerified) return { ok: false, reason: "phone_not_verified" };
  // Consent was given for one number; a changed number needs it again.
  if (consent.phone && consent.phone !== customer.phone) return { ok: false, reason: "consent_for_other_number" };
  const recipient = splitE164(customer.phone, config.countryCodes);
  if (!recipient) return { ok: false, reason: "invalid_phone" };
  if (config.recipientAllowlist.length && !config.recipientAllowlist.includes(recipient.e164)) {
    return { ok: false, reason: "not_in_allowlist" };
  }
  return { ok: true, recipient };
}

export function createRateLimiter(perMinute, { sleep, nowMs = Date.now }) {
  let next = 0;
  return async function acquire() {
    const interval = MINUTE / perMinute;
    const t = nowMs();
    const slot = Math.max(t, next);
    next = slot + interval;
    if (slot > t) await sleep(slot - t);
  };
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** MongoDB-backed persistence. Tests pass their own `store`. */
export const mongoStore = {
  async findCustomer({ customerId, customerPublicId, phone }) {
    const fields = "_id id name phone isPhoneVerified isDeactivated preferences whatsappConsent";
    if (customerId && mongoose.Types.ObjectId.isValid(String(customerId))) {
      const byId = await Customer.findById(String(customerId)).select(fields).lean();
      if (byId) return byId;
    }
    if (customerPublicId) {
      const byPublicId = await Customer.findOne({ id: String(customerPublicId) }).select(fields).lean();
      if (byPublicId) return byPublicId;
    }
    const normalized = phone ? normalizePhone(String(phone)) : null;
    return normalized ? Customer.findOne({ phone: normalized }).select(fields).lean() : null;
  },
  /** The new row, or null when the dedupeKey already exists. */
  async insert(doc) {
    try {
      return (await WhatsAppNotification.create(doc)).toObject();
    } catch (error) {
      if (error?.code === 11000) return null;
      throw error;
    }
  },
  async update(id, set, unset) {
    const update = { $set: set };
    if (unset) update.$unset = unset;
    await WhatsAppNotification.updateOne({ _id: id }, update);
  },
  async existsRecent({ type, bookingId, since }) {
    return Boolean(
      await WhatsAppNotification.exists({
        type,
        bookingId,
        createdAt: { $gte: since },
        status: { $nin: ["failed", "unknown"] },
      })
    );
  },
  /** Atomically takes one due retry, so two instances never resend one row. */
  async claimRetry(now) {
    return WhatsAppNotification.findOneAndUpdate(
      { status: "retry_scheduled", nextAttemptAt: { $lte: now } },
      { $set: { status: "sending", nextAttemptAt: null } },
      { new: true, sort: { nextAttemptAt: 1 } }
    )
      .select("+pendingBodyValues")
      .lean();
  },
  async expireStaleSending(cutoff) {
    const result = await WhatsAppNotification.updateMany(
      { status: "sending", updatedAt: { $lt: cutoff } },
      {
        $set: { status: "unknown", failureReason: "Interrupted while sending — outcome unknown, not retried" },
        $unset: { pendingBodyValues: 1 },
      }
    );
    return result.modifiedCount || 0;
  },
};

export function createCustomerWhatsAppService({
  getConfig = whatsappConfig,
  store = mongoStore,
  client: injectedClient = null,
  sleep = realSleep,
  now = () => new Date(),
} = {}) {
  const warned = new Set();
  const warnOnce = (key, fields) => {
    if (warned.has(key)) return;
    warned.add(key);
    log("warn", "config_problem", fields);
  };

  let limiter = null;
  let limiterRate = null;
  const acquireSlot = (config) => {
    if (!limiter || limiterRate !== config.ratePerMinute) {
      limiter = createRateLimiter(config.ratePerMinute, { sleep, nowMs: () => now().getTime() });
      limiterRate = config.ratePerMinute;
    }
    return limiter();
  };

  const clientFor = (config) => injectedClient || createInteraktClient({ config });

  // Backoff before a scheduler retry: 2, 4, 8… minutes, capped at an hour.
  const laterRetryDelay = (attempts) => Math.min(HOUR, 2 ** Math.max(1, attempts) * MINUTE);

  /**
   * Sends [row] and records the outcome on it. row.attempts counts earlier
   * tries (a scheduler retry continues the count).
   */
  async function deliver(row, bodyValues, recipient, config) {
    const client = clientFor(config);
    let attempts = row.attempts || 0;
    const base = { notificationId: String(row._id), type: row.type, template: row.templateName };

    for (let inline = 1; ; inline++) {
      attempts++;
      await acquireSlot(config);
      try {
        const { messageId } = await client.sendTemplate({
          countryCode: recipient.countryCode,
          phoneNumber: recipient.phoneNumber,
          templateName: row.templateName,
          languageCode: row.languageCode,
          bodyValues,
          // Lets a webhook find this row even if we never saw the message id.
          callbackData: String(row._id),
        });
        await store.update(
          row._id,
          {
            status: "submitted",
            interaktMessageId: messageId,
            submittedAt: now(),
            attempts,
            failureReason: null,
            failureCode: null,
            nextAttemptAt: null,
          },
          { pendingBodyValues: 1 }
        );
        log("info", "submitted", { ...base, attempts, interaktMessageId: messageId });
        return { status: "submitted", messageId };
      } catch (error) {
        const reason = String(error?.message || error).slice(0, 300);
        const code = error?.code ? String(error.code) : null;
        const expired = row.expiresAt && now() >= new Date(row.expiresAt);
        const budgetLeft = attempts < config.maxAttemptsTotal && !expired;

        if (error?.retryable && budgetLeft && inline < config.maxAttemptsInline) {
          const delay = error.retryAfterMs ?? config.retryBaseDelayMs * 4 ** (inline - 1);
          log("warn", "retrying", { ...base, attempts, code, delayMs: delay });
          await sleep(delay);
          continue;
        }
        if (error?.retryable && budgetLeft) {
          const nextAttemptAt = new Date(now().getTime() + Math.max(error.retryAfterMs ?? 0, laterRetryDelay(attempts)));
          await store.update(row._id, {
            status: "retry_scheduled",
            attempts,
            nextAttemptAt,
            failureReason: reason,
            failureCode: code,
            pendingBodyValues: bodyValues,
          });
          log("warn", "retry_scheduled", { ...base, attempts, code, nextAttemptAt: nextAttemptAt.toISOString() });
          return { status: "retry_scheduled", reason };
        }

        const status = error?.ambiguous ? "unknown" : "failed";
        await store.update(
          row._id,
          {
            status,
            attempts,
            failureReason: error?.retryable ? `${reason} (gave up after ${attempts} attempts)` : reason,
            failureCode: code,
            failedAt: status === "failed" ? now() : null,
            nextAttemptAt: null,
          },
          { pendingBodyValues: 1 }
        );
        log(code === "AUTH" || code === "NO_CREDENTIALS" ? "error" : "warn", status, { ...base, attempts, code, reason });
        return { status, reason };
      }
    }
  }

  /**
   * @param {string} type  key of CUSTOMER_WHATSAPP_TYPES
   * @param {object} input
   *   customerId | customerPublicId | phone  who (first match wins)
   *   dedupeKey*        one business event = one key
   *   vars              template values by name (customerName defaults to the account's first name)
   *   refs              { bookingId, enquiryId, paymentId, milestoneId }
   *   expiresAt         don't send/retry after this
   *   throttleMinutes   skip if this type went to this booking that recently
   */
  async function notify(type, input = {}) {
    try {
      const def = CUSTOMER_WHATSAPP_TYPES[type];
      if (!def) {
        log("warn", "unknown_type", { type });
        return { status: "skipped", reason: "unknown_type" };
      }
      const config = getConfig();
      if (!config.enabledFlag) return { status: "skipped", reason: "disabled" };
      if (!config.enabled) {
        warnOnce("credentials", { problems: config.problems });
        return { status: "skipped", reason: "missing_credentials" };
      }
      const templateName = config.templates[type];
      if (!templateName) {
        warnOnce(`template:${type}`, { type, problem: "template name not configured" });
        return { status: "skipped", reason: "template_not_configured" };
      }
      if (!input.dedupeKey) {
        log("error", "missing_dedupe_key", { type });
        return { status: "skipped", reason: "missing_dedupe_key" };
      }
      const at = now();
      if (input.expiresAt && at >= new Date(input.expiresAt)) return { status: "skipped", reason: "expired" };

      const customer = await store.findCustomer({
        customerId: input.customerId,
        customerPublicId: input.customerPublicId,
        phone: input.phone,
      });
      const eligibility = checkEligibility(customer, config);
      if (!eligibility.ok) {
        log("info", "skipped", { type, reason: eligibility.reason, customerId: customer ? String(customer._id) : null });
        return { status: "skipped", reason: eligibility.reason };
      }

      const refs = input.refs || {};
      if (input.throttleMinutes && refs.bookingId) {
        const since = new Date(at.getTime() - input.throttleMinutes * MINUTE);
        if (await store.existsRecent({ type, bookingId: refs.bookingId, since })) {
          log("info", "skipped", { type, reason: "throttled", bookingId: refs.bookingId });
          return { status: "skipped", reason: "throttled" };
        }
      }

      const bodyValues = buildBodyValues(type, {
        ...input.vars,
        customerName: input.vars?.customerName || firstName(customer.name) || "there",
      });

      const row = await store.insert({
        customerId: String(customer._id),
        customerPublicId: customer.id ?? null,
        type,
        dedupeKey: input.dedupeKey,
        bookingId: refs.bookingId ?? null,
        enquiryId: refs.enquiryId ?? null,
        paymentId: refs.paymentId ? String(refs.paymentId) : null,
        milestoneId: refs.milestoneId ? String(refs.milestoneId) : null,
        recipient: eligibility.recipient.e164,
        templateName,
        languageCode: config.languageCode,
        variableCount: bodyValues.length,
        status: config.dryRun ? "dry_run" : "sending",
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : new Date(at.getTime() + def.ttlHours * HOUR),
      });
      if (!row) {
        log("info", "duplicate", { type, dedupeKey: input.dedupeKey });
        return { status: "duplicate" };
      }
      if (config.dryRun) {
        log("info", "dry_run", {
          notificationId: String(row._id),
          type,
          template: templateName,
          recipient: maskPhone(eligibility.recipient.e164),
        });
        return { status: "dry_run" };
      }
      return await deliver(row, bodyValues, eligibility.recipient, config);
    } catch (error) {
      log("error", "notify_failed", { type, message: error?.message });
      return { status: "error", reason: error?.message };
    }
  }

  /**
   * Scheduler pass: resends retry_scheduled rows that are due, and gives up
   * on rows left "sending" by a crashed process. Safe on many instances.
   */
  async function retryDue() {
    const config = getConfig();
    if (!config.enabled) return 0;
    const at = now();
    await store.expireStaleSending(new Date(at.getTime() - STALE_SENDING_MS));

    let processed = 0;
    for (; processed < RETRY_BATCH; processed++) {
      const row = await store.claimRetry(at);
      if (!row) break;
      const fail = (reason) =>
        store.update(row._id, { status: "failed", failureReason: reason, failedAt: now() }, { pendingBodyValues: 1 });

      if (row.expiresAt && at >= new Date(row.expiresAt)) {
        await fail("Expired before it could be sent");
        continue;
      }
      // Consent or the number may have changed since the first try.
      const customer = await store.findCustomer({ customerId: row.customerId });
      const eligibility = checkEligibility(customer, config);
      if (!eligibility.ok || eligibility.recipient.e164 !== row.recipient) {
        await fail(`No longer eligible: ${eligibility.ok ? "phone changed" : eligibility.reason}`);
        continue;
      }
      if (!row.pendingBodyValues?.length && row.variableCount) {
        await fail("Message values missing — cannot resend");
        continue;
      }
      await deliver(row, row.pendingBodyValues || [], eligibility.recipient, config);
    }
    return processed;
  }

  return { notify, retryDue };
}

const service = createCustomerWhatsAppService();

export const notifyCustomerWhatsApp = service.notify;
export const retryDueWhatsApp = service.retryDue;

export default service;
