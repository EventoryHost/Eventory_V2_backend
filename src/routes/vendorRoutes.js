import express from "express";
const router = express.Router();
import {
  getAllVendors,
  createVendor,
  getVendorById,
  updateVendor,
  deleteVendor,
} from "../controllers/vendorController.js";

/**
 * @swagger
 * /api/vendors:
 *   get:
 *     summary: Get all vendors
 *     description: Retrieve a list of all vendors in the system.
 *     tags:
 *       - Vendors
 *     responses:
 *       200:
 *         description: A list of vendors
 *   post:
 *     summary: Create a new vendor
 *     description: Add a new vendor to the system.
 *     tags:
 *       - Vendors
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "+919876543210"
 *               pocName:
 *                 type: string
 *                 example: "John Doe"
 *     responses:
 *       201:
 *         description: Vendor created successfully
 */
router.route("/").get(getAllVendors).post(createVendor);

/**
 * @swagger
 * /api/vendors/{id}:
 *   get:
 *     summary: Get a single vendor
 *     description: Retrieve details of a specific vendor by their ID.
 *     tags:
 *       - Vendors
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Vendor ID
 *     responses:
 *       200:
 *         description: Vendor details
 *       404:
 *         description: Vendor not found
 *   patch:
 *     summary: Update a vendor
 *     description: Update specific fields of a vendor by ID.
 *     tags:
 *       - Vendors
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Vendor ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               pocName:
 *                 type: string
 *                 example: "Jane Doe"
 *               isVerified:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Vendor updated successfully
 *       404:
 *         description: Vendor not found
 *   delete:
 *     summary: Delete a vendor
 *     description: Remove a vendor from the system by ID.
 *     tags:
 *       - Vendors
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Vendor ID
 *     responses:
 *       200:
 *         description: Vendor deleted successfully
 *       404:
 *         description: Vendor not found
 */
router.route("/:id").get(getVendorById).patch(updateVendor).delete(deleteVendor);

export default router;
