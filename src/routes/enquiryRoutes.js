import express from "express";
const router = express.Router();
import {
  createEnquiry,
  getVendorEnquiries,
  getEnquiryById,
  updateEnquiryStatus,
  requestEnquiryChanges,
  updateEnquiry,
  convertEnquiryToBooking,
  declineEnquiry,
  sendProposal,
  saveDraft,
} from "../controllers/enquiryController.js";

/**
 * @swagger
 * tags:
 *   name: Enquiries
 *   description: |
 *     Vendor enquiry management. Customers send enquiries before booking.
 *     Enquiries flow through: NewEnquiry → Viewed → InDiscussion → AwaitingResponse
 *     → ProposalSent → Converted/Declined.
 *
 *     An enquiry negotiates over the same shapes a booking does — a package
 *     snapshot with per-vendor-type deliverables, change requests the vendor
 *     accepts or rejects, and cumulative pricing rows — so converting one to a
 *     booking carries everything across.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     EnquiryChangeRequest:
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
 *         item:
 *           type: string
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
 *     EnquiryAttachment:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         name:
 *           type: string
 *         url:
 *           type: string
 *         contentType:
 *           type: string
 *         sizeBytes:
 *           type: number
 *     EnquiryPricing:
 *       type: object
 *       description: |
 *         Vendor-authored pricing. One cumulative figure per breakdown row —
 *         the vendor prices the whole set of additions, not each item. All
 *         amounts are positive magnitudes; the breakdown applies the sign.
 *       properties:
 *         basePrice:
 *           type: number
 *           description: Overrides packageSnapshot.price when negotiated separately.
 *         itemsAdded:
 *           type: number
 *         addonsAdded:
 *           type: number
 *         itemsRemoved:
 *           type: number
 *         addonsRemoved:
 *           type: number
 *         discountAmount:
 *           type: number
 *         discountLabel:
 *           type: string
 *         taxRatePct:
 *           type: number
 *         taxLabel:
 *           type: string
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
 *         vendorType:
 *           type: string
 *           description: Drives the per-vendor-type requirement layout.
 *           enum: [VenueProvider, DJArtist, Decorator, Caterer, PAV, MakeupArtist]
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
 *         location:
 *           type: string
 *         mapLink:
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
 *           enum: [NewEnquiry, Viewed, InDiscussion, AwaitingResponse, ProposalSent, Converted, Declined]
 *         convertedBookingId:
 *           type: string
 *         notes:
 *           type: string
 *         receivedAt:
 *           type: string
 *           format: date-time
 *         respondByAt:
 *           type: string
 *           format: date-time
 *           description: Backs the "N hrs left to respond" countdown.
 *         viewedAt:
 *           type: string
 *           format: date-time
 *         proposalSentAt:
 *           type: string
 *           format: date-time
 *         convertedAt:
 *           type: string
 *           format: date-time
 *         declinedAt:
 *           type: string
 *           format: date-time
 *         declineReason:
 *           type: string
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
 *         packageId:
 *           type: string
 *         packageSnapshot:
 *           type: object
 *           description: The package as quoted, including per-vendor-type deliverables.
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
 *             gstRatePercent:
 *               type: number
 *             gstInclusive:
 *               type: boolean
 *             deliverables:
 *               type: object
 *         primaryPackage:
 *           type: object
 *           deprecated: true
 *           description: Derived from packageSnapshot for older clients.
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
 *             $ref: '#/components/schemas/EnquiryAttachment'
 *         priority:
 *           type: string
 *           enum: [High, Medium, Low]
 *         eventImageUrl:
 *           type: string
 *         conflictDetected:
 *           type: boolean
 *         changeRequests:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/EnquiryChangeRequest'
 *         priceEnquiry:
 *           type: object
 *           description: Present when the customer questioned the price rather than the contents.
 *           properties:
 *             answers:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   question:
 *                     type: string
 *                     example: "Expected budget"
 *                   answer:
 *                     type: string
 *                     example: "₹35,000 – ₹50,000"
 *             customerNote:
 *               type: string
 *         pricing:
 *           $ref: '#/components/schemas/EnquiryPricing'
 *         totalAmount:
 *           type: number
 *           description: Derived from pricingBreakdown.finalAmount.
 *         pricingBreakdown:
 *           type: object
 *           description: Derived, never stored. The rows the breakdown card renders.
 *           properties:
 *             originalPackagePrice:
 *               type: number
 *             additions:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   key:
 *                     type: string
 *                   label:
 *                     type: string
 *                   amount:
 *                     type: number
 *             deductions:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   key:
 *                     type: string
 *                   label:
 *                     type: string
 *                   amount:
 *                     type: number
 *             subtotal:
 *               type: number
 *             tax:
 *               type: object
 *               properties:
 *                 label:
 *                   type: string
 *                 ratePct:
 *                   type: number
 *                 amount:
 *                   type: number
 *             finalAmount:
 *               type: number
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
 *                   dueDate:
 *                     type: string
 *                     format: date
 *                   status:
 *                     type: string
 *                     enum: [Pending, PaymentDue, Received]
 *             lineItems:
 *               type: array
 *               items:
 *                 type: string
 *             customAddons:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   qty:
 *                     type: number
 *                   price:
 *                     type: number
 *             vendorNotes:
 *               type: string
 *             terms:
 *               type: string
 *             attachments:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/EnquiryAttachment'
 *             mediaUrls:
 *               type: array
 *               items:
 *                 type: string
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
 *     description: |
 *       Creates a customer enquiry for the vendor. When `packageId` is given the
 *       package is snapshotted onto the enquiry — including its per-vendor-type
 *       deliverables — so requested changes can point at what was quoted.
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
 *               packageId:
 *                 type: string
 *                 example: "664a1b2c3d4e5f6a7b8c9d0e"
 *               vendorType:
 *                 type: string
 *                 description: Defaults to the package's vendorType when packageId is given.
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
 *               location:
 *                 type: string
 *                 example: "Guwahati, Assam"
 *               mapLink:
 *                 type: string
 *               venueName:
 *                 type: string
 *                 example: "Grand Hyatt Ballroom"
 *               budgetMin:
 *                 type: number
 *                 example: 250000
 *               budgetMax:
 *                 type: number
 *                 example: 400000
 *               guestCountMin:
 *                 type: number
 *                 example: 120
 *               guestCountMax:
 *                 type: number
 *                 example: 120
 *               requests:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["Live Station", "Chat counter"]
 *               changes:
 *                 type: array
 *                 description: Items the customer wants added or removed from the package.
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
 *                       example: "Brand"
 *                     item:
 *                       type: string
 *                       example: "MAC"
 *                     qty:
 *                       type: number
 *               priceEnquiry:
 *                 type: object
 *                 properties:
 *                   answers:
 *                     type: array
 *                     items:
 *                       type: object
 *                       required: [question]
 *                       properties:
 *                         question:
 *                           type: string
 *                           example: "What feels overpriced in the package"
 *                         answer:
 *                           type: string
 *                   customerNote:
 *                     type: string
 *               attachments:
 *                 type: array
 *                 description: Objects, or bare URL strings which are normalised.
 *                 items:
 *                   type: object
 *                   required: [name]
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: "Moodboard.pdf"
 *                     url:
 *                       type: string
 *                     contentType:
 *                       type: string
 *                     sizeBytes:
 *                       type: number
 *                       example: 2516582
 *               matchStrength:
 *                 type: string
 *                 enum: [Strong, Good, Weak]
 *                 example: "Strong"
 *               priority:
 *                 type: string
 *                 enum: [High, Medium, Low]
 *               respondByAt:
 *                 type: string
 *                 format: date-time
 *                 description: Defaults to 24 hours from creation.
 *               customerMessage:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Enquiry created
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Vendor or package not found
 *       500:
 *         description: Server error
 */
router.post("/vendor/:vendorId", createEnquiry);

/**
 * @swagger
 * /api/enquiries/vendor/{vendorId}:
 *   get:
 *     summary: Get vendor enquiries (filtered, paginated)
 *     description: |
 *       Returns enquiries annotated with conflict detection flags and the
 *       derived pricing breakdown.
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
 *           enum: [NewEnquiry, Viewed, InDiscussion, AwaitingResponse, ProposalSent, Converted, Declined]
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
 *       terminal statuses (Converted, Declined). Moving to "Viewed" stamps
 *       `viewedAt` the first time.
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
 *                 enum: [NewEnquiry, Viewed, InDiscussion, AwaitingResponse, ProposalSent, Converted, Declined]
 *                 example: "Viewed"
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

// ============================================================
//  NEGOTIATION
// ============================================================

/**
 * @swagger
 * /api/enquiries/{enquiryId}/change-requests:
 *   post:
 *     summary: Submit the customer's requested package changes
 *     description: |
 *       Each change points at a deliverable in the package snapshot, so a
 *       request always refers to what the customer was actually quoted.
 *       Requests land as Pending and carry no weight in the pricing until the
 *       vendor accepts them. Moves a pre-proposal enquiry to "InDiscussion".
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
 *             required: [changes]
 *             properties:
 *               changes:
 *                 type: array
 *                 minItems: 1
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
 *                       default: Item
 *                     category:
 *                       type: string
 *                       example: "Hair Dye Color"
 *                     item:
 *                       type: string
 *                       example: "Natural Brown"
 *                     qty:
 *                       type: number
 *                       default: 1
 *     responses:
 *       201:
 *         description: Change requests submitted
 *       400:
 *         description: Validation failed or enquiry is in a terminal status
 *       404:
 *         description: Enquiry not found
 *       500:
 *         description: Server error
 */
router.post("/:enquiryId/change-requests", requestEnquiryChanges);

/**
 * @swagger
 * /api/enquiries/{enquiryId}:
 *   put:
 *     summary: Apply the vendor's edits while customising a proposal
 *     description: |
 *       Saves the accept/reject decisions and the pricing they were agreed at in
 *       one call, so a half-applied edit is not reachable. Sending the proposal
 *       is a separate, explicit step.
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
 *             properties:
 *               changeRequests:
 *                 type: array
 *                 description: The vendor's decision on each requested change.
 *                 items:
 *                   type: object
 *                   required: [id]
 *                   properties:
 *                     id:
 *                       type: string
 *                       description: The change request's _id.
 *                     status:
 *                       type: string
 *                       enum: [Pending, Accepted, Rejected]
 *                     qty:
 *                       type: number
 *               pricing:
 *                 $ref: '#/components/schemas/EnquiryPricing'
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Enquiry updated
 *       400:
 *         description: Validation failed or enquiry is in a terminal status
 *       404:
 *         description: Enquiry or change request not found
 *       500:
 *         description: Server error
 */
router.put("/:enquiryId", updateEnquiry);

/**
 * @swagger
 * /api/enquiries/{enquiryId}/proposal:
 *   put:
 *     summary: Send proposal details for an enquiry
 *     description: |
 *       Freezes the pricing rows into `totalAmount`, saves the milestones, line
 *       items, custom add-ons, terms and media, and sets status to
 *       "ProposalSent". `customPrice` defaults to the breakdown's final amount.
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
 *             properties:
 *               pricing:
 *                 $ref: '#/components/schemas/EnquiryPricing'
 *               customPrice:
 *                 type: number
 *                 description: Overrides the breakdown's final amount.
 *                 example: 355800
 *               paymentMilestones:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [title, amount]
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
 *               lineItems:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["Starter: Paneer Tikka", "Main: Dal Makhani"]
 *               customAddons:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [name]
 *                   properties:
 *                     name:
 *                       type: string
 *                       example: "Drone Coverage"
 *                     qty:
 *                       type: number
 *                     price:
 *                       type: number
 *               vendorNotes:
 *                 type: string
 *                 example: "Taxes extra as applicable..."
 *               terms:
 *                 type: string
 *               attachments:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/EnquiryAttachment'
 *               mediaUrls:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Proposal sent successfully
 *       400:
 *         description: Validation failed or enquiry is in a terminal status
 *       404:
 *         description: Enquiry not found
 *       500:
 *         description: Server error
 */
router.put("/:enquiryId/proposal", sendProposal);

/**
 * @swagger
 * /api/enquiries/{enquiryId}/draft:
 *   put:
 *     summary: Save a proposal draft without sending
 *     description: Saves the customiseData and proposal fields without changing status.
 *     tags: [Enquiries]
 *     parameters:
 *       - in: path
 *         name: enquiryId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Draft saved successfully
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Enquiry not found
 */
router.put("/:enquiryId/draft", saveDraft);

/**
 * @swagger
 * /api/enquiries/{enquiryId}/convert:
 *   post:
 *     summary: Convert enquiry to booking
 *     description: |
 *       Creates a Booking from the enquiry, carrying across the package
 *       snapshot, the change requests with their decisions, and the pricing —
 *       so the price the customer accepted is the price the booking opens at.
 *       Links the booking via `convertedBookingId` and sets enquiry status to
 *       "Converted". `packageId` defaults to the enquiry's own.
 *     tags: [Enquiries]
 *     parameters:
 *       - in: path
 *         name: enquiryId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
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
 *                 description: Overrides the amount derived from the carried-over pricing.
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
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Enquiry converted to booking
 *       400:
 *         description: Enquiry already converted, declined, or missing an eventDate/packageId
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
