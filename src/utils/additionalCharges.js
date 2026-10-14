import { buildPricingBreakdown } from "./pricingBreakdown.js";

/**
 * Last-moment additional charges (added 2026-10-13).
 *
 * The vendor or an admin sets `pricing.additionalCharges` — one cumulative
 * figure, like every other pricing row — and the customer sees it as its own
 * breakdown row under `pricing.additionalChargesLabel`. The money is always
 * collected with the final payment: changing the charges moves the final
 * unpaid milestone by the same amount, tax included, so the plan keeps adding
 * up to the booking total.
 *
 * Only when the request did not send its own `paymentMilestones`. A caller
 * that sends the plan has already decided where the money goes, and the
 * vendor route's drift check holds it to the new total.
 */

const round2 = (value) => Math.round(value * 100) / 100;

const FINAL_TITLE = /final|last pay/i;

export const DEFAULT_ADDITIONAL_CHARGES_LABEL = "Additional Charges";

/**
 * How far moving additionalCharges from `previous` to its current value moves
 * the booking total, tax included — priced by the same breakdown the
 * customer sees.
 */
export const additionalChargesDelta = (booking, previous) => {
  const plain = typeof booking.toObject === "function" ? booking.toObject() : booking;
  const pricing = plain.pricing || {};
  const before = round2(previous || 0);
  if (round2(pricing.additionalCharges || 0) === before) return 0;
  const withPrevious = buildPricingBreakdown({ ...plain, pricing: { ...pricing, additionalCharges: before } });
  return round2(buildPricingBreakdown(plain).finalAmount - withPrevious.finalAmount);
};

/**
 * Add `delta` to the final unpaid milestone: the last one not yet Received,
 * preferring one titled like the app's "Final Payment" / "Last Pay". A
 * reduction larger than that milestone carries back to the earlier unpaid
 * ones. With every milestone already Received, an increase becomes a new
 * Pending milestone titled with the charges' label, due on the event date.
 * A booking with no payment plan yet is left alone — the plan, once made,
 * is built from the total, which already includes the charges.
 *
 * Mutates `booking.paymentMilestones`; returns whether anything changed.
 */
export const mergeAdditionalChargesIntoFinal = (booking, delta, label) => {
  if (!delta || !booking.paymentMilestones?.length) return false;

  const open = booking.paymentMilestones.filter((m) => m.status !== "Received");
  if (open.length) {
    const finalIdx = open.reduce((idx, m, i) => (FINAL_TITLE.test(m.title || "") ? i : idx), open.length - 1);
    // The final milestone first, then the other unpaid ones latest-first.
    const order = [open[finalIdx], ...open.filter((_, i) => i !== finalIdx).reverse()];
    let remaining = delta;
    for (const milestone of order) {
      if (remaining === 0) break;
      const next = Math.max(0, round2((milestone.amount || 0) + remaining));
      remaining = round2(remaining - (next - (milestone.amount || 0)));
      milestone.amount = next;
      // The amount no longer follows the plan's percentage split.
      milestone.percentage = null;
    }
    return true;
  }

  // Everything is paid. A reduction would be a refund, which is not handled here.
  if (delta < 0) return false;
  booking.paymentMilestones.push({
    title: (label || "").trim() || DEFAULT_ADDITIONAL_CHARGES_LABEL,
    percentage: null,
    amount: delta,
    dueDate: booking.eventDate || null,
    status: "Pending",
  });
  return true;
};
