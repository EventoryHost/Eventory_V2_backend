import express from "express";
import { getBookings, getBookingDetail, cancelBooking, getInvoicePdf } from "../controllers/customerBookingController.js";
import { protectCustomer } from "../middlewares/customerAuth.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { bookingsQuerySchema } from "../validators/customerBookingValidators.js";

const router = express.Router();

/**
 * Mounted at /api/customer/bookings (src/routes/index.js) — Phase 5 Steps
 * 20-21. Distinct from the vendor's own /api/bookings (that vendor's
 * incoming bookings across all customers) — this is "my bookings" for one
 * authenticated customer, per the established namespace convention
 * documented in src/routes/index.js.
 */

/**
 * @swagger
 * /api/customer/bookings:
 *   get:
 *     summary: '"My Bookings" dashboard — active/past/cancelled tabs, search, sort'
 *     description: |
 *       One row per Booking (i.e. per vendor) — see the controller's own
 *       comment for why this can't yet group multiple vendors under one
 *       order-level card (PART 5 Flag #4, still open).
 *     tags: [Customer Bookings]
 *     parameters:
 *       - in: query
 *         name: tab
 *         schema: { type: string, enum: [active, past, cancelled], default: active }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Matches bookingId, eventType, or vendor business name
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [newest, eventDate_asc, eventDate_desc, amount_desc], default: newest }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200: { description: Paginated bookings for the requested tab, plus counts for all three tabs }
 */
router.get("/", protectCustomer, validateRequest(bookingsQuerySchema, "query"), getBookings);

/**
 * @swagger
 * /api/customer/bookings/{bookingId}:
 *   get:
 *     summary: Expanded booking detail — Phase 5 Step 21
 *     description: |
 *       Accepts either the human-readable bookingId ("EVT...") or the
 *       MongoDB _id. Returns price breakdown, payment timeline,
 *       cancellation policy (fetched LIVE from the current package — not a
 *       locked snapshot, flagged in the response), and EM contact info
 *       (currently always unavailable — no EM/Admin system exists in this
 *       codebase yet, see info.txt PART 5 Flag #2).
 *     tags: [Customer Bookings]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Full booking + priceBreakdown + paymentTimeline + cancellationPolicy + emContact }
 *       400: { description: Invalid bookingId }
 *       404: { description: Not found (or not owned by this customer) }
 */
router.get("/:bookingId", protectCustomer, getBookingDetail);

/**
 * @swagger
 * /api/customer/bookings/{bookingId}/cancel:
 *   post:
 *     summary: Cancel a booking — Phase 5 Step 23
 *     description: |
 *       Scoped to what's actually decided today (see info.txt): marks the
 *       booking Cancelled and returns a refund ESTIMATE (= totalReceived,
 *       everything paid so far) plus the raw cancellation policy text — it
 *       does NOT compute a real policy-based refund amount (the stored
 *       policy is freeform text, not structured rules), does NOT call
 *       Cashfree's refund API (no money actually moves here), and does NOT
 *       send any vendor/admin notification (no notification system exists
 *       in this codebase yet — logged server-side only).
 *     tags: [Customer Bookings]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Booking cancelled — refundEstimate + cancellationPolicy returned }
 *       400: { description: Invalid bookingId }
 *       404: { description: Not found (or not owned by this customer) }
 *       409: { description: Booking is already Cancelled/Declined/Completed — cannot cancel }
 */
router.post("/:bookingId/cancel", protectCustomer, cancelBooking);

/**
 * @swagger
 * /api/customer/bookings/{bookingId}/invoice:
 *   get:
 *     summary: Download this booking's invoice as a PDF — Phase 5 Step 24
 *     description: |
 *       ONE INVOICE PER BOOKING (per vendor) — see Invoice.js for why a
 *       consolidated multi-vendor invoice isn't built (open BRD question
 *       #6, and no cross-Booking groupId exists yet). Requires at least
 *       some payment received. Idempotent: the first call issues and
 *       freezes the invoice snapshot; later calls re-render that SAME
 *       snapshot — it is not automatically updated by payments made after
 *       the first call.
 *     tags: [Customer Bookings]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: PDF file stream (application/pdf) }
 *       400: { description: Invalid bookingId, or no payment received yet }
 *       404: { description: Not found (or not owned by this customer) }
 */
router.get("/:bookingId/invoice", protectCustomer, getInvoicePdf);

export default router;
