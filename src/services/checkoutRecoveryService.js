import mongoose from "mongoose";
import CheckoutRecovery from "../models/CheckoutRecovery.js";
import CheckoutSession from "../models/CheckoutSession.js";
import Payment from "../models/Payment.js";
import Package from "../models/Package.js";
import CartItem from "../models/CartItem.js";
import cashfree from "../config/cashfree.js";
import { checkoutRecoveryConfig } from "../config/checkoutRecovery.js";
import { computeAvailability } from "../utils/packageAvailability.js";
import { packageCoverImage } from "../utils/packageCoverImage.js";
import { visibleVendorIdClause } from "../utils/customerVisibility.js";
import {
  assessItems,
  invalidationReason,
  paymentState,
  promptGate,
  snapshotFromSession,
  transitionForSessionStatus,
} from "./checkoutRecoveryPolicy.js";

/**
 * Abandoned-checkout recovery — lifecycle and prompt serving.
 *
 * Authority boundaries:
 *   - Never writes Payment, Booking or CheckoutSession state. Payment and
 *     booking completion stay owned by customerPaymentController.js /
 *     bookingCreationService.js; this service only reacts to them.
 *   - A recovery becomes Converted only when its session is set Completed
 *     server-side, or a Payment row for it is already PAID.
 *   - Every read is scoped by the authenticated customer's _id, so one
 *     customer can never see or act on another's recovery.
 *
 * Rules live in checkoutRecoveryPolicy.js (pure, unit-tested).
 */

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id));

// A checkout started within this long after a "Continue Booking" click is
// treated as resumed from the prompt (attribution only).
const RESUME_ATTRIBUTION_WINDOW_MS = 30 * 60 * 1000;

const promptDriven = (recovery) => (recovery.ctaClicks?.count || 0) > 0 || Boolean(recovery.resumedFrom);

async function closeRecovery(recovery, status, reason, extra = {}) {
  await CheckoutRecovery.updateOne(
    { _id: recovery._id, status: "Open" },
    { $set: { status, statusReason: reason, statusChangedAt: new Date(), ...extra } }
  );
}

// ---------------------------------------------------------------------------
// Lifecycle — called from CheckoutSession's post-save hook
// ---------------------------------------------------------------------------

/**
 * Keeps the recovery record in step with its checkout session. Idempotent:
 * safe to run on every save, in any order, more than once.
 */
export async function syncFromCheckoutSession(session) {
  if (!session?._id || !session.customerId) return;
  const action = transitionForSessionStatus(session.status);
  const checkoutSessionId = String(session._id);
  const now = new Date();

  if (action === "convert") {
    const recovery = await CheckoutRecovery.findOne({ checkoutSessionId });
    if (!recovery || recovery.status === "Converted") return;
    // A conversion is recorded whatever state the prompt was in (even
    // Superseded/Retired) — it's the attribution record.
    recovery.status = "Converted";
    recovery.statusReason = "checkout_completed";
    recovery.statusChangedAt = now;
    recovery.convertedAt = now;
    recovery.convertedAfterPrompt = promptDriven(recovery);
    await recovery.save();
    return;
  }

  if (action === "invalidate") {
    await CheckoutRecovery.updateOne(
      { checkoutSessionId, status: "Open" },
      { $set: { status: "Invalidated", statusReason: "checkout_cancelled", statusChangedAt: now } }
    );
    return;
  }

  if (action !== "track") return;
  const config = checkoutRecoveryConfig();
  if (!config.enabled) return; // don't collect anything while the feature is off

  const lastActivityAt = session.updatedAt ? new Date(session.updatedAt) : now;
  const fields = {
    source: session.source,
    sourceCartId: session.sourceCartId != null ? String(session.sourceCartId) : null,
    items: snapshotFromSession(session),
    lastActivityAt,
    purgeAt: new Date(lastActivityAt.getTime() + config.retentionMs),
  };

  const refreshed = await CheckoutRecovery.updateOne({ checkoutSessionId, status: "Open" }, { $set: fields });
  if (refreshed.matchedCount > 0) return;
  // A closed record is never reopened by a later save.
  if (await CheckoutRecovery.exists({ checkoutSessionId })) return;

  const customerId = String(session.customerId);

  // Checkout reopened from the prompt ("Continue Booking" builds a fresh
  // session): link it so a later conversion is still attributed to the prompt.
  const resumedFromRecord = await CheckoutRecovery.findOne({
    customerId,
    "ctaClicks.lastClickedAt": { $gte: new Date(now.getTime() - RESUME_ATTRIBUTION_WINDOW_MS) },
  })
    .sort({ "ctaClicks.lastClickedAt": -1 })
    .select("_id")
    .lean();

  try {
    await CheckoutRecovery.create({
      customerId,
      checkoutSessionId,
      campaign: "abandoned_checkout",
      status: "Open",
      resumedFrom: resumedFromRecord ? String(resumedFromRecord._id) : null,
      ...fields,
    });
  } catch (err) {
    if (err?.code === 11000) return; // a concurrent save created it first
    throw err;
  }

  await supersedeAllButNewest(customerId, now);
}

/**
 * Only the newest checkout attempt can be prompted — older open ones
 * describe a cart state the customer has since moved on from. Picks the
 * newest by (lastActivityAt, _id) among ALL open records, so concurrent
 * creates (two tabs, a double-mounted page) converge on exactly one: every
 * pass agrees on which is newest, and the last pass sees every record.
 * Returns the surviving record, or null.
 */
async function supersedeAllButNewest(customerId, now) {
  const newest = await CheckoutRecovery.findOne({ customerId, status: "Open" }).sort({ lastActivityAt: -1, _id: -1 });
  if (!newest) return null;
  await CheckoutRecovery.updateMany(
    { customerId, status: "Open", _id: { $ne: newest._id } },
    { $set: { status: "Superseded", statusReason: "newer_checkout", statusChangedAt: now } }
  );
  return newest;
}

// ---------------------------------------------------------------------------
// Evaluation — gathers live facts, applies the policy
// ---------------------------------------------------------------------------

// Read-only order lookup. Any failure is "unknown", which the policy treats
// as uncertain (no prompt).
async function gatewayOrderStatus(cfOrderId) {
  try {
    const response = await cashfree.PGFetchOrder(cfOrderId);
    return response?.data?.order_status || "unknown";
  } catch (err) {
    console.warn(`[checkoutRecovery] gateway lookup failed for ${cfOrderId}:`, err.message);
    return "unknown";
  }
}

async function loadLivePackages(items) {
  const ids = [...new Set(items.map((i) => String(i.packageId)).filter(isObjectId))];
  if (!ids.length) return new Map();
  const packages = await Package.find({ _id: { $in: ids }, packageStatus: "Live", ...(await visibleVendorIdClause()) })
    .select(
      "vendorId vendorType packageStatus step1_eventAndCrew.packageName step1_eventAndCrew.capacity step4_sampleMedia availabilityCalendar availabilitySettings bookingCapacity"
    )
    .lean();
  return new Map(packages.map((p) => [String(p._id), p]));
}

async function loadCartItemIds(recovery) {
  if (recovery.source !== "cart") return null;
  const ids = recovery.items.map((i) => i.sourceCartItemId).filter((id) => id && isObjectId(id));
  if (!recovery.sourceCartId || !ids.length) return new Set();
  const rows = await CartItem.find({ _id: { $in: ids }, cartId: recovery.sourceCartId }).select("_id").lean();
  return new Set(rows.map((r) => String(r._id)));
}

async function loadAvailability(items, livePackages) {
  const result = new Map();
  await Promise.all(
    items.map(async (item) => {
      const pkg = livePackages.get(String(item.packageId));
      if (!pkg || !item.eventDetails?.date) return;
      try {
        const availability = await computeAvailability(pkg, {
          date: item.eventDetails.date,
          guests: item.eventDetails.guestCount ?? undefined,
          timeSlot: item.eventDetails.timeSlot ?? undefined,
        });
        result.set(String(item.packageId), availability?.overall ?? null);
      } catch {
        result.set(String(item.packageId), null);
      }
    })
  );
  return result;
}

/**
 * Decides whether `recovery` may be acted on right now, closing it when
 * the facts say it never can be again. `forResume` skips the timing and
 * frequency gates (the customer clicked — only correctness checks apply).
 */
async function evaluate(recovery, { now, config, forResume = false }) {
  if (recovery.status !== "Open") return { ok: false, reason: `status_${recovery.status}` };

  const session = await CheckoutSession.findOne({ _id: recovery.checkoutSessionId, customerId: recovery.customerId })
    .select("status expiresAt")
    .lean();
  if (session?.status === "Completed") {
    await closeRecovery(recovery, "Converted", "checkout_completed", {
      convertedAt: now,
      convertedAfterPrompt: promptDriven(recovery),
    });
    return { ok: false, reason: "converted" };
  }
  if (session?.status === "Cancelled") {
    await closeRecovery(recovery, "Invalidated", "checkout_cancelled");
    return { ok: false, reason: "cancelled" };
  }

  const payments = await Payment.find({ checkoutSessionId: String(recovery.checkoutSessionId), customerId: recovery.customerId })
    .select("status createdAt cfOrderId")
    .sort({ createdAt: -1 })
    .lean();
  const latestPaymentAt = payments[0]?.createdAt ? new Date(payments[0].createdAt) : null;
  const activityAt =
    latestPaymentAt && latestPaymentAt > new Date(recovery.lastActivityAt) ? latestPaymentAt : new Date(recovery.lastActivityAt);

  if (forResume) {
    if (now.getTime() - activityAt.getTime() > config.maxAgeMs) {
      await closeRecovery(recovery, "Retired", "too_old");
      return { ok: false, reason: "too_old" };
    }
  } else {
    const gate = promptGate(recovery, { activityAt, now, config });
    if (!gate.ok) {
      if (gate.retire) await closeRecovery(recovery, "Retired", gate.reason);
      return { ok: false, reason: gate.reason };
    }
  }

  // Payment correctness before anything else is looked at.
  if (payments.some((p) => p.status === "PAID")) {
    await closeRecovery(recovery, "Converted", "payment_confirmed", {
      convertedAt: now,
      convertedAfterPrompt: promptDriven(recovery),
    });
    return { ok: false, reason: "converted" };
  }
  const pending = payments.find((p) => p.status === "PENDING");
  // An attempt made inside the inactivity window may still be in flight —
  // never resume over it, even on an explicit click.
  if (pending && forResume && now.getTime() - new Date(pending.createdAt).getTime() < config.inactivityMs) {
    return { ok: false, reason: "payment_pending" };
  }
  const gatewayStatus = pending ? await gatewayOrderStatus(pending.cfOrderId) : null;
  const payState = paymentState(payments, gatewayStatus);
  if (payState === "paid" || payState === "uncertain") return { ok: false, reason: "payment_pending" };

  // Plain object: the policy spreads items, which doesn't copy a hydrated
  // subdocument's fields.
  const plain = typeof recovery.toObject === "function" ? recovery.toObject() : recovery;
  const livePackages = await loadLivePackages(plain.items);
  const cartItemIds = await loadCartItemIds(plain);
  const availability = await loadAvailability(plain.items, livePackages);
  const { valid, invalid } = assessItems(plain, { livePackages, cartItemIds, availability, now });
  if (!valid.length) {
    await closeRecovery(recovery, "Invalidated", invalidationReason(invalid));
    return { ok: false, reason: "items_unavailable" };
  }

  return { ok: true, session, paymentState: payState, valid, invalid, livePackages };
}

function toPromptPayload(recovery, evaluation) {
  return {
    id: String(recovery._id),
    campaign: recovery.campaign,
    lastActivityAt: recovery.lastActivityAt,
    // "failed" lets the UI say a previous payment didn't go through.
    paymentState: evaluation.paymentState,
    items: evaluation.valid.map((item) => {
      const live = evaluation.livePackages.get(String(item.packageId));
      return {
        packageId: item.packageId,
        name: live?.step1_eventAndCrew?.packageName || item.name,
        image: (live && packageCoverImage(live)) || item.image,
        vendorType: live?.vendorType || item.vendorType,
        eventType: item.eventDetails?.eventType ?? null,
        date: item.eventDetails?.date ?? null,
        timeSlot: item.eventDetails?.timeSlot ?? null,
        guestCount: item.eventDetails?.guestCount ?? null,
        location: item.eventDetails?.location ?? null,
        quantity: item.quantity,
        // false = the vendor no longer shows this date as available.
        dateAvailable: item.dateAvailable,
      };
    }),
    unavailableItemCount: evaluation.invalid.length,
  };
}

// ---------------------------------------------------------------------------
// Customer-facing operations
// ---------------------------------------------------------------------------

/** The one prompt (if any) to show this customer now. */
export async function getPromptForCustomer(customerId, { now = new Date() } = {}) {
  const config = checkoutRecoveryConfig();
  if (!config.enabled) return null;

  const latest = await supersedeAllButNewest(String(customerId), now);
  if (!latest) return null;

  const evaluation = await evaluate(latest, { now, config });
  return evaluation.ok ? toPromptPayload(latest, evaluation) : null;
}

async function findOwned(customerId, recoveryId) {
  if (!isObjectId(recoveryId)) return null;
  return CheckoutRecovery.findOne({ _id: recoveryId, customerId: String(customerId) });
}

/** The prompt was actually rendered. Counted at most once per cooldown window. */
export async function recordImpression(customerId, recoveryId, { now = new Date() } = {}) {
  const recovery = await findOwned(customerId, recoveryId);
  if (!recovery) return { error: { status: 404, message: "Recovery not found" } };
  if (recovery.status !== "Open") return { ok: true };

  const config = checkoutRecoveryConfig();
  // Guarded so two tabs (or a retry) can't count the same showing twice.
  const cutoff = new Date(now.getTime() - config.impressionCooldownMs);
  await CheckoutRecovery.updateOne(
    {
      _id: recovery._id,
      status: "Open",
      $or: [{ "impressions.lastShownAt": null }, { "impressions.lastShownAt": { $lte: cutoff } }],
    },
    { $inc: { "impressions.count": 1 }, $set: { "impressions.lastShownAt": now } }
  );
  return { ok: true };
}

/** "Not now" / close. Retires the prompt once the dismissal cap is reached. */
export async function dismiss(customerId, recoveryId, { now = new Date() } = {}) {
  const recovery = await findOwned(customerId, recoveryId);
  if (!recovery) return { error: { status: 404, message: "Recovery not found" } };
  if (recovery.status !== "Open") return { ok: true };

  const config = checkoutRecoveryConfig();
  const updated = await CheckoutRecovery.findOneAndUpdate(
    { _id: recovery._id, status: "Open" },
    { $inc: { "dismissals.count": 1 }, $set: { "dismissals.lastDismissedAt": now } },
    { returnDocument: "after" }
  );
  if (updated && updated.dismissals.count >= config.maxDismissals) {
    await closeRecovery(updated, "Retired", "dismissed_max");
  }
  return { ok: true };
}

/**
 * "Continue Booking". Re-validates everything, then says where to go:
 *   { action: "checkout", checkoutSessionId }  — the original session is still live
 *   { action: "checkout", checkoutSessionId: null } — cart selection restored;
 *        the checkout page builds a fresh session, re-locking price and
 *        re-checking availability
 *   { action: "package", packageId } — direct "Book Now" checkout; restart from the package page
 * Never reuses a stored price.
 */
export async function resume(customerId, recoveryId, { now = new Date() } = {}) {
  const recovery = await findOwned(customerId, recoveryId);
  if (!recovery) return { error: { status: 404, message: "Recovery not found" } };

  const config = checkoutRecoveryConfig();
  const evaluation = await evaluate(recovery, { now, config, forResume: true });
  if (!evaluation.ok) {
    if (evaluation.reason === "payment_pending") {
      return {
        error: {
          status: 409,
          code: "PAYMENT_PENDING",
          message: "A payment for this booking is still being confirmed. Check My Bookings in a few minutes.",
        },
      };
    }
    if (evaluation.reason === "converted") {
      return { error: { status: 409, code: "ALREADY_BOOKED", message: "This booking is already complete. You'll find it in My Bookings." } };
    }
    return { error: { status: 410, code: "RECOVERY_UNAVAILABLE", message: "This booking can no longer be continued." } };
  }

  await CheckoutRecovery.updateOne(
    { _id: recovery._id },
    { $inc: { "ctaClicks.count": 1 }, $set: { "ctaClicks.lastClickedAt": now } }
  );

  const { session, valid } = evaluation;
  if (session?.status === "Active" && new Date(session.expiresAt) > now) {
    return { ok: true, action: "checkout", checkoutSessionId: String(recovery.checkoutSessionId), unavailableItemCount: evaluation.invalid.length };
  }

  if (recovery.source === "cart") {
    // Restore the selection the customer was checking out with — only items
    // still valid. Other cart items stay in the cart, just unselected.
    const keepIds = valid.map((i) => i.sourceCartItemId).filter(Boolean);
    await CartItem.updateMany({ cartId: recovery.sourceCartId, _id: { $in: keepIds } }, { $set: { selectedForCheckout: true } });
    await CartItem.updateMany({ cartId: recovery.sourceCartId, _id: { $nin: keepIds } }, { $set: { selectedForCheckout: false } });
    return { ok: true, action: "checkout", checkoutSessionId: null, unavailableItemCount: evaluation.invalid.length };
  }

  return { ok: true, action: "package", packageId: valid[0].packageId, unavailableItemCount: evaluation.invalid.length };
}
