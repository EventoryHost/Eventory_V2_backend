import express from "express";
import {
  getCart,
  getCartQuote,
  addCartItem,
  updateCartItem,
  removeCartItem,
  clearCart,
  moveCartItemToWishlist,
  applyCoupon,
  removeCoupon,
  setBookingNote,
  mergeGuestCart,
} from "../controllers/customerCartController.js";
import { protectCustomer, identifyCartOwner } from "../middlewares/customerAuth.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import {
  addCartItemSchema,
  updateCartItemSchema,
  applyCouponSchema,
} from "../validators/customerCartValidators.js";
import { z } from "zod";

const router = express.Router();

/**
 * Mounted at /api/customer/cart (src/routes/index.js) — Phase 3 Step 13.
 * Every route runs identifyCartOwner (soft auth: logged-in customer OR
 * guest via X-Guest-Cart-Id header/?guestCartId= — see customerAuth.js),
 * EXCEPT /merge and /move-to-wishlist, which are customer-only
 * (protectCustomer) since both require a real account to make sense.
 */

router.use(identifyCartOwner);

/**
 * @swagger
 * /api/customer/cart:
 *   get:
 *     summary: Get the current cart (customer or guest)
 *     description: Never creates a cart from a read — an identity with no cart yet gets an empty payload.
 *     tags: [Customer Cart]
 *     responses:
 *       200: { description: Cart grouped by vendor, with per-item revalidation and totals }
 *   delete:
 *     summary: Clear the entire cart (all items)
 *     tags: [Customer Cart]
 *     responses:
 *       200: { description: Cleared }
 */
router.get("/", getCart);

/**
 * @swagger
 * /api/customer/cart/quote:
 *   get:
 *     summary: Authoritative price/due-now quote for the cart's SELECTED items (Phase 3 Step 14)
 *     description: |
 *       Computed fresh from each package's live price/GST/token/milestone
 *       config, not the cart's display snapshot — the "single source of
 *       truth" quote. Only items with selectedForCheckout:true are priced.
 *       See src/services/cartPricingService.js for every honesty flag (no
 *       Coupon model yet, no hardcoded token %, no hardcoded convenience
 *       fee % unless CONVENIENCE_FEE_PERCENT is set in .env).
 *     tags: [Customer Cart]
 *     responses:
 *       200: { description: "quote: null if there's no cart or nothing selected; otherwise the full breakdown" }
 */
router.get("/quote", getCartQuote);
router.delete("/", clearCart);

/**
 * @swagger
 * /api/customer/cart/items:
 *   post:
 *     summary: Add a package to the cart
 *     description: |
 *       If the requester has no customer session and no X-Guest-Cart-Id
 *       header, a new guest cart is minted and its id returned as both
 *       `guestCartId` in the body and an `X-Guest-Cart-Id` response header
 *       — the client should store it and send it back on every subsequent
 *       cart request.
 *     tags: [Customer Cart]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [packageId]
 *             properties:
 *               packageId: { type: string }
 *               guests: { type: integer }
 *               date: { type: string, format: date }
 *               timeSlot: { type: string }
 *               location: { type: string }
 *               selectedAddOns:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties: { addOnId: { type: string }, name: { type: string }, price: { type: number }, quantity: { type: integer } }
 *               selectedItems:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties: { groupKey: { type: string }, itemId: { type: string }, itemName: { type: string }, price: { type: number }, isChargeable: { type: boolean } }
 *               specialRequest: { type: string, maxLength: 500 }
 *               noteAttachments:
 *                 type: array
 *                 maxItems: 5
 *                 items: { type: string, format: uri, maxLength: 2000 }
 *                 description: Real S3/CloudFront URLs only, uploaded client-side first — never a data:/base64 URI
 *               quantity: { type: integer, default: 1 }
 *     responses:
 *       201: { description: Added, full cart payload returned }
 *       400: { description: Guest count outside the package's capacity range, or invalid input }
 *       404: { description: Package not found or not currently available }
 */
router.post("/items", validateRequest(addCartItemSchema), addCartItem);

/**
 * @swagger
 * /api/customer/cart/items/{itemId}:
 *   patch:
 *     summary: Partially update a cart item
 *     description: Only the fields sent are touched (deep-merge), including the item-level selectedForCheckout checkbox.
 *     tags: [Customer Cart]
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated, full cart payload returned }
 *       404: { description: Item not found (or not owned by this cart) }
 *   delete:
 *     summary: Remove one cart item
 *     tags: [Customer Cart]
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Removed, full cart payload returned }
 *       404: { description: Item not found (or not owned by this cart) }
 */
router.patch("/items/:itemId", validateRequest(updateCartItemSchema), updateCartItem);
router.delete("/items/:itemId", removeCartItem);

/**
 * @swagger
 * /api/customer/cart/items/{itemId}/move-to-wishlist:
 *   post:
 *     summary: Move a cart item to the wishlist and remove it from the cart
 *     description: Customer-only — requires a real account (Wishlist has no guest equivalent).
 *     tags: [Customer Cart]
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Moved, full cart payload returned }
 *       401: { description: Not authenticated }
 *       404: { description: Item not found }
 */
router.post("/items/:itemId/move-to-wishlist", protectCustomer, moveCartItemToWishlist);

/**
 * @swagger
 * /api/customer/cart/coupon:
 *   post:
 *     summary: Apply a coupon code to the cart
 *     description: |
 *       HONEST LIMITATION: no Coupon/Offer model exists in this codebase
 *       yet (see info.txt PART 5 Flag #7) — this stores the code and always
 *       computes a 0 discount, rather than inventing a fake discount rule.
 *       Endpoint shape is stable for the frontend to wire to now.
 *     tags: [Customer Cart]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string }
 *     responses:
 *       200: { description: Coupon code saved (discount is a placeholder 0 for now) }
 *   delete:
 *     summary: Remove the applied coupon
 *     tags: [Customer Cart]
 *     responses:
 *       200: { description: Removed }
 *       404: { description: Cart not found }
 */
router.post("/coupon", validateRequest(applyCouponSchema), applyCoupon);
router.delete("/coupon", removeCoupon);

/**
 * @swagger
 * /api/customer/cart/note:
 *   put:
 *     summary: Set/update the cart-wide booking note
 *     description: Distinct from each item's own per-vendor special request.
 *     tags: [Customer Cart]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note: { type: string, maxLength: 1000 }
 *     responses:
 *       200: { description: Saved }
 */
router.put("/note", validateRequest(z.object({ note: z.string().trim().max(1000).optional() })), setBookingNote);

/**
 * @swagger
 * /api/customer/cart/merge:
 *   post:
 *     summary: Merge a guest cart into the logged-in customer's cart
 *     description: |
 *       Customer-only, deliberately explicit rather than automatic on every
 *       login — the frontend calls this right after login with the
 *       guestId it was tracking, so a stale/reused guestId can never
 *       silently merge a stranger's cart into an account.
 *     tags: [Customer Cart]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [guestId]
 *             properties:
 *               guestId: { type: string }
 *     responses:
 *       200: { description: Merged (or nothing to merge), full cart payload returned }
 *       400: { description: guestId missing }
 *       401: { description: Not authenticated }
 */
router.post("/merge", protectCustomer, validateRequest(z.object({ guestId: z.string().trim().min(1) })), mergeGuestCart);

export default router;
