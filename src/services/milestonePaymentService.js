import Booking from "../models/Booking.js";
import { round2 } from "../utils/money.js";

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
 * Deliberately generic over milestone type (Token/Advanced1/Advanced2/
 * FinalClearance) rather than separate "pay advance 2" / "pay remaining"
 * functions — the caller already resolved WHICH milestone via
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

  milestone.status = "Received";
  milestone.receivedDate = payment.paidAt || new Date();

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

  return booking;
}

export default applyMilestonePaymentToBooking;
