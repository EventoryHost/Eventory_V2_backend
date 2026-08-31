import { z } from "zod";
import mongoose from "mongoose";

const validId = (label) =>
  z
    .string()
    .trim()
    .min(1, `${label} must be a valid id`);

export const createTokenPaymentSchema = z.object({
  checkoutSessionId: validId("checkoutSessionId"),
});

// Phase 5 Step 22 — pays one milestone of an existing Booking. milestoneId
// is the _id of one of that Booking's own paymentMilestones subdocuments
// (as returned in the booking-detail endpoint's paymentTimeline), not a
// milestone type string — avoids ambiguity if a booking somehow has more
// than one milestone of the same mapped type.
export const createMilestonePaymentSchema = z.object({
  bookingId: validId("bookingId"),
  milestoneId: validId("milestoneId"),
});
