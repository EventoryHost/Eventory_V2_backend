import express from "express";
import { getGroundView } from "../controllers/eventDayController.js";
import { groundLinkLimiter } from "../middlewares/rateLimiters.js";

const router = express.Router();

/**
 * Mounted at /api/ground (src/routes/index.js). Public, no auth: backs the
 * page a vendor's on-ground contact opens from the link the vendor shares
 * (eventory.in/g/:code). The random code is the only key.
 */

/**
 * @swagger
 * tags:
 *   name: Ground Contact
 *   description: Public, read-only event-day view for a vendor's on-ground contact.
 */

/**
 * @swagger
 * /api/ground/{code}:
 *   get:
 *     summary: Read-only event-day view for an on-ground contact's link
 *     description: |
 *       No auth — the unguessable code (Booking.groundStaff.code) is the
 *       only key, and it stops working once the vendor removes or replaces
 *       the contact. Never returns the customer's phone/email, pricing or
 *       payment state, the vendor, or the booking's ids.
 *     tags: [Ground Contact]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The event-day view
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: SUCCESS }
 *                 ground:
 *                   type: object
 *                   properties:
 *                     customerFirstName: { type: string, nullable: true }
 *                     eventType: { type: string, nullable: true }
 *                     eventDate: { type: string, format: date-time }
 *                     startTime: { type: string, nullable: true, example: "18:00" }
 *                     endTime: { type: string, nullable: true, example: "23:30" }
 *                     location: { type: string, nullable: true }
 *                     mapLink: { type: string, nullable: true }
 *                     status: { type: string, example: Confirmed }
 *                     groundStaffName: { type: string, nullable: true }
 *                     checkedInAt: { type: string, format: date-time, nullable: true }
 *                     setupCompletedAt: { type: string, format: date-time, nullable: true }
 *                     teardownCompletedAt: { type: string, format: date-time, nullable: true }
 *                     setupPhotos: { type: array, items: { type: string } }
 *                     dayRequests:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/DayRequest'
 *       404: { description: Unknown or removed code }
 *       429: { description: Too many requests }
 */
router.get("/:code", groundLinkLimiter, getGroundView);

export default router;
