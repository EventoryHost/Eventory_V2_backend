import express from "express";
const router = express.Router();
import {
  handleRedirect,
  getRedirectConfig,
  updateRedirectConfig,
} from "../controllers/redirectController.js";

/**
 * @swagger
 * tags:
 *   name: Redirect
 *   description: |
 *     Dynamic QR redirect. One printed QR code points permanently at
 *     GET /api/redirect; the destination is stored in MongoDB under
 *     _id "main" and can be changed at any time without reprinting.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Redirect:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: main
 *         destinationUrl:
 *           type: string
 *           example: https://wa.me/918800725840
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/redirect:
 *   get:
 *     summary: Redirect a QR scan to the current destination URL
 *     tags: [Redirect]
 *     responses:
 *       302:
 *         description: Redirect to the currently configured destination URL.
 *         headers:
 *           Location:
 *             schema:
 *               type: string
 *             description: The destination URL.
 *       404:
 *         description: Redirect destination not configured.
 *       500:
 *         description: Server error.
 */
router.get("/", handleRedirect);

/**
 * @swagger
 * /api/redirect/config:
 *   get:
 *     summary: Get the current redirect destination
 *     tags: [Redirect]
 *     responses:
 *       200:
 *         description: Current redirect configuration.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 redirect:
 *                   $ref: '#/components/schemas/Redirect'
 *       404:
 *         description: Redirect destination not configured.
 *   put:
 *     summary: Create or update the redirect destination
 *     tags: [Redirect]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [destinationUrl]
 *             properties:
 *               destinationUrl:
 *                 type: string
 *                 example: https://www.instagram.com/eventory
 *     responses:
 *       200:
 *         description: Redirect destination updated.
 *       400:
 *         description: Invalid or missing destinationUrl.
 */
router.get("/config", getRedirectConfig);
router.put("/config", updateRedirectConfig);

export default router;
