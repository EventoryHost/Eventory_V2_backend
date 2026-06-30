import express from "express";
const router = express.Router();
import {
  createBooking,
  getVendorBookings,
  getBookingById,
  acceptBooking,
  declineBooking,
  cancelBooking,
  updateMilestoneStatus,
  updateCalendarNote,
} from "../controllers/bookingController.js";

/**
 * @swagger
 * tags:
 *   name: Bookings
 *   description: |
 *     Vendor booking management — create bookings, accept/decline, cancel,
 *     and manage payment milestones. Each booking captures a customer's
 *     reservation of a vendor's package for a specific event date.
 */

/**
 * @swagger
 * components:
 *   schemas:
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
 *         paymentType:
 *           type: string
 *           enum: [FreeBooking, AdvancePaid, FullPaid]
 *         status:
 *           type: string
 *           enum: [Pending, Accepted, Declined, Cancelled, Completed]
 *         paymentMilestones:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [Token, Advanced1, Advanced2, FinalClearance]
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
 *         charges:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               label:
 *                 type: string
 *               amount:
 *                 type: number
 *               type:
 *                 type: string
 *                 enum: [Base, Fee, Discount, Tax]
 *         totalAmount:
 *           type: number
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
 *       Creates a booking for the vendor's package. Snapshots the package
 *       data (name, price, image) at creation time. Checks for date conflicts
 *       with other bookings or calendar blocks.
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
 *               totalAmount:
 *                 type: number
 *                 example: 25000
 *               paymentMilestones:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [Token, Advanced1, Advanced2, FinalClearance]
 *                     amount:
 *                       type: number
 *                     dueDate:
 *                       type: string
 *                       format: date
 *               charges:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [label, amount]
 *                   properties:
 *                     label:
 *                       type: string
 *                       example: "₹500 x 240 guests"
 *                     amount:
 *                       type: number
 *                       example: 120000
 *                     type:
 *                       type: string
 *                       enum: [Base, Fee, Discount, Tax]
 *                       example: "Base"
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
 *       Returns a paginated list of bookings for the vendor.
 *       Each booking is annotated with `conflictDetected` flag.
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
 *           enum: [Pending, Accepted, Declined, Cancelled, Completed]
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
 *     description: Supports both MongoDB _id and human-readable bookingId (EVT...).
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
 *     summary: Accept a pending booking
 *     description: |
 *       Sets booking status to "Accepted". Only Pending bookings can be accepted.
 *       Updates the package's availabilityCalendar to "Booked" for the event date.
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
 *         description: Booking not in Pending status
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
 *     summary: Decline a pending booking
 *     description: Sets booking status to "Declined". Only Pending bookings can be declined.
 *     tags: [Bookings]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Booking declined
 *       400:
 *         description: Booking not in Pending status
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
 *       Sets booking status to "Cancelled". Can cancel Pending or Accepted bookings.
 *       If the booking was Accepted, reverts the package availability to "Available".
 *     tags: [Bookings]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
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
//  PAYMENT MILESTONES
// ============================================================

/**
 * @swagger
 * /api/bookings/{bookingId}/milestone:
 *   put:
 *     summary: Update a payment milestone status
 *     description: |
 *       Updates a specific milestone (Token, Advanced1, Advanced2, FinalClearance)
 *       to a new status. When marking as "Received", automatically creates a
 *       Transaction record and updates totalReceived on the booking.
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
 *             required: [milestoneType, status]
 *             properties:
 *               milestoneType:
 *                 type: string
 *                 enum: [Token, Advanced1, Advanced2, FinalClearance]
 *                 example: "Token"
 *               status:
 *                 type: string
 *                 enum: [Pending, PaymentDue, Received]
 *                 example: "Received"
 *     responses:
 *       200:
 *         description: Milestone updated
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Booking or milestone not found
 *       500:
 *         description: Server error
 */
router.put("/:bookingId/milestone", updateMilestoneStatus);

/**
 * @swagger
 * /api/bookings/{bookingId}/note:
 *   put:
 *     summary: Save the vendor's calendar note on a booking
 *     description: |
 *       Saves/updates the vendor-private calendar note shown in the
 *       "Calendar Note" section of the booking details screen.
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
 *             required: [calendarNote]
 *             properties:
 *               calendarNote:
 *                 type: string
 *                 example: "Confirm parking access with the venue."
 *     responses:
 *       200:
 *         description: Calendar note saved
 *       400:
 *         description: calendarNote is required
 *       404:
 *         description: Booking not found
 *       500:
 *         description: Server error
 */
router.put("/:bookingId/note", updateCalendarNote);

export default router;
