import express from "express";
import { getBookings, getBookingDetail } from "../controllers/customerBookingController.js";
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
 *     summary: "My Bookings" dashboard — active/past/cancelled tabs, search, sort
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

export default router;
