import express from "express";
import {
  getRecoveryPrompt,
  recordRecoveryImpression,
  dismissRecovery,
  resumeRecovery,
} from "../controllers/customerRecoveryController.js";
import { protectCustomer } from "../middlewares/customerAuth.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { recoveryIdParamsSchema } from "../validators/customerRecoveryValidators.js";

const router = express.Router();

/**
 * Mounted at /api/customer/recovery (src/routes/index.js). Abandoned-checkout
 * recovery prompt ("Still interested? Your booking is waiting!"). Login
 * required — checkout itself requires login, so there is no anonymous
 * checkout to recover.
 */
router.use(protectCustomer);

/**
 * @swagger
 * /api/customer/recovery:
 *   get:
 *     summary: The abandoned-checkout reminder to show now, if any
 *     description: |
 *       Returns `recovery: null` unless the customer has an abandoned checkout
 *       that is past the inactivity window, inside the max age, not completed,
 *       cancelled or paid, has no payment still in flight, has at least one
 *       package still Live with a future event date, and is not inside a
 *       dismissal/impression cooldown. Package name and image are read live;
 *       no price is returned (it is re-locked on resume).
 *     tags: [Customer Recovery]
 *     responses:
 *       200: { description: "{ recovery: object | null }" }
 *       401: { description: Not logged in }
 */
router.get("/", getRecoveryPrompt);

/**
 * @swagger
 * /api/customer/recovery/{recoveryId}/impression:
 *   post:
 *     summary: Record that the reminder was shown (counted once per cooldown window)
 *     tags: [Customer Recovery]
 *     parameters:
 *       - { in: path, name: recoveryId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Recorded (or already counted) }
 *       404: { description: Not found or not owned by this customer }
 */
router.post("/:recoveryId/impression", validateRequest(recoveryIdParamsSchema, "params"), recordRecoveryImpression);

/**
 * @swagger
 * /api/customer/recovery/{recoveryId}/dismiss:
 *   post:
 *     summary: Dismiss the reminder ("Not now")
 *     description: Starts the dismissal cooldown; retires the reminder once the dismissal cap is reached.
 *     tags: [Customer Recovery]
 *     parameters:
 *       - { in: path, name: recoveryId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Dismissed }
 *       404: { description: Not found or not owned by this customer }
 */
router.post("/:recoveryId/dismiss", validateRequest(recoveryIdParamsSchema, "params"), dismissRecovery);

/**
 * @swagger
 * /api/customer/recovery/{recoveryId}/resume:
 *   post:
 *     summary: Continue the abandoned booking
 *     description: |
 *       Re-validates payment state, package availability and the cart, then
 *       returns where to go. action "checkout" with a checkoutSessionId means
 *       the original session is still live; with null, the cart selection was
 *       restored and the checkout page builds a fresh, re-priced session.
 *       action "package" means restart from that package's page.
 *     tags: [Customer Recovery]
 *     parameters:
 *       - { in: path, name: recoveryId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "{ resume: { action, checkoutSessionId?, packageId?, unavailableItemCount } }" }
 *       404: { description: Not found or not owned by this customer }
 *       409: { description: "PAYMENT_PENDING or ALREADY_BOOKED" }
 *       410: { description: "RECOVERY_UNAVAILABLE — expired, cancelled or nothing left to book" }
 */
router.post("/:recoveryId/resume", validateRequest(recoveryIdParamsSchema, "params"), resumeRecovery);

export default router;
