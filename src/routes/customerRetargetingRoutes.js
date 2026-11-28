import express from "express";
import {
  getRetargetingPrompt,
  recordRetargetingImpression,
  dismissRetargeting,
  recordRetargetingClick,
} from "../controllers/customerRetargetingController.js";
import { protectCustomer } from "../middlewares/customerAuth.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { campaignIdParamsSchema, retargetingClickSchema } from "../validators/customerRetargetingValidators.js";

const router = express.Router();

/**
 * Mounted at /api/customer/retargeting (src/routes/index.js). Login
 * required: browsing history (ViewedItem) and checkouts are account data.
 */
router.use(protectCustomer);

/**
 * @swagger
 * /api/customer/retargeting:
 *   get:
 *     summary: The one personalized popup to show now, if any
 *     description: |
 *       Priority: ABANDONED_CHECKOUT (same payload as GET /api/customer/recovery)
 *       → RECENTLY_VIEWED (a package viewed but not checked out or booked)
 *       → SIMILAR_EVENTS (related live packages, rule-based). Customer-wide
 *       limits apply across all campaigns (minimum gap, pause after a
 *       dismissal, daily cap for browsing popups). Booked packages and
 *       unavailable packages are never suggested.
 *     tags: [Customer Retargeting]
 *     responses:
 *       200: { description: "{ prompt: { campaign, id, ... } | null }" }
 *       401: { description: Not logged in }
 */
router.get("/", getRetargetingPrompt);

/**
 * @swagger
 * /api/customer/retargeting/{campaignId}/impression:
 *   post:
 *     summary: Record that a browsing popup was shown (once per cooldown window)
 *     tags: [Customer Retargeting]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Recorded }
 *       404: { description: Not found or not owned by this customer }
 * /api/customer/retargeting/{campaignId}/dismiss:
 *   post:
 *     summary: Dismiss a browsing popup ("Not now")
 *     tags: [Customer Retargeting]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Dismissed }
 *       404: { description: Not found or not owned by this customer }
 * /api/customer/retargeting/{campaignId}/click:
 *   post:
 *     summary: Record a CTA click ("Explore Event" / a recommendation)
 *     tags: [Customer Retargeting]
 *     parameters:
 *       - { in: path, name: campaignId, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               packageId: { type: string, description: "The package clicked — recorded only if the popup showed it" }
 *     responses:
 *       200: { description: Recorded }
 *       404: { description: Not found or not owned by this customer }
 */
const params = validateRequest(campaignIdParamsSchema, "params");
router.post("/:campaignId/impression", params, recordRetargetingImpression);
router.post("/:campaignId/dismiss", params, dismissRetargeting);
router.post("/:campaignId/click", params, validateRequest(retargetingClickSchema), recordRetargetingClick);

export default router;
