import express from "express";
import {
  getCompare,
  addCompareItem,
  removeCompareItem,
  clearCompare,
  exportCompare,
} from "../controllers/customerCompareController.js";
import { protectCustomer } from "../middlewares/customerAuth.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { addCompareItemSchema, compareExportQuerySchema } from "../validators/customerCompareValidators.js";

const router = express.Router();

/**
 * Mounted at /api/customer/compare (src/routes/index.js) — Phase 2 Step 11.
 * Every route requires protectCustomer — compare is scoped to Phase 2
 * ("Personalization, requires auth") the same way Wishlist is; no guest/
 * anonymous compare exists, consistent with that phase boundary.
 */

/**
 * @swagger
 * /api/customer/compare:
 *   get:
 *     summary: Get the logged-in customer's current comparison
 *     tags: [Customer Compare]
 *     responses:
 *       200: { description: Normalized side-by-side comparison, up to 3 packages }
 *   delete:
 *     summary: Clear the comparison
 *     tags: [Customer Compare]
 *     responses:
 *       200: { description: Cleared }
 */
router.get("/", protectCustomer, getCompare);
router.delete("/", protectCustomer, clearCompare);

/**
 * @swagger
 * /api/customer/compare/export:
 *   get:
 *     summary: Export the comparison as JSON or CSV
 *     description: |
 *       "Print" is a frontend concern (the browser's print dialog against
 *       the rendered page); this endpoint only covers the "export" half —
 *       CSV triggers a file download, JSON returns the same shape as
 *       GET /api/customer/compare.
 *     tags: [Customer Compare]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, csv], default: json }
 *     responses:
 *       200: { description: Comparison data (JSON) or a CSV file download }
 *       400: { description: Comparison is empty }
 */
router.get("/export", protectCustomer, validateRequest(compareExportQuerySchema, "query"), exportCompare);

/**
 * @swagger
 * /api/customer/compare/items:
 *   post:
 *     summary: Add a package to the comparison (max 3, single vendorType per session)
 *     tags: [Customer Compare]
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
 *       201: { description: Added }
 *       404: { description: Package not found or not currently available }
 *       409: { description: Already in comparison, comparison full, or vendorType mismatch }
 */
router.post("/items", protectCustomer, validateRequest(addCompareItemSchema), addCompareItem);

/**
 * @swagger
 * /api/customer/compare/items/{packageId}:
 *   delete:
 *     summary: Remove one package from the comparison
 *     tags: [Customer Compare]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Removed }
 *       404: { description: That package isn't in the comparison }
 */
router.delete("/items/:packageId", protectCustomer, removeCompareItem);

export default router;
