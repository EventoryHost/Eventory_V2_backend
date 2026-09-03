import express from "express";
import {
  createCheckoutSession,
  getCheckoutSession,
  updateCheckoutLine,
  removeCheckoutLine,
  cancelCheckoutSession,
  updateContactDetails,
} from "../controllers/customerCheckoutController.js";
import { protectCustomer } from "../middlewares/customerAuth.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import {
  createCheckoutSessionSchema,
  updateCheckoutLineSchema,
  updateContactDetailsSchema,
} from "../validators/customerCheckoutValidators.js";

const router = express.Router();

/**
 * Mounted at /api/customer/checkout (src/routes/index.js) — Phase 4 Steps
 * 15-17. Every route requires protectCustomer — checkout has no guest
 * equivalent (unlike Cart), matching the final BRD's phone/contact
 * requirements at this point in the funnel.
 */
router.use(protectCustomer);

/**
 * @swagger
 * /api/customer/checkout/session:
 *   post:
 *     summary: Create a checkout session (Phase 4 Step 15)
 *     description: |
 *       source:"cart" pulls the customer's currently-selected cart items.
 *       source:"direct" is a one-off "Book Now" purchase from the PDP that
 *       never touched the cart (packageId required in that case). Either
 *       way every line is re-validated (Live status + capacity) and the
 *       price is LOCKED using the same pricing engine as the Cart quote —
 *       this locked price is what actually gets charged later in Phase 4,
 *       not whatever the live package price happens to be at payment time.
 *       Expires in 30 minutes (final BRD Sections 11/19), sliding forward
 *       on every edit.
 *     tags: [Customer Checkout]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [source]
 *             properties:
 *               source: { type: string, enum: [cart, direct] }
 *               packageId: { type: string, description: "Required when source=direct" }
 *               guests: { type: integer }
 *               date: { type: string, format: date }
 *               timeSlot: { type: string }
 *               location: { type: string }
 *               selectedAddOns: { type: array, items: { type: object } }
 *               selectedItems: { type: array, items: { type: object } }
 *               specialRequest: { type: string, maxLength: 500 }
 *               noteAttachments:
 *                 type: array
 *                 maxItems: 5
 *                 items: { type: string, format: uri, maxLength: 2000 }
 *                 description: Real S3/CloudFront URLs only, uploaded client-side first — never a data:/base64 URI
 *               quantity: { type: integer, default: 1 }
 *     responses:
 *       201: { description: Session created, with lockedQuote + per-line availability + readyForPayment }
 *       400: { description: Empty cart / guests outside capacity / invalid input }
 *       404: { description: Package not found or not currently available }
 */
router.post("/session", validateRequest(createCheckoutSessionSchema), createCheckoutSession);

/**
 * @swagger
 * /api/customer/checkout/session/{sessionId}:
 *   get:
 *     summary: Get a checkout session (booking breakdown) — Phase 4 Step 16
 *     description: |
 *       Returns the LOCKED quote (what will be charged) plus a freshly
 *       recomputed per-line availability check (availability is always
 *       live, unlike price — see Step 15's description).
 *     tags: [Customer Checkout]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Session + fresh availability + readyForPayment }
 *       404: { description: Not found (or not owned by this customer) }
 *   delete:
 *     summary: Cancel a checkout session
 *     tags: [Customer Checkout]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Cancelled }
 *       404: { description: Not found }
 */
router.get("/session/:sessionId", getCheckoutSession);
router.delete("/session/:sessionId", cancelCheckoutSession);

/**
 * @swagger
 * /api/customer/checkout/session/{sessionId}/contact:
 *   patch:
 *     summary: Capture/edit contact details — Phase 4 Step 17
 *     description: |
 *       Only fields sent are touched. Setting a phone here does NOT verify
 *       it — verification only happens through the existing Phase 0 OTP
 *       flow (POST /api/customer/phone/send-otp + /verify-otp). The
 *       response's validation.contact.phoneVerified reflects the CURRENT
 *       live state of the customer's account, so verifying elsewhere and
 *       then re-fetching this session (GET) shows the up-to-date result.
 *     tags: [Customer Checkout]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, minLength: 2, maxLength: 100 }
 *               phone: { type: string, description: "10-digit Indian mobile" }
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: Updated, full session + validation returned }
 *       400: { description: Invalid shape, or no field provided }
 *       404: { description: Session not found }
 *       410: { description: Session is no longer Active }
 */
router.patch("/session/:sessionId/contact", validateRequest(updateContactDetailsSchema), updateContactDetails);

/**
 * @swagger
 * /api/customer/checkout/session/{sessionId}/lines/{lineId}:
 *   patch:
 *     summary: Edit one line pre-payment — Phase 4 Step 16
 *     description: |
 *       Event details, add-ons, choose-N selections, special request,
 *       quantity, or switch to a sibling VARIANT of the same logical
 *       package via packageId (validated against packageGroupId — not a
 *       way to swap to an unrelated package). Re-locks the session's whole
 *       quote afterward and slides the 30-minute expiry forward.
 *     tags: [Customer Checkout]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: lineId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated, full session + availability returned }
 *       400: { description: Guests outside capacity, or packageId isn't a sibling variant }
 *       404: { description: Session or line not found }
 *       410: { description: Session is no longer Active (Expired/Completed/Cancelled) }
 *   delete:
 *     summary: Remove one line pre-payment
 *     description: Cancels the whole session if it was the last remaining line.
 *     tags: [Customer Checkout]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: lineId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Removed (or session cancelled if that was the last line) }
 *       404: { description: Session or line not found }
 *       410: { description: Session is no longer Active }
 */
router.patch("/session/:sessionId/lines/:lineId", validateRequest(updateCheckoutLineSchema), updateCheckoutLine);
router.delete("/session/:sessionId/lines/:lineId", removeCheckoutLine);

export default router;
