import crypto from "crypto";
import mongoose from "mongoose";
import Cart from "../models/Cart.js";
import CartItem from "../models/CartItem.js";
import Package from "../models/Package.js";
import WishlistItem from "../models/WishlistItem.js";
import { computeAvailability } from "../utils/packageAvailability.js";
import { round2 } from "../utils/money.js";
import { computeCartQuote } from "../services/cartPricingService.js";

/**
 * Cart CRUD — Phase 3 Step 13. Every route runs behind identifyCartOwner
 * (soft auth: a logged-in customer's cart, or a guest cart keyed by an
 * opaque client-supplied guestId — see Cart.js / customerAuth.js). Reads
 * never create a Cart document just from a page view; only a write action
 * (add item, apply coupon, set booking note) lazily creates one, minting a
 * fresh guestId if the requester had no identity at all yet.
 */

// Find-only — used by GET so merely loading the cart page never writes to
// the database. Returns null if nothing exists yet (not an error).
async function findExistingCart(req) {
  if (req.customer) return Cart.findOne({ customerId: req.customer._id });
  if (req.guestId) return Cart.findOne({ guestId: req.guestId });
  return null;
}

// Find-or-create — used by every mutating route. Returns { cart, mintedGuestId }
// so the controller can tell the client about a brand-new guest identity.
async function getOrCreateCart(req) {
  let cart = await findExistingCart(req);
  let mintedGuestId = null;

  if (!cart) {
    if (req.customer) {
      cart = await Cart.create({ customerId: req.customer._id });
    } else {
      const guestId = req.guestId || crypto.randomBytes(16).toString("hex");
      mintedGuestId = req.guestId ? null : guestId;
      cart = await Cart.create({ guestId });
    }
  }

  return { cart, mintedGuestId };
}

const PACKAGE_REVALIDATION_FIELDS =
  "packageStatus vendorId step1_eventAndCrew.capacity step3_policiesAndCharges.packagePricing " +
  "availabilityCalendar availabilitySettings bookingCapacity";

// Builds the full cart payload: items grouped by vendor, per-item
// revalidation (still-available / price-changed / live availability for the
// item's own saved date+guests), per-vendor and cart-level subtotals, and a
// non-blocking conflict flag when selected items disagree on event date —
// the final BRD's "Conflict guard" (Section 9) is enforced at Phase 4
// checkout, not here; this only surfaces it.
async function buildCartPayload(cart) {
  const items = await CartItem.find({ cartId: cart._id }).sort({ createdAt: 1 }).lean();

  const packageIds = [...new Set(items.map((i) => String(i.packageId)))];
  const packages = packageIds.length
    ? await Package.find({ _id: { $in: packageIds } }).select(PACKAGE_REVALIDATION_FIELDS).lean()
    : [];
  const packageById = new Map(packages.map((p) => [String(p._id), p]));

  const enrichedItems = await Promise.all(
    items.map(async (item) => {
      const pkg = packageById.get(String(item.packageId));
      const stillLive = Boolean(pkg && pkg.packageStatus === "Live");
      const currentPrice = pkg?.step3_policiesAndCharges?.packagePricing?.price ?? null;
      const priceChanged =
        stillLive && item.packageSnapshot?.price != null && currentPrice != null && currentPrice !== item.packageSnapshot.price;

      let availability = null;
      if (stillLive && (item.eventDetails?.date || item.eventDetails?.guestCount)) {
        availability = await computeAvailability(pkg, {
          date: item.eventDetails?.date || undefined,
          guests: item.eventDetails?.guestCount || undefined,
        });
      }

      const lineTotal = round2(
        (item.packageSnapshot?.price || 0) * item.quantity +
          (item.selectedAddOns || []).reduce((sum, a) => sum + a.price * a.quantity, 0) +
          (item.selectedItems || []).filter((s) => s.isChargeable).reduce((sum, s) => sum + (s.price || 0), 0)
      );

      return {
        ...item,
        packageStillAvailable: stillLive,
        currentPrice,
        priceChanged,
        availability,
        lineTotal,
      };
    })
  );

  // vendorSubtotal/cart subtotal only sum items with selectedForCheckout —
  // the final BRD's "item-level select checkbox... summary recalculates on
  // selection" (Section 9). ALL items still appear in each vendor's items[]
  // (so the UI can render an unselected item, just greyed/excluded from the
  // total), only the money rollup is selection-scoped. Corrected here from
  // Step 13's first pass, which summed every item regardless of selection —
  // caught while building Step 14's quote and fixed in both places.
  const vendorGroups = new Map();
  for (const item of enrichedItems) {
    const key = String(item.vendorId);
    if (!vendorGroups.has(key)) vendorGroups.set(key, { vendorId: item.vendorId, items: [], vendorSubtotal: 0 });
    const group = vendorGroups.get(key);
    group.items.push(item);
    if (item.selectedForCheckout) {
      group.vendorSubtotal = round2(group.vendorSubtotal + (item.lineTotal || 0));
    }
  }

  const vendors = [...vendorGroups.values()];
  const subtotal = round2(vendors.reduce((sum, v) => sum + v.vendorSubtotal, 0));
  const discount = cart.coupon?.discountAmount || 0;
  const total = round2(Math.max(0, subtotal - discount));

  const selectedDates = [
    ...new Set(
      enrichedItems
        .filter((i) => i.selectedForCheckout && i.eventDetails?.date)
        .map((i) => new Date(i.eventDetails.date).toISOString().slice(0, 10))
    ),
  ];

  return {
    cartId: cart._id,
    itemCount: enrichedItems.length,
    vendorCount: vendors.length,
    vendors,
    coupon: cart.coupon || null,
    bookingNote: cart.bookingNote || "",
    subtotal,
    discount,
    total,
    conflicts: {
      // Non-blocking signal only — see the function comment above.
      inconsistentEventDates: selectedDates.length > 1,
      dates: selectedDates,
    },
  };
}

/**
 * @desc Get the current cart (customer or guest). Never creates one just
 * from a read — an identity with no cart yet gets an empty payload.
 */
export const getCart = async (req, res) => {
  try {
    const cart = await findExistingCart(req);
    if (!cart) {
      return res.status(200).json({
        status: "SUCCESS",
        cartId: null,
        itemCount: 0,
        vendorCount: 0,
        vendors: [],
        coupon: null,
        bookingNote: "",
        subtotal: 0,
        discount: 0,
        total: 0,
        conflicts: { inconsistentEventDates: false, dates: [] },
      });
    }
    const payload = await buildCartPayload(cart);
    return res.status(200).json({ status: "SUCCESS", ...payload });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch cart", error: error.message });
  }
};

/**
 * @desc Phase 3 Step 14 — the authoritative price/due-now quote for the
 * cart's currently-SELECTED items (selectedForCheckout:true), computed
 * fresh from each package's live price/GST/token/milestone config rather
 * than the cart's display snapshot. See src/services/cartPricingService.js
 * for the full breakdown and every honesty flag (no Coupon model, no
 * hardcoded 25% token, no hardcoded convenience fee %).
 */
export const getCartQuote = async (req, res) => {
  try {
    const cart = await findExistingCart(req);
    if (!cart) {
      return res.status(200).json({ status: "SUCCESS", quote: null, message: "No cart to quote" });
    }
    const quote = await computeCartQuote(cart);
    if (!quote) {
      return res.status(200).json({ status: "SUCCESS", quote: null, message: "No items selected for checkout" });
    }
    return res.status(200).json({ status: "SUCCESS", quote });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to compute cart quote", error: error.message });
  }
};

/**
 * @desc Add a package to the cart. Blocks only on hard-invalid input
 * (package not Live, guest count outside the package's own capacity range)
 * — a Blocked/Booked date is surfaced via GET's revalidation, not blocked
 * at add-time (same "best-effort, non-authoritative" philosophy as the
 * PDP). Duplicate packageId adds are ALLOWED (e.g. the same caterer package
 * booked twice for two sub-events) — no uniqueness constraint here, unlike
 * Wishlist's one-save-per-item rule.
 */
export const addCartItem = async (req, res) => {
  try {
    const { packageId, eventType, guests, date, timeSlot, location, selectedAddOns, selectedItems, specialRequest, quantity } = req.body;

    const pkg = await Package.findOne({ _id: packageId, packageStatus: "Live" });
    if (!pkg) {
      return res.status(404).json({ status: "FAILED", message: "Package not found or not currently available" });
    }

    const cap = pkg.step1_eventAndCrew?.capacity || {};
    if (guests !== undefined) {
      const withinCapacity = (cap.minGuests == null || guests >= cap.minGuests) && (cap.maxGuests == null || guests <= cap.maxGuests);
      if (!withinCapacity) {
        return res.status(400).json({
          status: "FAILED",
          message: `Guest count must be between ${cap.minGuests ?? 0} and ${cap.maxGuests ?? "unlimited"} for this package`,
        });
      }
    }

    const { cart, mintedGuestId } = await getOrCreateCart(req);

    const item = await CartItem.create({
      cartId: cart._id,
      vendorId: pkg.vendorId,
      packageId: pkg._id,
      packageSnapshot: {
        name: pkg.step1_eventAndCrew?.packageName,
        price: pkg.step3_policiesAndCharges?.packagePricing?.price ?? null,
        billingUnit: pkg.step3_policiesAndCharges?.packagePricing?.billingUnit ?? null,
        image: pkg.step4_sampleMedia?.media?.[0]?.url,
        vendorType: pkg.vendorType,
        variantType: pkg.variantType,
      },
      eventDetails: {
        eventType: eventType || null,
        date: date || null,
        timeSlot: timeSlot || null,
        guestCount: guests || null,
        location: location || null,
      },
      selectedAddOns: selectedAddOns || [],
      selectedItems: selectedItems || [],
      specialRequest: specialRequest || "",
      quantity,
    });

    const payload = await buildCartPayload(cart);
    if (mintedGuestId) res.setHeader("X-Guest-Cart-Id", mintedGuestId);
    return res.status(201).json({ status: "SUCCESS", message: "Added to cart", itemId: item._id, guestCartId: mintedGuestId, ...payload });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to add to cart", error: error.message });
  }
};

// Ownership check shared by every /:itemId route — the item must belong to
// a Cart owned by the resolved requester, not just exist.
async function findOwnedCartItem(req, itemId) {
  if (!mongoose.Types.ObjectId.isValid(itemId)) return { error: 400, message: "Invalid itemId" };
  const cart = await findExistingCart(req);
  if (!cart) return { error: 404, message: "Cart item not found" };
  const item = await CartItem.findOne({ _id: itemId, cartId: cart._id });
  if (!item) return { error: 404, message: "Cart item not found" };
  return { cart, item };
}

/**
 * @desc Partially update a cart item (event details, add-ons, choose-N
 * selections, special request, quantity, or the item-level select-for-
 * checkout checkbox). Deep-merge philosophy: only fields sent are touched.
 */
export const updateCartItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const resolved = await findOwnedCartItem(req, itemId);
    if (resolved.error) return res.status(resolved.error).json({ status: "FAILED", message: resolved.message });

    const { eventType, guests, date, timeSlot, location, selectedAddOns, selectedItems, specialRequest, quantity, selectedForCheckout } =
      req.body;
    const { item, cart } = resolved;

    if (eventType !== undefined) item.eventDetails.eventType = eventType;
    if (guests !== undefined) item.eventDetails.guestCount = guests;
    if (date !== undefined) item.eventDetails.date = date;
    if (timeSlot !== undefined) item.eventDetails.timeSlot = timeSlot;
    if (location !== undefined) item.eventDetails.location = location;
    if (selectedAddOns !== undefined) item.selectedAddOns = selectedAddOns;
    if (selectedItems !== undefined) item.selectedItems = selectedItems;
    if (specialRequest !== undefined) item.specialRequest = specialRequest;
    if (quantity !== undefined) item.quantity = quantity;
    if (selectedForCheckout !== undefined) item.selectedForCheckout = selectedForCheckout;

    await item.save();
    const payload = await buildCartPayload(cart);
    return res.status(200).json({ status: "SUCCESS", message: "Cart item updated", ...payload });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to update cart item", error: error.message });
  }
};

/**
 * @desc Remove one cart item.
 */
export const removeCartItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const resolved = await findOwnedCartItem(req, itemId);
    if (resolved.error) return res.status(resolved.error).json({ status: "FAILED", message: resolved.message });

    await CartItem.deleteOne({ _id: itemId });
    const payload = await buildCartPayload(resolved.cart);
    return res.status(200).json({ status: "SUCCESS", message: "Removed from cart", ...payload });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to remove cart item", error: error.message });
  }
};

/**
 * @desc Clear the entire cart (all items; the Cart identity + any applied
 * coupon/booking note are left alone — use DELETE /coupon separately).
 */
export const clearCart = async (req, res) => {
  try {
    const cart = await findExistingCart(req);
    if (!cart) {
      return res.status(200).json({ status: "SUCCESS", message: "Cart is already empty" });
    }
    const { deletedCount } = await CartItem.deleteMany({ cartId: cart._id });
    return res.status(200).json({ status: "SUCCESS", message: "Cart cleared", count: deletedCount });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to clear cart", error: error.message });
  }
};

/**
 * @desc Move a cart item to the wishlist and remove it from the cart.
 * Customer-only (route-gated by protectCustomer, not identifyCartOwner) —
 * a guest has nowhere to save a wishlist item, since Wishlist requires a
 * real account (Phase 2 Step 10).
 */
export const moveCartItemToWishlist = async (req, res) => {
  try {
    const { itemId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({ status: "FAILED", message: "Invalid itemId" });
    }

    const cart = await Cart.findOne({ customerId: req.customer._id });
    const item = cart && (await CartItem.findOne({ _id: itemId, cartId: cart._id }));
    if (!item) {
      return res.status(404).json({ status: "FAILED", message: "Cart item not found" });
    }

    let alreadyWishlisted = false;
    try {
      await WishlistItem.create({
        customerId: req.customer._id,
        itemType: "Package",
        packageId: item.packageId,
        priceSnapshot: item.packageSnapshot?.price ?? null,
      });
    } catch (err) {
      if (err.code === 11000) {
        alreadyWishlisted = true; // already saved earlier — still remove from cart below
      } else {
        throw err;
      }
    }

    await CartItem.deleteOne({ _id: itemId });
    const payload = await buildCartPayload(cart);
    return res.status(200).json({
      status: "SUCCESS",
      message: alreadyWishlisted ? "Already in your wishlist — moved out of cart" : "Moved to wishlist",
      ...payload,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to move item to wishlist", error: error.message });
  }
};

/**
 * @desc Apply a coupon code to the cart. HONEST LIMITATION: there is no
 * Coupon/Offer model in this codebase yet (see info.txt PART 5 Flag #7) —
 * this stores the code and computes a discountAmount of 0 rather than
 * inventing a fake discount rule. The endpoint shape is built now so the
 * frontend can wire to it; real validation/discount math drops in later
 * without an API shape change once a Coupon model exists.
 */
export const applyCoupon = async (req, res) => {
  try {
    const { code } = req.body;
    const { cart } = await getOrCreateCart(req);

    cart.coupon = { code: code.toUpperCase(), discountAmount: 0, appliedAt: new Date() };
    await cart.save();

    const payload = await buildCartPayload(cart);
    return res.status(200).json({
      status: "SUCCESS",
      message: "Coupon code saved. Discount calculation is not implemented yet (no coupon/offer system exists) — this is a placeholder until that's built.",
      ...payload,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to apply coupon", error: error.message });
  }
};

/**
 * @desc Remove the applied coupon.
 */
export const removeCoupon = async (req, res) => {
  try {
    const cart = await findExistingCart(req);
    if (!cart) return res.status(404).json({ status: "FAILED", message: "Cart not found" });

    cart.coupon = null;
    await cart.save();

    const payload = await buildCartPayload(cart);
    return res.status(200).json({ status: "SUCCESS", message: "Coupon removed", ...payload });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to remove coupon", error: error.message });
  }
};

/**
 * @desc Set/update the cart-wide booking note (distinct from each item's
 * own per-vendor special request).
 */
export const setBookingNote = async (req, res) => {
  try {
    const { cart } = await getOrCreateCart(req);
    cart.bookingNote = req.body.note || "";
    await cart.save();
    const payload = await buildCartPayload(cart);
    return res.status(200).json({ status: "SUCCESS", message: "Booking note saved", ...payload });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to save booking note", error: error.message });
  }
};

/**
 * @desc Merge a guest cart's items into the logged-in customer's cart, then
 * delete the now-empty guest cart. Customer-only. Deliberately explicit
 * (frontend calls this right after login with the guestId it was tracking)
 * rather than automatic, since silently merging on every login would merge
 * a stranger's cart if a stale/reused guestId ever collided.
 */
export const mergeGuestCart = async (req, res) => {
  try {
    const { guestId } = req.body;
    if (!guestId || typeof guestId !== "string") {
      return res.status(400).json({ status: "FAILED", message: "guestId is required" });
    }

    const guestCart = await Cart.findOne({ guestId });
    if (!guestCart) {
      return res.status(200).json({ status: "SUCCESS", message: "No guest cart found for that id — nothing to merge" });
    }

    const { cart: customerCart } = await getOrCreateCart(req);

    await CartItem.updateMany({ cartId: guestCart._id }, { $set: { cartId: customerCart._id } });
    // Keep the customer's own coupon/note if they already had one; only
    // adopt the guest cart's if the customer cart doesn't have its own yet.
    if (!customerCart.coupon && guestCart.coupon) customerCart.coupon = guestCart.coupon;
    if (!customerCart.bookingNote && guestCart.bookingNote) customerCart.bookingNote = guestCart.bookingNote;
    await customerCart.save();

    await Cart.deleteOne({ _id: guestCart._id });

    const payload = await buildCartPayload(customerCart);
    return res.status(200).json({ status: "SUCCESS", message: "Guest cart merged", ...payload });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to merge guest cart", error: error.message });
  }
};
