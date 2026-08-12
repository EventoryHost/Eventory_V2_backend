import crypto from "crypto";
import mongoose from "mongoose";
import cashfree from "../config/cashfree.js";
import Payment from "../models/Payment.js";
import CheckoutSession from "../models/CheckoutSession.js";
import { computeContactValidation, computeLinesValidation } from "../services/checkoutValidationService.js";
import { createBookingsFromCheckoutSession } from "../services/bookingCreationService.js";
import { normalizePhone } from "../utils/phone.js";
import { generatePaymentId } from "../utils/generateId.js";

/**
 * Cashfree Payment Gateway integration — Phase 4 Step 18. Researched from
 * V1's live controllers/cashfree.js (see info.txt for the full writeup) —
 * same gateway, same cashfree-pg SDK calls (PGCreateOrder/PGFetchOrder),
 * but NOT a copy of V1's business logic: V1's actual webhook handler
 * (handlePaymentSuccess/Failed/Dropped) turned out to be an unimplemented
 * stub ("// Add your payment success logic here") — V1's REAL payment
 * confirmation happens client-triggered, after the browser redirects back
 * from Cashfree. The final Customer Portal BRD explicitly requires
 * server/webhook authority instead ("the client never marks a payment
 * successful... only the server webhook promotes it to paid" — Section
 * 11), so the webhook handler below is written for real, not modeled on
 * V1's stub.
 *
 * "Booking creation on payment success" (Phase 4 Step 19, this same file
 * now) triggers via src/services/bookingCreationService.js from exactly
 * two places — the webhook handler and the GET status poll's live-recheck
 * fallback — both guarded by Payment.bookingCreated so a webhook retry (or
 * a poll landing right after the webhook already fired) can never create
 * the same booking twice.
 */

// Cashfree's own documented webhook-signature algorithm: base64(HMAC-SHA256
// of `timestamp + rawBody`, keyed with the Payment Gateway client secret).
// Requires the EXACT raw bytes Cashfree sent — see app.js's express.json()
// `verify` callback, which captures req.rawBody for this purpose. V1's
// webhook handler only checked that the signature HEADERS were present,
// never actually verified them cryptographically — that gap is not
// repeated here.
function isValidWebhookSignature(rawBody, timestamp, signature) {
  if (!rawBody || !timestamp || !signature) return false;
  const secret = process.env.CASHFREE_CLIENT_SECRET_PG;
  if (!secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(timestamp + rawBody)
    .digest("base64");
  // Timing-safe comparison — both buffers must be equal length for
  // timingSafeEqual, so a length mismatch (any tampering) is checked first.
  const expectedBuf = Buffer.from(expected);
  const givenBuf = Buffer.from(String(signature));
  return expectedBuf.length === givenBuf.length && crypto.timingSafeEqual(expectedBuf, givenBuf);
}

/**
 * @desc Create (or, on retry, return the existing) Cashfree order for a
 * checkout session's TOKEN amount. Re-runs Step 17's full "Validation
 * before Continue" check server-side — never trusts that the frontend
 * actually enforced canContinue before calling this.
 */
export const createTokenPayment = async (req, res) => {
  try {
    const { checkoutSessionId } = req.body;

    const session = await CheckoutSession.findOne({ _id: checkoutSessionId, customerId: req.customer._id });
    if (!session) return res.status(404).json({ status: "FAILED", message: "Checkout session not found" });

    if (session.status === "Active" && session.expiresAt < new Date()) {
      session.status = "Expired";
      await session.save();
    }
    if (session.status !== "Active") {
      return res.status(410).json({ status: "FAILED", message: `This checkout session is ${session.status.toLowerCase()} — start a new one` });
    }

    const contact = computeContactValidation(session.contactDetails, req.customer);
    const lines = computeLinesValidation(session.lines);
    if (!contact.valid || !lines.valid) {
      return res.status(400).json({
        status: "FAILED",
        message: "Checkout session is not ready for payment",
        validation: { contact, lines },
      });
    }

    const tokenAmount = session.lockedQuote?.tokenAmountTotal;
    if (tokenAmount == null || tokenAmount <= 0) {
      return res.status(400).json({
        status: "FAILED",
        message:
          tokenAmount === 0
            ? "This session's token amount is zero — nothing to pay right now"
            : "Token amount is unavailable — one or more vendors haven't configured an advance/token, or the quote is stale (edit a line to re-lock it)",
      });
    }

    // Idempotency: a PENDING or PAID payment already exists for this exact
    // intent (session + Token) — return it rather than minting a second
    // Cashfree order, so a frontend retry/double-click/network-retry can
    // never create a duplicate charge attempt. A FAILED/EXPIRED/CANCELLED
    // prior attempt does NOT block a fresh one.
    const existing = await Payment.findOne({
      checkoutSessionId: session._id,
      paymentType: "Token",
      status: { $in: ["PENDING", "PAID"] },
    }).sort({ createdAt: -1 });
    if (existing) {
      return res.status(200).json({
        status: "SUCCESS",
        message: existing.status === "PAID" ? "This session's token payment is already complete" : "Reusing an existing pending payment",
        paymentId: existing._id,
        cfOrderId: existing.cfOrderId,
        paymentSessionId: existing.cfPaymentSessionId,
        amount: existing.amount,
        paymentStatus: existing.status,
      });
    }

    const cfOrderId = generatePaymentId();
    const idempotencyKey = `${session._id}:Token:${cfOrderId}`;

    const payment = await Payment.create({
      checkoutSessionId: session._id,
      customerId: req.customer._id,
      paymentType: "Token",
      amount: tokenAmount,
      cfOrderId,
      idempotencyKey,
      status: "PENDING",
    });

    const rawPhone = normalizePhone(session.contactDetails.phone); // "+91XXXXXXXXXX"
    const cashfreePhone = rawPhone ? rawPhone.slice(-10) : "0000000000"; // Cashfree examples use a bare 10-digit number

    try {
      const response = await cashfree.PGCreateOrder({
        order_id: cfOrderId,
        order_amount: tokenAmount,
        order_currency: "INR",
        customer_details: {
          customer_id: req.customer.id,
          customer_phone: cashfreePhone,
          customer_email: session.contactDetails.email || undefined,
          customer_name: session.contactDetails.name || undefined,
        },
        order_tags: {
          checkoutSessionId: String(session._id),
          paymentType: "Token",
        },
      });

      payment.cfPaymentSessionId = response.data?.payment_session_id || null;
      await payment.save();

      return res.status(201).json({
        status: "SUCCESS",
        message: "Payment order created",
        paymentId: payment._id,
        cfOrderId: payment.cfOrderId,
        paymentSessionId: payment.cfPaymentSessionId,
        amount: payment.amount,
        paymentStatus: payment.status,
      });
    } catch (cfError) {
      payment.status = "FAILED";
      payment.failureReason = cfError?.response?.data?.message || cfError.message;
      await payment.save();
      return res.status(502).json({
        status: "FAILED",
        message: "Cashfree order creation failed",
        error: payment.failureReason,
      });
    }
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to create payment", error: error.message });
  }
};

/**
 * @desc Cashfree webhook receiver — PUBLIC (Cashfree calls this directly,
 * no customer session). Verifies the signature cryptographically before
 * touching anything, then re-confirms with Cashfree's own PGFetchOrder
 * rather than trusting the webhook payload alone (defense in depth beyond
 * what V1 did). Idempotent — a duplicate/retried webhook delivery for a
 * payment already in a terminal state (PAID/FAILED) is acknowledged
 * without reprocessing.
 */
export const handleCashfreeWebhook = async (req, res) => {
  try {
    const timestamp = req.headers["x-webhook-timestamp"];
    const signature = req.headers["x-webhook-signature"];
    const rawBody = req.rawBody ? req.rawBody.toString("utf8") : null;

    if (!isValidWebhookSignature(rawBody, timestamp, signature)) {
      console.warn("[cashfree webhook] Invalid or missing signature — rejected");
      return res.status(400).json({ status: "FAILED", message: "Invalid webhook signature" });
    }

    const { type, data } = req.body || {};
    const cfOrderId = data?.order?.order_id;
    if (!cfOrderId) {
      // Nothing to correlate this event to — ack anyway so Cashfree
      // doesn't keep retrying a payload we can never act on.
      return res.status(200).json({ status: "SUCCESS", message: "Acknowledged (no order_id in payload)" });
    }

    const payment = await Payment.findOne({ cfOrderId });
    if (!payment) {
      console.warn(`[cashfree webhook] No Payment found for cfOrderId ${cfOrderId} — acknowledged, not processed`);
      return res.status(200).json({ status: "SUCCESS", message: "Acknowledged (unknown order)" });
    }

    payment.webhookEvents.push({ type, cfPaymentStatus: data?.payment?.payment_status || null });

    if (["PAID", "FAILED"].includes(payment.status)) {
      // Already in a terminal state — a Cashfree webhook retry lands here
      // harmlessly rather than reprocessing (e.g. double-crediting).
      await payment.save();
      return res.status(200).json({ status: "SUCCESS", message: "Acknowledged (already processed)" });
    }

    // Never trust the webhook body's own status claim as final — re-fetch
    // the order directly from Cashfree, same as V1's (correctly-built)
    // customer-triggered verifyCustomerPayment did, just applied here to
    // the webhook path too, which V1 did not do.
    const orderResponse = await cashfree.PGFetchOrder(cfOrderId);
    const orderStatus = orderResponse?.data?.order_status;

    if (orderStatus === "PAID") {
      payment.status = "PAID";
      payment.paidAt = new Date();
      await payment.save();

      const session = await CheckoutSession.findById(payment.checkoutSessionId);
      if (session && session.status !== "Completed") {
        session.status = "Completed";
        await session.save();
      }
      // Phase 4 Step 19 — bookingCreated guards against a Cashfree webhook
      // retry (or a GET poll landing right after) creating the same
      // booking twice; this branch only runs once per Payment ever.
      if (session && !payment.bookingCreated) {
        await createBookingsFromCheckoutSession(session, payment);
      }
    } else if (["EXPIRED", "TERMINATED", "TERMINATION_REQUESTED"].includes(orderStatus) || type === "PAYMENT_FAILED_WEBHOOK") {
      payment.status = "FAILED";
      payment.failureReason = `Cashfree order status: ${orderStatus || "unknown"}`;
      await payment.save();
    } else {
      // Still pending/active on Cashfree's side (e.g. USER_DROPPED without
      // a final failure yet) — leave PENDING, just record the event.
      await payment.save();
    }

    return res.status(200).json({ status: "SUCCESS", message: "Webhook processed" });
  } catch (error) {
    console.error("[cashfree webhook] Processing error:", error);
    // Still 200 — a 5xx here just causes Cashfree to retry the same event
    // indefinitely; the error is already logged for investigation.
    return res.status(200).json({ status: "ERROR", message: "Webhook received but processing failed", error: error.message });
  }
};

/**
 * @desc Get a payment's current status — for the frontend's "Awaiting
 * confirmation" polling (final BRD Section 11: 5-minute poll while
 * pending). If still PENDING, actively re-checks with Cashfree before
 * responding, covering the "webhook delayed" edge case (Section 19)
 * without needing a queue/cron for this.
 */
export const getPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({ status: "FAILED", message: "Invalid paymentId" });
    }

    const payment = await Payment.findOne({ _id: paymentId, customerId: req.customer._id });
    if (!payment) return res.status(404).json({ status: "FAILED", message: "Payment not found" });

    if (payment.status === "PENDING") {
      try {
        const orderResponse = await cashfree.PGFetchOrder(payment.cfOrderId);
        const orderStatus = orderResponse?.data?.order_status;
        if (orderStatus === "PAID") {
          payment.status = "PAID";
          payment.paidAt = new Date();
          await payment.save();

          const session = await CheckoutSession.findById(payment.checkoutSessionId);
          if (session && session.status !== "Completed") {
            session.status = "Completed";
            await session.save();
          }
          if (session && !payment.bookingCreated) {
            await createBookingsFromCheckoutSession(session, payment);
          }
        } else if (["EXPIRED", "TERMINATED", "TERMINATION_REQUESTED"].includes(orderStatus)) {
          payment.status = "FAILED";
          payment.failureReason = `Cashfree order status: ${orderStatus}`;
          await payment.save();
        }
      } catch (cfError) {
        // Don't fail the whole status check just because the live re-check
        // errored — the customer still gets whatever we last knew.
        console.warn(`[getPaymentStatus] Cashfree re-check failed for ${payment.cfOrderId}:`, cfError.message);
      }
    }

    return res.status(200).json({
      status: "SUCCESS",
      paymentId: payment._id,
      checkoutSessionId: payment.checkoutSessionId,
      paymentType: payment.paymentType,
      amount: payment.amount,
      paymentStatus: payment.status,
      failureReason: payment.failureReason,
      paidAt: payment.paidAt,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch payment status", error: error.message });
  }
};

/**
 * @desc Phase 4 Step 19's "(or no-upfront flow)" — confirms a checkout
 * session directly, with NO Cashfree charge, when every selected line
 * resolved to a Free (no-advance) package. Still creates a real $0
 * Payment record (immediately marked PAID) rather than a special
 * "bookings with no payment record" code path elsewhere in the system —
 * one consistent trail for every booking's origin, paid-for-real or not.
 * Rejects (400) if ANY line actually requires a token amount — that must
 * go through POST /token instead, never silently skipped here.
 */
export const confirmFreeCheckout = async (req, res) => {
  try {
    const { checkoutSessionId } = req.body;

    const session = await CheckoutSession.findOne({ _id: checkoutSessionId, customerId: req.customer._id });
    if (!session) return res.status(404).json({ status: "FAILED", message: "Checkout session not found" });

    if (session.status === "Active" && session.expiresAt < new Date()) {
      session.status = "Expired";
      await session.save();
    }
    if (session.status !== "Active") {
      return res.status(410).json({ status: "FAILED", message: `This checkout session is ${session.status.toLowerCase()} — start a new one` });
    }

    const contact = computeContactValidation(session.contactDetails, req.customer);
    const lines = computeLinesValidation(session.lines);
    if (!contact.valid || !lines.valid) {
      return res.status(400).json({ status: "FAILED", message: "Checkout session is not ready to confirm", validation: { contact, lines } });
    }

    const quote = session.lockedQuote;
    if (!quote || !quote.allTokensConfigured || quote.tokenAmountTotal !== 0) {
      return res.status(400).json({
        status: "FAILED",
        message:
          "This session requires a real payment — one or more lines have a non-zero token amount. Use POST /api/customer/payments/token instead.",
      });
    }

    const payment = await Payment.create({
      checkoutSessionId: session._id,
      customerId: req.customer._id,
      paymentType: "Token",
      amount: 0,
      cfOrderId: generatePaymentId(), // no real Cashfree order exists — still unique, kept for schema consistency
      idempotencyKey: `${session._id}:Token:free`,
      status: "PAID",
      paidAt: new Date(),
    });

    session.status = "Completed";
    await session.save();

    const bookingIds = await createBookingsFromCheckoutSession(session, payment);

    return res.status(201).json({
      status: "SUCCESS",
      message: "Checkout confirmed with no payment required",
      paymentId: payment._id,
      bookingIds,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ status: "FAILED", message: "This session has already been confirmed" });
    }
    return res.status(500).json({ status: "ERROR", message: "Failed to confirm checkout", error: error.message });
  }
};
