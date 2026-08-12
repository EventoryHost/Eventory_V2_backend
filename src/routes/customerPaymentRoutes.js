import express from "express";
import {
  createTokenPayment,
  handleCashfreeWebhook,
  getPaymentStatus,
  confirmFreeCheckout,
} from "../controllers/customerPaymentController.js";
import { protectCustomer } from "../middlewares/customerAuth.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { createTokenPaymentSchema } from "../validators/customerPaymentValidators.js";

const router = express.Router();

/**
 * Mounted at /api/customer/payments (src/routes/index.js) — Phase 4 Steps
 * 18-19. /webhook is PUBLIC (Cashfree calls it directly, authenticated by
 * signature verification, not a customer session) — every other route
 * requires protectCustomer.
 */

/**
 * @swagger
 * /api/customer/payments/token:
 *   post:
 *     summary: Create (or reuse, if retried) the Cashfree order for a checkout session's token amount
 *     description: |
 *       Re-runs the full Step 17 "Validation before Continue" check
 *       server-side before creating anything. Idempotent per
 *       (checkoutSessionId, Token) — a retry/double-click while a payment
 *       is still PENDING or already PAID returns the existing one instead
 *       of creating a duplicate Cashfree order.
 *     tags: [Customer Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [checkoutSessionId]
 *             properties:
 *               checkoutSessionId: { type: string }
 *     responses:
 *       201: { description: New payment order created }
 *       200: { description: Existing pending/paid payment returned instead }
 *       400: { description: Session not ready for payment (see validation), or token amount unavailable }
 *       404: { description: Checkout session not found }
 *       410: { description: Checkout session is no longer Active }
 *       502: { description: Cashfree order creation failed }
 */
router.post("/token", protectCustomer, validateRequest(createTokenPaymentSchema), createTokenPayment);

/**
 * @swagger
 * /api/customer/payments/confirm-free:
 *   post:
 *     summary: Confirm a checkout session with NO payment required (Phase 4 Step 19's "no-upfront flow")
 *     description: |
 *       Only succeeds when every selected line resolved to a Free
 *       (no-advance) package — tokenAmountTotal must be exactly 0 with
 *       every line's token config resolved (not just unconfigured). Any
 *       line that actually needs a token payment 400s here and must go
 *       through POST /token instead. Still creates a real $0 Payment
 *       record (immediately PAID) and real Bookings, same as a paid flow.
 *     tags: [Customer Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [checkoutSessionId]
 *             properties:
 *               checkoutSessionId: { type: string }
 *     responses:
 *       201: { description: Confirmed — paymentId + created bookingIds returned }
 *       400: { description: Session not ready, or a line actually requires payment }
 *       404: { description: Checkout session not found }
 *       409: { description: This session was already confirmed }
 *       410: { description: Checkout session is no longer Active }
 */
router.post("/confirm-free", protectCustomer, validateRequest(createTokenPaymentSchema), confirmFreeCheckout);

/**
 * @swagger
 * /api/customer/payments/webhook:
 *   post:
 *     summary: Cashfree webhook receiver (PUBLIC — signature-verified, not session-authenticated)
 *     description: |
 *       Verifies x-webhook-timestamp/x-webhook-signature cryptographically
 *       against the raw request body before processing anything, then
 *       re-confirms the order status directly with Cashfree's own
 *       PGFetchOrder rather than trusting the webhook payload alone. On a
 *       genuinely confirmed PAID, also creates the real Booking(s) for this
 *       session (Phase 4 Step 19), guarded by Payment.bookingCreated so a
 *       webhook retry can never create duplicates.
 *     tags: [Customer Payments]
 *     responses:
 *       200: { description: Acknowledged (processed, already-processed, or unknown order) }
 *       400: { description: Invalid/missing signature }
 */
router.post("/webhook", handleCashfreeWebhook);

/**
 * @swagger
 * /api/customer/payments/{paymentId}:
 *   get:
 *     summary: Get a payment's current status (for frontend polling)
 *     description: |
 *       If still PENDING, actively re-checks with Cashfree before
 *       responding — covers the "webhook delayed" edge case without
 *       needing a queue/cron.
 *     tags: [Customer Payments]
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Current payment status }
 *       404: { description: Payment not found (or not owned by this customer) }
 */
router.get("/:paymentId", protectCustomer, getPaymentStatus);

export default router;
