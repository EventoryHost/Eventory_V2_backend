import express from "express";
const router = express.Router();
import {
  createBooking,
  getVendorBookings,
  getBookingById,
  acceptBooking,
  declineBooking,
  cancelBooking,
  requestPackageChanges,
  updateBooking,
} from "../controllers/bookingController.js";

/**
 * @swagger
 * tags:
 *   name: Bookings
 *   description: |
 *     Vendor booking management — create bookings, accept/decline, cancel,
 *     negotiate package changes, price them, and manage payment milestones.
 *     Each booking captures a customer's reservation of a vendor's package for
 *     a specific event date, together with an immutable snapshot of that
 *     package as it was sold.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ChangeRequest:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         changeType:
 *           type: string
 *           enum: [Add, Remove]
 *         itemKind:
 *           type: string
 *           enum: [Item, Addon]
 *         category:
 *           type: string
 *           example: "Performance Type"
 *         item:
 *           type: string
 *           example: "Live Mixing Set"
 *         qty:
 *           type: number
 *         status:
 *           type: string
 *           enum: [Pending, Accepted, Rejected]
 *         requestedAt:
 *           type: string
 *           format: date-time
 *         respondedAt:
 *           type: string
 *           format: date-time
 *     PricingBreakdown:
 *       type: object
 *       description: |
 *         Derived, never stored — the signed, rendered form of `pricing`.
 *         Rows that come to zero are omitted.
 *       properties:
 *         originalPackagePrice:
 *           type: number
 *         additions:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               key:
 *                 type: string
 *                 enum: [itemsAdded, addonsAdded]
 *               label:
 *                 type: string
 *               amount:
 *                 type: number
 *         deductions:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               key:
 *                 type: string
 *                 enum: [itemsRemoved, addonsRemoved, discountAllowed]
 *               label:
 *                 type: string
 *               amount:
 *                 type: number
 *                 description: Negative.
 *         subtotal:
 *           type: number
 *         tax:
 *           type: object
 *           properties:
 *             label:
 *               type: string
 *               example: "Taxes (18% GST)"
 *             ratePct:
 *               type: number
 *             amount:
 *               type: number
 *         finalAmount:
 *           type: number
 *     Booking:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         bookingId:
 *           type: string
 *           description: "Human-readable ID, e.g. EVT20260615..."
 *         vendorId:
 *           type: string
 *         packageId:
 *           type: string
 *         customer:
 *           type: object
 *           properties:
 *             name:
 *               type: string
 *             phone:
 *               type: string
 *             email:
 *               type: string
 *         eventType:
 *           type: string
 *         eventDate:
 *           type: string
 *           format: date
 *         guestRange:
 *           type: object
 *           properties:
 *             min:
 *               type: number
 *             max:
 *               type: number
 *         location:
 *           type: string
 *         mapLink:
 *           type: string
 *           description: "Map deep-link backing the 'See on map' action"
 *         startTime:
 *           type: string
 *         endTime:
 *           type: string
 *         packageSnapshot:
 *           type: object
 *           description: |
 *             The package as sold. Immutable — a vendor editing the underlying
 *             Package later does not change past bookings.
 *           properties:
 *             name:
 *               type: string
 *             price:
 *               type: number
 *             image:
 *               type: string
 *             vendorType:
 *               type: string
 *             variantType:
 *               type: string
 *             deliverables:
 *               type: object
 *               description: |
 *                 The vendor-type-specific step-2 payload — `spaces` +
 *                 `inHouseServices` for venues, `items` + `equipments` for DJs,
 *                 `setups` for decorators, `menus` for caterers,
 *                 `packageItems` for PAV — plus `addOns`, `included` and
 *                 `notIncluded`. Backs "What You'll Deliver".
 *         paymentType:
 *           type: string
 *           enum: [FreeBooking, AdvancePaid, FullPaid]
 *         status:
 *           type: string
 *           enum: [NewBooking, Viewed, InDiscussion, Confirmed, Declined, Cancelled, Completed]
 *         respondByAt:
 *           type: string
 *           format: date-time
 *         confirmedAt:
 *           type: string
 *           format: date-time
 *         declinedAt:
 *           type: string
 *           format: date-time
 *         declineReason:
 *           type: string
 *         cancelledAt:
 *           type: string
 *           format: date-time
 *         cancelledBy:
 *           type: string
 *           enum: [Vendor, Customer]
 *         cancellationReason:
 *           type: string
 *         changeRequests:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ChangeRequest'
 *         pricing:
 *           type: object
 *           description: |
 *             Vendor-authored inputs the breakdown is derived from — one
 *             cumulative figure per row, all positive magnitudes.
 *           properties:
 *             basePrice:
 *               type: number
 *               description: Overrides packageSnapshot.price when negotiated separately.
 *             itemsAdded:
 *               type: number
 *             addonsAdded:
 *               type: number
 *             itemsRemoved:
 *               type: number
 *             addonsRemoved:
 *               type: number
 *             discountAmount:
 *               type: number
 *             discountLabel:
 *               type: string
 *             taxRatePct:
 *               type: number
 *             taxLabel:
 *               type: string
 *         pricingBreakdown:
 *           $ref: '#/components/schemas/PricingBreakdown'
 *         paymentMilestones:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Token"
 *               percentage:
 *                 type: number
 *                 example: 20
 *               amount:
 *                 type: number
 *               dueDate:
 *                 type: string
 *                 format: date
 *               status:
 *                 type: string
 *                 enum: [Pending, PaymentDue, Received]
 *               receivedDate:
 *                 type: string
 *                 format: date-time
 *         totalAmount:
 *           type: number
 *           description: Derived — mirrors pricingBreakdown.finalAmount.
 *         totalReceived:
 *           type: number
 *         notes:
 *           type: string
 *         calendarNote:
 *           type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

// ============================================================
//  BOOKING CRUD
// ============================================================

/**
 * @swagger
 * /api/bookings/vendor/{vendorId}:
 *   post:
 *     summary: Create a new booking
 *     description: |
 *       Creates a booking for the vendor's package and snapshots that package —
 *       name, price, media and the full per-vendor-type deliverables list — so
 *       later edits to the package never rewrite what this customer was sold.
 *       Checks for date conflicts with other bookings or calendar blocks.
 *     tags: [Bookings]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer, packageId, eventDate, startTime, endTime, paymentType]
 *             properties:
 *               customer:
 *                 type: object
 *                 required: [name]
 *                 properties:
 *                   name:
 *                     type: string
 *                     example: "Rahul Sharma"
 *                   phone:
 *                     type: string
 *                     example: "9876543210"
 *                   email:
 *                     type: string
 *               packageId:
 *                 type: string
 *                 example: "664a1b2c3d4e5f6a7b8c9d0e"
 *               eventType:
 *                 type: string
 *                 example: "Corporate Party"
 *               eventDate:
 *                 type: string
 *                 format: date
 *                 example: "2026-10-16"
 *               guestRange:
 *                 type: object
 *                 properties:
 *                   min:
 *                     type: number
 *                     example: 240
 *                   max:
 *                     type: number
 *                     example: 300
 *               location:
 *                 type: string
 *                 example: "Grand Hyatt Ballroom"
 *               mapLink:
 *                 type: string
 *                 example: "https://maps.google.com/?q=Grand+Hyatt+Ballroom"
 *               startTime:
 *                 type: string
 *                 example: "4:00 PM"
 *               endTime:
 *                 type: string
 *                 example: "8:00 PM"
 *               paymentType:
 *                 type: string
 *                 enum: [FreeBooking, AdvancePaid, FullPaid]
 *                 example: "FreeBooking"
 *               respondByAt:
 *                 type: string
 *                 format: date-time
 *                 description: Defaults to 24 hours from creation.
 *               basePrice:
 *                 type: number
 *                 description: Overrides the package price when negotiated separately.
 *               taxRatePct:
 *                 type: number
 *                 default: 18
 *               paymentMilestones:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     title:
 *                       type: string
 *                       example: "Token"
 *                     percentage:
 *                       type: number
 *                     amount:
 *                       type: number
 *                     dueDate:
 *                       type: string
 *                       format: date
 *               notes:
 *                 type: string
 *               calendarNote:
 *                 type: string
 *     responses:
 *       201:
 *         description: Booking created
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Vendor or package not found
 *       500:
 *         description: Server error
 */
router.post("/vendor/:vendorId", createBooking);

/**
 * @swagger
 * /api/bookings/vendor/{vendorId}:
 *   get:
 *     summary: Get vendor bookings (filtered, paginated)
 *     description: |
 *       Returns a paginated list of bookings for the vendor. Each booking is
 *       annotated with a `conflictDetected` flag and its derived
 *       `pricingBreakdown`.
 *     tags: [Bookings]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [NewBooking, Viewed, InDiscussion, Confirmed, Declined, Cancelled, Completed]
 *       - in: query
 *         name: paymentType
 *         schema:
 *           type: string
 *           enum: [FreeBooking, AdvancePaid, FullPaid]
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Bookings retrieved
 *       404:
 *         description: Vendor not found
 *       500:
 *         description: Server error
 */
router.get("/vendor/:vendorId", getVendorBookings);

/**
 * @swagger
 * /api/bookings/{bookingId}:
 *   get:
 *     summary: Get a single booking by ID
 *     description: |
 *       Supports both MongoDB _id and human-readable bookingId (EVT...).
 *       Returns the package snapshot, every change request and the derived
 *       pricing breakdown.
 *     tags: [Bookings]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Booking found
 *       404:
 *         description: Booking not found
 *       500:
 *         description: Server error
 */
router.get("/:bookingId", getBookingById);

// ============================================================
//  STATUS TRANSITIONS
// ============================================================

/**
 * @swagger
 * /api/bookings/{bookingId}/accept:
 *   put:
 *     summary: Accept a booking
 *     description: |
 *       Sets booking status to "Confirmed". Allowed from NewBooking, Viewed or
 *       InDiscussion. Updates the package's availabilityCalendar to "Booked"
 *       for the event date.
 *     tags: [Bookings]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Booking accepted
 *       400:
 *         description: Booking already resolved
 *       404:
 *         description: Booking not found
 *       500:
 *         description: Server error
 */
router.put("/:bookingId/accept", acceptBooking);

/**
 * @swagger
 * /api/bookings/{bookingId}/decline:
 *   put:
 *     summary: Decline a booking
 *     description: |
 *       Sets booking status to "Declined" and records when and why. Allowed
 *       from NewBooking, Viewed or InDiscussion.
 *     tags: [Bookings]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 example: "Already booked for that date"
 *     responses:
 *       200:
 *         description: Booking declined
 *       400:
 *         description: Booking already resolved
 *       404:
 *         description: Booking not found
 *       500:
 *         description: Server error
 */
router.put("/:bookingId/decline", declineBooking);

/**
 * @swagger
 * /api/bookings/{bookingId}/cancel:
 *   put:
 *     summary: Cancel a booking
 *     description: |
 *       Sets booking status to "Cancelled" and records who cancelled it and
 *       why. If the booking was Confirmed, reverts the package availability to
 *       "Available".
 *     tags: [Bookings]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cancelledBy:
 *                 type: string
 *                 enum: [Vendor, Customer]
 *                 default: Vendor
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Booking cancelled
 *       400:
 *         description: Cannot cancel booking with current status
 *       404:
 *         description: Booking not found
 *       500:
 *         description: Server error
 */
router.put("/:bookingId/cancel", cancelBooking);

// ============================================================
//  PACKAGE CHANGE REQUESTS
// ============================================================

/**
 * @swagger
 * /api/bookings/{bookingId}/change-requests:
 *   post:
 *     summary: Submit the customer's requested package changes
 *     description: |
 *       The customer asks for items to be added to or removed from the booked
 *       package. Each change names a `category` and the `item` within it — a
 *       caterer's "Cuisine: North Indian", a DJ's "Equipment: Par Lights".
 *
 *       Requests land as Pending and do not affect the price until the vendor
 *       accepts them. A pre-acceptance booking moves to "InDiscussion".
 *     tags: [Bookings]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [changes]
 *             properties:
 *               changes:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [changeType, category, item]
 *                   properties:
 *                     changeType:
 *                       type: string
 *                       enum: [Add, Remove]
 *                     itemKind:
 *                       type: string
 *                       enum: [Item, Addon]
 *                     category:
 *                       type: string
 *                       example: "Cuisine"
 *                     item:
 *                       type: string
 *                       example: "North Indian"
 *                     qty:
 *                       type: number
 *                       default: 1
 *     responses:
 *       201:
 *         description: Change requests submitted
 *       400:
 *         description: Validation failed, unresolvable path, or booking already resolved
 *       404:
 *         description: Booking not found
 *       500:
 *         description: Server error
 */
router.post("/:bookingId/change-requests", requestPackageChanges);

/**
 * @swagger
 * /api/bookings/{bookingId}:
 *   put:
 *     summary: Apply the vendor's edits to a booking
 *     description: |
 *       Everything the vendor changes on the booking details screen is saved in
 *       one call — the decision on each change request, the pricing rows, the
 *       payment plan and the calendar note. Every field is optional; send only
 *       what changed.
 *
 *       Decisions and the price they were agreed at land together, so a
 *       half-applied edit is not reachable. Milestones already marked Received
 *       are preserved and any incoming `Received` is coerced down — editing the
 *       plan never marks money as received. `totalAmount` and the pricing
 *       breakdown are re-derived.
 *     tags: [Bookings]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               changeRequests:
 *                 type: array
 *                 description: The vendor's decision on each request, by id.
 *                 items:
 *                   type: object
 *                   required: [id]
 *                   properties:
 *                     id:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [Pending, Accepted, Rejected]
 *                     qty:
 *                       type: number
 *               pricing:
 *                 type: object
 *                 properties:
 *                   basePrice:
 *                     type: number
 *                   itemsAdded:
 *                     type: number
 *                   addonsAdded:
 *                     type: number
 *                   itemsRemoved:
 *                     type: number
 *                   addonsRemoved:
 *                     type: number
 *                   discountAmount:
 *                     type: number
 *                   discountLabel:
 *                     type: string
 *                   taxRatePct:
 *                     type: number
 *               paymentMilestones:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [title, amount]
 *                   properties:
 *                     title:
 *                       type: string
 *                     percentage:
 *                       type: number
 *                     amount:
 *                       type: number
 *                     dueDate:
 *                       type: string
 *                       format: date
 *                     status:
 *                       type: string
 *                       enum: [Pending, PaymentDue]
 *               calendarNote:
 *                 type: string
 *     responses:
 *       200:
 *         description: Booking updated
 *       400:
 *         description: Validation failed, or booking already resolved
 *       404:
 *         description: Booking or change request not found
 *       500:
 *         description: Server error
 */
router.put("/:bookingId", updateBooking);

export default router;
