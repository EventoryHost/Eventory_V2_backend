import mongoose from "mongoose";

/**
 * A Cashfree Payment Gateway order tied to a CheckoutSession — Phase 4 Step
 * 18. This is the model PART 1 originally flagged as entirely missing
 * ("MODELS THAT DO NOT EXIST AT ALL: ... Payment/Order (Cashfree)").
 *
 * paymentType is broader than what Step 18 actually exercises (only
 * "Token", per the final BRD's token-first model) — Milestone/Remaining
 * are included now so Phase 5 Step 22 ("Pay-milestone endpoint") can reuse
 * this exact model/order-creation flow instead of building a parallel one
 * later.
 *
 * status is SERVER-AUTHORITATIVE ONLY: the client never marks a payment
 * paid — only the webhook handler (customerPaymentController.js), itself
 * re-verified against Cashfree's own PGFetchOrder before trusting it, ever
 * transitions status away from PENDING. Matches the final BRD's own rule
 * (Section 11) plus this codebase's own extension of it (re-verify with
 * Cashfree's API, don't trust the webhook payload alone).
 *
 * bookingCreated stays false here — Step 18 does NOT create a Booking on
 * payment success, that's explicitly Step 19's job. It's a placeholder
 * flag for Step 19 to flip (idempotently — checked before creating a
 * Booking) so a webhook retry can never create two Bookings for the same
 * successful payment.
 *
 * Step 22 (Pay-milestone endpoint) exercises paymentType:"Milestone" for
 * the first time: a milestone payment pays down an EXISTING Booking (Pay
 * Advance 2 / Pay Remaining), not a CheckoutSession creating a new one —
 * so checkoutSessionId is relaxed to optional and bookingId/milestoneId
 * are added, set only on this path. Kept on this same model/collection
 * rather than a parallel one, per this comment's own original plan above.
 */
const WebhookEventSchema = new mongoose.Schema(
  {
    type: { type: String, required: true }, // e.g. PAYMENT_SUCCESS_WEBHOOK
    cfPaymentStatus: { type: String, default: null },
    receivedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const PaymentSchema = new mongoose.Schema(
  {
    // Required for the checkout-time "Token" flow; null for a Step 22
    // milestone payment, which pays down an existing Booking instead
    // (bookingId/milestoneId below), not a CheckoutSession.
    checkoutSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "CheckoutSession", default: null, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true, index: true },

    paymentType: { type: String, enum: ["Token", "Remaining", "Milestone"], required: true },
    milestoneLabel: { type: String, default: null }, // set only when paymentType:"Milestone"/"Remaining"

    // Step 22 only — which existing Booking (and which of its
    // paymentMilestones subdocuments) this payment is for. Null for the
    // checkout-time "Token" flow, which has no Booking yet at payment time.
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", default: null, index: true },
    milestoneId: { type: mongoose.Schema.Types.ObjectId, default: null }, // Booking.paymentMilestones[]._id

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },

    // Our own generated id, sent to Cashfree AS the order_id — Cashfree
    // never generates this, we do (generatePaymentId(), already in
    // utils/generateId.js, ported from V1).
    cfOrderId: { type: String, required: true, unique: true },
    cfPaymentSessionId: { type: String, default: null }, // handed to the frontend's Cashfree Checkout SDK

    // Prevents a retried/duplicated "create payment" request from minting a
    // second Cashfree order for the same intent — see
    // customerPaymentController.js's idempotency check, which looks this
    // up BEFORE calling Cashfree at all.
    idempotencyKey: { type: String, required: true, unique: true },

    status: { type: String, enum: ["PENDING", "PAID", "FAILED", "EXPIRED", "CANCELLED"], default: "PENDING", index: true },
    failureReason: { type: String, default: null },
    paidAt: { type: Date, default: null },

    webhookEvents: { type: [WebhookEventSchema], default: [] },

    // Step 19's flag, not used here — see the model comment above.
    bookingCreated: { type: Boolean, default: false },

    // Added 2026-08-27 (real Cashfree redirect integration): which real
    // Booking(s) this Token payment created — a checkout-time payment can
    // create MULTIPLE bookings (one per vendor line), unlike bookingId
    // above (Step 22 milestone payments, always exactly one EXISTING
    // booking). Set by bookingCreationService.js's
    // createBookingsFromCheckoutSession, same call for every path that
    // creates bookings (webhook, status-poll live-recheck, confirm-free,
    // confirm-offline) — lets GET /:paymentId (and anything else reading a
    // Payment) tell the frontend which booking(s) resulted, which it needs
    // after a Cashfree redirect since the browser only comes back with a
    // paymentId, not booking data.
    createdBookingIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Booking" }], default: [] },
  },
  {
    timestamps: true,
    collection: "customer_payments",
  }
);

export default mongoose.model("Payment", PaymentSchema);
