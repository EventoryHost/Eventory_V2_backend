import express from "express";
const router = express.Router();
import {
  createEnquiry,
  getVendorEnquiries,
  getEnquiryById,
  updateEnquiryStatus,
  convertEnquiryToBooking,
  declineEnquiry,
  sendProposal,
} from "../controllers/enquiryController.js";

/**
 * @swagger
 * tags:
 *   name: Enquiries
 *   description: |
 *     Vendor enquiry management. Customers send enquiries before booking.
 *     Enquiries flow through: NewEnquiry → AwaitingResponse → ProposalSent → Converted/Declined.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Enquiry:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         enquiryId:
 *           type: string
 *           description: "Human-readable ID, e.g. ENQ20260615..."
 *         vendorId:
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
 *         startTime:
 *           type: string
 *         endTime:
 *           type: string
 *         budgetMin:
 *           type: number
 *         budgetMax:
 *           type: number
 *         requests:
 *           type: array
 *           items:
 *             type: string
 *         matchStrength:
 *           type: string
 *           enum: [Strong, Good, Weak]
 *         status:
 *           type: string
 *           enum: [NewEnquiry, AwaitingResponse, ProposalSent, Converted, Declined]
 *         convertedBookingId:
 *           type: string
 *         notes:
 *           type: string
 *         receivedAt:
 *           type: string
 *           format: date-time
 *         venueName:
 *           type: string
 *         guestCountMin:
 *           type: number
 *         guestCountMax:
 *           type: number
 *         mealType:
 *           type: string
 *         specialInstructions:
 *           type: array
 *           items:
 *             type: string
 *         customerMessage:
 *           type: string
 *         primaryPackage:
 *           type: object
 *           properties:
 *             name:
 *               type: string
 *             price:
 *               type: number
 *             image:
 *               type: string
 *         attachments:
 *           type: array
 *           items:
 *             type: string
 *         priority:
 *           type: string
 *           enum: [High, Medium, Low]
 *         eventImageUrl:
 *           type: string
 *         conflictDetected:
 *           type: boolean
 *         proposal:
 *           type: object
 *           properties:
 *             customPrice:
 *               type: number
 *             paymentMilestones:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   title:
 *                     type: string
 *                   percentage:
 *                     type: number
 *                   amount:
 *                     type: number
 *             lineItems:
 *               type: array
 *               items:
 *                 type: string
 *             vendorNotes:
 *               type: string
 *             submittedAt:
 *               type: string
 *               format: date-time
 */

// ============================================================
//  ENQUIRY CRUD
// ============================================================

/**
 * @swagger
 * /api/enquiries/vendor/{vendorId}:
 *   post:
 *     summary: Create a new enquiry
 *     description: Creates a customer enquiry for the vendor with event details and budget.
 *     tags: [Enquiries]
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
 *             required: [customer, eventDate]
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
 *                   email:
 *                     type: string
 *               eventType:
 *                 type: string
 *                 example: "Corporate Party"
 *               eventDate:
 *                 type: string
 *                 format: date
 *                 example: "2026-10-16"
 *               startTime:
 *                 type: string
 *                 example: "4:00 PM"
 *               endTime:
 *                 type: string
 *                 example: "8:00 PM"
 *               budgetMin:
 *                 type: number
 *                 example: 250000
 *               budgetMax:
 *                 type: number
 *                 example: 400000
 *               requests:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["Live Station", "Chat counter"]
 *               matchStrength:
 *                 type: string
 *                 enum: [Strong, Good, Weak]
 *                 example: "Strong"
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Enquiry created
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Vendor not found
 *       500:
 *         description: Server error
 */
router.post("/vendor/:vendorId", createEnquiry);

/**
 * @swagger
 * /api/enquiries/vendor/{vendorId}:
 *   get:
 *     summary: Get vendor enquiries (filtered, paginated)
 *     description: Returns enquiries annotated with conflict detection flags.
 *     tags: [Enquiries]
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
 *           enum: [NewEnquiry, AwaitingResponse, ProposalSent, Converted, Declined]
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
 *         description: Enquiries retrieved
 *       404:
 *         description: Vendor not found
 *       500:
 *         description: Server error
 */
router.get("/vendor/:vendorId", getVendorEnquiries);

/**
 * @swagger
 * /api/enquiries/{enquiryId}:
 *   get:
 *     summary: Get a single enquiry by ID
 *     description: Supports both MongoDB _id and human-readable enquiryId (ENQ...).
 *     tags: [Enquiries]
 *     parameters:
 *       - in: path
 *         name: enquiryId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Enquiry found
 *       404:
 *         description: Enquiry not found
 *       500:
 *         description: Server error
 */
router.get("/:enquiryId", getEnquiryById);

// ============================================================
//  STATUS MANAGEMENT
// ============================================================

/**
 * @swagger
 * /api/enquiries/{enquiryId}/status:
 *   put:
 *     summary: Update enquiry status
 *     description: |
 *       Transitions the enquiry status. Cannot update enquiries with
 *       terminal statuses (Converted, Declined).
 *     tags: [Enquiries]
 *     parameters:
 *       - in: path
 *         name: enquiryId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [NewEnquiry, AwaitingResponse, ProposalSent, Converted, Declined]
 *                 example: "AwaitingResponse"
 *     responses:
 *       200:
 *         description: Status updated
 *       400:
 *         description: Invalid status or terminal status
 *       404:
 *         description: Enquiry not found
 *       500:
 *         description: Server error
 */
router.put("/:enquiryId/status", updateEnquiryStatus);

/**
 * @swagger
 * /api/enquiries/{enquiryId}/proposal:
 *   put:
 *     summary: Send proposal details for an enquiry
 *     description: |
 *       Saves custom price, payment milestones, line items, and vendor notes,
 *       and sets status to "ProposalSent".
 *     tags: [Enquiries]
 *     parameters:
 *       - in: path
 *         name: enquiryId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customPrice, paymentMilestones, lineItems]
 *             properties:
 *               customPrice:
 *                 type: number
 *                 example: 300000
 *               paymentMilestones:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [title, percentage, amount]
 *                   properties:
 *                     title:
 *                       type: string
 *                     percentage:
 *                       type: number
 *                     amount:
 *                       type: number
 *               lineItems:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["Starter: Paneer Tikka", "Main: Dal Makhani"]
 *               vendorNotes:
 *                 type: string
 *                 example: "Taxes extra as applicable..."
 *     responses:
 *       200:
 *         description: Proposal sent successfully
 *       400:
 *         description: Invalid input or enquiry is in a terminal status
 *       404:
 *         description: Enquiry not found
 *       500:
 *         description: Server error
 */
router.put("/:enquiryId/proposal", sendProposal);

/**
 * @swagger
 * /api/enquiries/{enquiryId}/convert:
 *   post:
 *     summary: Convert enquiry to booking
 *     description: |
 *       Creates a Booking from the enquiry data. Links the booking via
 *       `convertedBookingId` and sets enquiry status to "Converted".
 *       Requires a packageId to snapshot the package data.
 *     tags: [Enquiries]
 *     parameters:
 *       - in: path
 *         name: enquiryId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [packageId]
 *             properties:
 *               packageId:
 *                 type: string
 *                 example: "664a1b2c3d4e5f6a7b8c9d0e"
 *               paymentType:
 *                 type: string
 *                 enum: [FreeBooking, AdvancePaid, FullPaid]
 *                 default: "AdvancePaid"
 *               totalAmount:
 *                 type: number
 *               paymentMilestones:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     dueDate:
 *                       type: string
 *                       format: date
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Enquiry converted to booking
 *       400:
 *         description: Enquiry already converted or declined
 *       404:
 *         description: Enquiry or package not found
 *       500:
 *         description: Server error
 */
router.post("/:enquiryId/convert", convertEnquiryToBooking);

/**
 * @swagger
 * /api/enquiries/{enquiryId}/decline:
 *   put:
 *     summary: Decline an enquiry
 *     description: Sets enquiry status to "Declined". Cannot decline converted enquiries.
 *     tags: [Enquiries]
 *     parameters:
 *       - in: path
 *         name: enquiryId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Enquiry declined
 *       400:
 *         description: Cannot decline (already converted or declined)
 *       404:
 *         description: Enquiry not found
 *       500:
 *         description: Server error
 */
router.put("/:enquiryId/decline", declineEnquiry);

export default router;
