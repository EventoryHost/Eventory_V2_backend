import express from "express";
import {
  addWishlistItem,
  getWishlist,
  updateWishlistItemNote,
  removeWishlistItem,
  clearWishlist,
  shareWishlist,
  unshareWishlist,
  getSharedWishlist,
} from "../controllers/customerWishlistController.js";
import { protectCustomer } from "../middlewares/customerAuth.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import {
  addWishlistItemSchema,
  updateWishlistNoteSchema,
  wishlistShareQuerySchema,
} from "../validators/customerWishlistValidators.js";

const router = express.Router();

/**
 * Mounted at /api/customer/wishlist (src/routes/index.js) — Phase 2 Step 10.
 * Every route below requires protectCustomer EXCEPT the shared-link read,
 * which is deliberately public (that's the entire point of a share link).
 */

/**
 * @swagger
 * /api/customer/wishlist:
 *   get:
 *     summary: Get the logged-in customer's wishlist
 *     tags: [Customer Wishlist]
 *     responses:
 *       200: { description: Wishlist items, Package items include a computed priceChanged flag }
 *       401: { description: Not authenticated }
 *   post:
 *     summary: Save a Package or Vendor to the wishlist
 *     tags: [Customer Wishlist]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [itemType]
 *             properties:
 *               itemType: { type: string, enum: [Package, Vendor] }
 *               packageId: { type: string, description: "Required when itemType is Package" }
 *               vendorId: { type: string, description: "Required when itemType is Vendor" }
 *               note: { type: string, maxLength: 500 }
 *     responses:
 *       201: { description: Added }
 *       404: { description: Package/Vendor not found or not currently available }
 *       409: { description: Already in wishlist }
 *   delete:
 *     summary: Clear the entire wishlist
 *     tags: [Customer Wishlist]
 *     responses:
 *       200: { description: Wishlist cleared }
 */
router.get("/", protectCustomer, getWishlist);
router.post("/", protectCustomer, validateRequest(addWishlistItemSchema), addWishlistItem);
router.delete("/", protectCustomer, clearWishlist);

/**
 * @swagger
 * /api/customer/wishlist/share:
 *   post:
 *     summary: Enable the wishlist share link (mints one on first use)
 *     tags: [Customer Wishlist]
 *     parameters:
 *       - in: query
 *         name: rotate
 *         schema: { type: boolean }
 *         description: Pass true to invalidate the old link and mint a new one
 *     responses:
 *       200: { description: shareToken + shareUrl }
 *   delete:
 *     summary: Disable the wishlist share link (token is kept, not cleared)
 *     tags: [Customer Wishlist]
 *     responses:
 *       200: { description: Sharing disabled }
 */
router.post("/share", protectCustomer, validateRequest(wishlistShareQuerySchema, "query"), shareWishlist);
router.delete("/share", protectCustomer, unshareWishlist);

/**
 * @swagger
 * /api/customer/wishlist/shared/{token}:
 *   get:
 *     summary: Public read of a shared wishlist (no auth)
 *     description: Personal notes are excluded from this view — see the controller for why.
 *     tags: [Customer Wishlist]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Owner name + wishlist items }
 *       404: { description: Link invalid or no longer shared }
 */
router.get("/shared/:token", getSharedWishlist);

/**
 * @swagger
 * /api/customer/wishlist/{itemId}:
 *   patch:
 *     summary: Update the note on a wishlist item
 *     tags: [Customer Wishlist]
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [note]
 *             properties:
 *               note: { type: string, maxLength: 500 }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Item not found (or not owned by this customer) }
 *   delete:
 *     summary: Remove one wishlist item
 *     tags: [Customer Wishlist]
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Removed }
 *       404: { description: Item not found (or not owned by this customer) }
 */
router.patch("/:itemId", protectCustomer, validateRequest(updateWishlistNoteSchema), updateWishlistItemNote);
router.delete("/:itemId", protectCustomer, removeWishlistItem);

export default router;
