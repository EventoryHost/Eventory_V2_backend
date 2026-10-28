import { eventStartOf } from "../models/Booking.js";

/**
 * What cancelling a booking costs, from its package's cancellation policy
 * (Package.step3_policiesAndCharges.cancellationPolicy). Vendors pick one
 * of three templates when they create the package (frontend
 * PolicyBottomSheet), or upload / write their own:
 *
 *   flexible — full refund until 7 days before the event, 50% after.
 *   standard — full refund until 30 days before, none within 14 days;
 *              in between the team decides (no amount promised).
 *   strict   — non-refundable: cancelling is allowed, nothing comes back.
 *   custom   — the vendor's own document/text: the team confirms the refund.
 *
 * The full-refund cut-off doubles as the free-change window (help panel
 * "Free changes until …"); strict/custom have none, so every change needs
 * the vendor's approval. Customers can cancel online until 11:59 PM IST
 * the day before the event. Refunds are on what was actually received.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function policyKindOf(policy) {
  const id = String(policy?.templateId || "").toLowerCase();
  if (id === "flexible" || id === "standard" || id === "strict") return id;
  return "custom";
}

/** 11:59 PM IST on the day before the event. */
export function selfCancelUntil(booking) {
  if (!booking?.eventDate) return null;
  const ist = new Date(new Date(booking.eventDate).getTime() + IST_OFFSET_MS);
  const dayStart = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS;
  return new Date(dayStart - 60 * 1000);
}

export function cancellationTerms(booking, policy, now = new Date()) {
  const kind = policyKindOf(policy);
  const start = eventStartOf(booking);
  const paid = booking.totalReceived || 0;
  const t = now.getTime();

  let freeUntil = null;
  let noRefundFrom = null;
  // null = the team decides.
  let refund = null;
  if (start) {
    const s = start.getTime();
    if (kind === "flexible") {
      freeUntil = new Date(s - 7 * DAY_MS);
      refund = t <= freeUntil.getTime() ? paid : Math.round(paid * 0.5);
    } else if (kind === "standard") {
      freeUntil = new Date(s - 30 * DAY_MS);
      noRefundFrom = new Date(s - 14 * DAY_MS);
      refund = t <= freeUntil.getTime() ? paid : t >= noRefundFrom.getTime() ? 0 : null;
    } else if (kind === "strict") {
      refund = 0;
    }
  }
  // Nothing paid, nothing to refund — whatever the policy.
  if (paid === 0) refund = 0;

  const cancelUntil = selfCancelUntil(booking);
  return {
    policy: kind,
    policyTitle: policy?.templateTitle || null,
    paid,
    refund,
    charges: refund == null ? null : paid - refund,
    teamDecides: refund == null,
    freeUntil,
    freeNow: Boolean(freeUntil && t <= freeUntil.getTime()),
    noRefundFrom,
    selfCancelUntil: cancelUntil,
    canSelfCancel: Boolean(cancelUntil && t <= cancelUntil.getTime()),
  };
}
