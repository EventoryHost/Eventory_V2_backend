/**
 * Abandoned-checkout recovery — the pure decision rules, with no database
 * or network access, so every rule is unit-testable on its own
 * (test/checkoutRecovery/policy.test.mjs). services/checkoutRecoveryService.js
 * gathers the facts and applies these.
 *
 * Ordering principle: booking and payment correctness win over showing a
 * prompt. Whenever a fact is missing or uncertain, the answer is "don't show".
 */

/** What a CheckoutSession status change means for its recovery record. */
export function transitionForSessionStatus(status) {
  switch (status) {
    case "Active":
      return "track"; // create, or refresh the snapshot + activity time
    case "Completed":
      return "convert"; // set server-side only, after payment was verified
    case "Cancelled":
      return "invalidate"; // the customer backed out or edited the cart
    default:
      return "none"; // Expired is the normal abandonment case — keep the record Open
  }
}

/** The display/resume snapshot kept from a session — no contact or payment data. */
export function snapshotFromSession(session) {
  return (session.lines || []).map((line) => ({
    packageId: String(line.packageId),
    vendorId: line.vendorId != null ? String(line.vendorId) : null,
    packageGroupId: line.packageGroupId != null ? String(line.packageGroupId) : null,
    sourceCartItemId: line.sourceCartItemId != null ? String(line.sourceCartItemId) : null,
    name: line.packageSnapshot?.name ?? null,
    image: line.packageSnapshot?.image ?? null,
    vendorType: line.packageSnapshot?.vendorType ?? null,
    eventDetails: {
      eventType: line.eventDetails?.eventType ?? null,
      date: line.eventDetails?.date ?? null,
      timeSlot: line.eventDetails?.timeSlot ?? null,
      guestCount: line.eventDetails?.guestCount ?? null,
      location: line.eventDetails?.location ?? null,
    },
    quantity: line.quantity || 1,
  }));
}

/**
 * Timing and frequency gates — cheap checks run before any lookups.
 * `activityAt` is the later of the session's last edit and the latest
 * payment attempt, so a payment still in flight never counts as abandoned.
 *
 * Returns { ok: true } or { ok: false, reason, retire? }. `retire` means the
 * prompt has hit a lifetime cap and should never be considered again.
 */
export function promptGate(recovery, { activityAt, now, config }) {
  if (!config.enabled) return { ok: false, reason: "disabled" };
  if (recovery.status !== "Open") return { ok: false, reason: `status_${recovery.status}` };

  const t = now.getTime();
  const activity = new Date(activityAt ?? recovery.lastActivityAt).getTime();
  if (!Number.isFinite(activity)) return { ok: false, reason: "no_activity_time" };
  if (t - activity < config.inactivityMs) return { ok: false, reason: "too_recent" };
  if (t - activity > config.maxAgeMs) return { ok: false, reason: "too_old", retire: true };

  return frequencyGate(recovery, { now, config });
}

/**
 * Dismissal and impression caps for one prompt record — shared by checkout
 * recovery and the browsing campaigns (retargetingPolicy.js) so every
 * campaign type is throttled by the same rules. `config` needs
 * maxDismissals, dismissCooldownMs, maxImpressions, impressionCooldownMs.
 */
export function frequencyGate(record, { now, config }) {
  const t = now.getTime();
  const dismissals = record.dismissals || {};
  if ((dismissals.count || 0) >= config.maxDismissals) return { ok: false, reason: "dismissed_max", retire: true };
  if (dismissals.lastDismissedAt && t - new Date(dismissals.lastDismissedAt).getTime() < config.dismissCooldownMs) {
    return { ok: false, reason: "dismiss_cooldown" };
  }

  const impressions = record.impressions || {};
  if ((impressions.count || 0) >= config.maxImpressions) return { ok: false, reason: "impressions_max", retire: true };
  if (impressions.lastShownAt && t - new Date(impressions.lastShownAt).getTime() < config.impressionCooldownMs) {
    return { ok: false, reason: "impression_cooldown" };
  }

  return { ok: true };
}

/**
 * Payment state for the session, from its Payment rows plus — only for a
 * PENDING one — the live gateway order status (read-only; recovery never
 * writes Payment). `gatewayStatus` is Cashfree's order_status, or "unknown"
 * when the lookup failed.
 *
 *   "paid"      → never prompt; the payment flow will (or did) finalise it
 *   "uncertain" → never prompt; we can't tell, so we stay out of the way
 *   "failed"    → prompt; a previous attempt didn't go through
 *   "none"      → prompt; no payment was ever started
 */
export function paymentState(payments, gatewayStatus) {
  const list = payments || [];
  if (list.some((p) => p.status === "PAID")) return "paid";
  const pending = list.find((p) => p.status === "PENDING");
  if (pending) {
    if (gatewayStatus === "PAID") return "paid";
    // ACTIVE = the order exists and nothing was paid on it. Paired with the
    // inactivity gate (measured from the payment's own createdAt), that's a
    // customer who closed the gateway page. Resuming is safe: the token
    // endpoint re-checks the order and reuses or replaces it.
    if (["ACTIVE", "EXPIRED", "TERMINATED"].includes(gatewayStatus)) return "failed";
    return "uncertain";
  }
  if (list.some((p) => ["FAILED", "EXPIRED", "CANCELLED"].includes(p.status))) return "failed";
  return "none";
}

/** An event date that has already passed (with a day of grace for timezones). */
export function isEventDatePast(date, now) {
  if (!date) return false;
  const d = new Date(date).getTime();
  return Number.isFinite(d) && d + 24 * 60 * 60 * 1000 <= now.getTime();
}

/**
 * Re-validates each snapshotted item against live facts. Prices are never
 * judged here — they are re-locked by a fresh checkout session on resume.
 *
 * facts:
 *   livePackages   Map<packageId, package>  — Live and from a visible vendor
 *   cartItemIds    Set<string> | null       — for source:"cart": the source
 *                                             cart items that still exist
 *   availability   Map<packageId, boolean|null> — date availability (false = unavailable)
 */
export function assessItems(recovery, { livePackages, cartItemIds, availability, now }) {
  const valid = [];
  const invalid = [];
  for (const item of recovery.items || []) {
    let reason = null;
    if (!livePackages.has(String(item.packageId))) reason = "package_unavailable";
    else if (isEventDatePast(item.eventDetails?.date, now)) reason = "event_date_passed";
    else if (recovery.source === "cart" && cartItemIds && (!item.sourceCartItemId || !cartItemIds.has(String(item.sourceCartItemId)))) {
      reason = "removed_from_cart";
    }

    if (reason) invalid.push({ ...item, reason });
    else valid.push({ ...item, dateAvailable: availability?.get(String(item.packageId)) ?? null });
  }
  return { valid, invalid };
}

/** Why a recovery with no usable items is closed, for statusReason. */
export function invalidationReason(invalid) {
  const reasons = new Set(invalid.map((i) => i.reason));
  if (reasons.size === 1) return [...reasons][0];
  return reasons.size ? "items_unavailable" : "no_items";
}
