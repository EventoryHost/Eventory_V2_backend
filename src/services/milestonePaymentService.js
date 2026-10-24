import Booking from "../models/Booking.js";
import { round2 } from "../utils/money.js";
import { recordVendorMilestoneDue } from "./vendorPayoutService.js";

/**
 * Applies a confirmed-PAID Step 22 milestone payment to its Booking — Phase
 * 5 Step 22 ("Pay-milestone endpoint: Pay Advance 2 / Pay Remaining"). This
 * is the milestone-payment counterpart to bookingCreationService.js's
 * createBookingsFromCheckoutSession: same idempotent-by-caller contract
 * (only ever invoked once per Payment, guarded by the caller checking
 * payment.status/bookingCreated BEFORE calling this — see
 * customerPaymentController.js), but here there's no new Booking to
 * create — it pays down one that already exists.
 *
 * Deliberately generic over which milestone it is (identified by title now,
 * a free-text field — see bookingCreationService.js's 2026-08-27 rewrite
 * note) rather than separate "pay advance 2" / "pay remaining" functions —
 * the caller already resolved WHICH milestone via
 * payment.milestoneId, so this just marks that one Received and updates
 * the Booking's running totals. Matches this step's own title, which names
 * two example milestones, not two separate endpoints.
 */
export async function applyMilestonePaymentToBooking(payment) {
  const booking = await Booking.findById(payment.bookingId);
  if (!booking) {
    console.error(`[milestonePaymentService] Booking ${payment.bookingId} not found for paid Payment ${payment._id} — cannot apply.`);
    return null;
  }

  const milestone = booking.paymentMilestones.id(payment.milestoneId);
  if (!milestone) {
    console.error(`[milestonePaymentService] Milestone ${payment.milestoneId} not found on Booking ${booking._id} for paid Payment ${payment._id} — cannot apply.`);
    return null;
  }

  // Guard against a webhook retry landing here a second time for the same
  // milestone (belt-and-suspenders alongside the caller's own
  // payment.status terminal-state check) — never double-credit.
  if (milestone.status === "Received") {
    return booking;
  }

  const paidAt = payment.paidAt || new Date();
  const shortBy = round2((milestone.amount || 0) - (payment.amount || 0));
  if (shortBy > 0.01) {
    // The vendor raised this milestone after the customer's order was made,
    // so the order paid the old, smaller amount. Credit what was paid as its
    // own Received part and leave the difference due on the milestone,
    // rather than marking the whole (larger) instalment paid.
    milestone.amount = shortBy;
    milestone.percentage = null;
    booking.paymentMilestones.push({
      title: `${milestone.title} (part paid)`,
      percentage: null,
      amount: round2(payment.amount),
      dueDate: milestone.dueDate || null,
      status: "Received",
      receivedDate: paidAt,
    });
    console.warn(`[milestonePaymentService] Payment ${payment._id} covered ${payment.amount} of milestone ${milestone._id} on Booking ${booking._id}; ${shortBy} is still due.`);
  } else {
    milestone.status = "Received";
    milestone.receivedDate = paidAt;
  }

  booking.totalReceived = round2((booking.totalReceived || 0) + payment.amount);
  // Once the running total covers the full booking amount, reflect that on
  // paymentType — the existing enum already distinguishes "AdvancePaid"
  // from "FullPaid" (set at Step 19 for the checkout-time token payment);
  // a fully-paid-off booking via later milestones is the same state, just
  // reached later.
  if (booking.totalReceived >= booking.totalAmount && booking.paymentType !== "FreeBooking") {
    booking.paymentType = "FullPaid";
  }

  await booking.save();

  payment.bookingCreated = true; // reused as "applied to its booking" for this payment type — see Payment.js comment
  await payment.save();

  // Records what the vendor is now owed for this milestone — does not move
  // any real money. The business admin portal approves/fires the actual
  // payout against this same Transaction data — PM decision 2026-10-10.
  await recordVendorMilestoneDue({ booking, milestoneTitle: milestone.title, grossAmount: payment.amount });

  return booking;
}

export default applyMilestonePaymentToBooking;
