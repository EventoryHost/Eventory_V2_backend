import express from "express";
const router = express.Router();
import {
  createTemplate,
  getSharedTemplates,
  getVendorTemplates,
  getTemplateById,
  deleteTemplate,
} from "../controllers/templateController.js";

/**
 * @swagger
 * tags:
 *   name: Templates
 *   description: |
 *     Package templates — a shared catalog of saved packages.
 *     Every vendor's templates are visible to all vendors ("All Templates"),
 *     while "My Templates" scopes to the ones a vendor created.
 *     A template stores an immutable snapshot of the source package group
 *     (all of its variants) in `data.packages`, used to restore a new draft.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Template:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         packageName:
 *           type: string
 *         note:
 *           type: string
 *         coverImageUrl:
 *           type: string
 *         vendorTypeLabel:
 *           type: string
 *           enum: [CATERER, DECORATOR, PAV, DJ ARTIST, MAKEUP ARTIST, VENUE]
 *         ownerVendorId:
 *           type: string
 *           description: The owning vendor's human-readable id (e.g. "VEN...")
 *         ownerName:
 *           type: string
 *         sourcePackageId:
 *           type: string
 *         data:
 *           type: object
 *           description: "Snapshot of the package group: { packages: [PackageBase, ...] }"
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/templates/vendor/{vendorId}:
 *   post:
 *     summary: Save a package as a template
 *     description: |
 *       Snapshots the source package and all of its sibling variants (same
 *       vendor + package name, excluding deleted) into a new template owned by
 *       the given vendor. `packageName`, `coverImageUrl` and `vendorTypeLabel`
 *       are derived from the package when not supplied.
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Vendor ObjectId or custom "VEN..." id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sourcePackageId]
 *             properties:
 *               sourcePackageId:
 *                 type: string
 *               note:
 *                 type: string
 *               packageName:
 *                 type: string
 *               coverImageUrl:
 *                 type: string
 *               vendorTypeLabel:
 *                 type: string
 *     responses:
 *       201:
 *         description: Template created
 *       400:
 *         description: Missing sourcePackageId
 *       404:
 *         description: Vendor or source package not found
 *       500:
 *         description: Server error
 */
router.post("/vendor/:vendorId", createTemplate);

/**
 * @swagger
 * /api/templates:
 *   get:
 *     summary: Get the shared template catalog
 *     description: Returns every vendor's templates, newest first.
 *     tags: [Templates]
 *     responses:
 *       200:
 *         description: List of templates
 *       500:
 *         description: Server error
 */
router.get("/", getSharedTemplates);

/**
 * @swagger
 * /api/templates/vendor/{vendorId}:
 *   get:
 *     summary: Get templates owned by a vendor
 *     description: Returns an empty list when the vendor does not exist.
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *         description: Vendor ObjectId or custom "VEN..." id
 *     responses:
 *       200:
 *         description: List of templates
 *       500:
 *         description: Server error
 */
router.get("/vendor/:vendorId", getVendorTemplates);

/**
 * @swagger
 * /api/templates/{id}:
 *   get:
 *     summary: Get a single template by ID
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Template found
 *       404:
 *         description: Template not found
 *       500:
 *         description: Server error
 */
router.get("/:id", getTemplateById);

/**
 * @swagger
 * /api/templates/{id}:
 *   delete:
 *     summary: Delete a template
 *     description: Hard-deletes the template. The source package is untouched.
 *     tags: [Templates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Template deleted
 *       404:
 *         description: Template not found
 *       500:
 *         description: Server error
 */
router.delete("/:id", deleteTemplate);

export default router;
