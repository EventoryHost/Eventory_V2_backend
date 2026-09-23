import express from "express";
import {
  getViewedItems,
  recordViewedItem,
  removeViewedItem,
  clearViewedItems,
} from "../controllers/customerViewedController.js";
import { protectCustomer } from "../middlewares/customerAuth.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { recordViewedItemSchema } from "../validators/customerValidators.js";

const router = express.Router();

/**
 * Mounted at /api/customer/viewed (src/routes/index.js) — backs the account
 * dashboard's "Viewed Items" tile and the Viewed Items page. Every route is
 * scoped to the authenticated customer.
 */

/**
 * @swagger
 * /api/customer/viewed:
 *   get:
 *     summary: The customer's recently viewed packages, newest first
 *     tags: [Customer Viewed Items]
 *     responses:
 *       200: { description: Viewed packages with live package data populated }
 *   post:
 *     summary: Record that the customer opened a package (idempotent upsert)
 *     tags: [Customer Viewed Items]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [packageId]
 *             properties:
 *               packageId: { type: string }
 *     responses:
 *       200: { description: View recorded; viewedAt bumped if already present }
 *   delete:
 *     summary: Clear the whole viewed list
 *     tags: [Customer Viewed Items]
 *     responses:
 *       200: { description: Cleared }
 */
router
  .route("/")
  .get(protectCustomer, getViewedItems)
  .post(protectCustomer, validateRequest(recordViewedItemSchema), recordViewedItem)
  .delete(protectCustomer, clearViewedItems);

/**
 * @swagger
 * /api/customer/viewed/{itemId}:
 *   delete:
 *     summary: Remove a single viewed item
 *     tags: [Customer Viewed Items]
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Removed }
 *       404: { description: Not found, or not this customer's }
 */
router.delete("/:itemId", protectCustomer, removeViewedItem);

export default router;
