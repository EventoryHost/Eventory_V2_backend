import mongoose from "mongoose";

/**
 * One line item in a Cart — one selected Package (one vendor's offering),
 * with its own event details, chosen add-ons/choose-N selections, and a
 * price snapshot for staleness detection later (Step 13). Deliberately NOT
 * capped at one item per vendor: "multi-vendor, multi-item" is this step's
 * own scope line, and both the final BRD's booking_vendors table and the
 * frontend's current Cart mock model one-package-per-vendor as today's
 * intended UX — but the DATA MODEL shouldn't hard-block a customer who
 * legitimately wants two different packages from the same vendor (e.g. a
 * caterer for two separate meal services). Grouping-by-vendor for display
 * is a read-time concern (see the cart controller once Step 13 builds it),
 * not a schema constraint.
 */

// Snapshot of one chosen add-on at add-to-cart time — mirrors the
// name/price/quantity shape of the final BRD's booking_addons table
// (Section 17), so nothing needs re-deriving when a cart item later
// becomes a real booking line.
const SelectedAddOnSchema = new mongoose.Schema(
  {
    addOnId: { type: mongoose.Schema.Types.ObjectId }, // the vendor's step2 add-on subdocument _id, if it has one
    name: { type: String, required: true },
    price: { type: Number, required: true, default: 0 },
    quantity: { type: Number, default: 1, min: 1 },
  },
  { _id: false }
);

// One choose-N selection (e.g. a Caterer menu item picked within a
// vendor-defined category) — mirrors the final BRD's booking_items table
// (group_key, item_id, item_name, price, is_chargeable). group_key ties
// several selections back to the same choose-N group so a future
// "Selected 3 of 5" style validation (Step 13/PDP add-to-cart) can check a
// group is fully satisfied without re-fetching the Package.
const SelectedItemSchema = new mongoose.Schema(
  {
    groupKey: { type: String, required: true },
    itemId: { type: mongoose.Schema.Types.ObjectId },
    itemName: { type: String, required: true },
    price: { type: Number, default: 0 },
    isChargeable: { type: Boolean, default: false },
  },
  { _id: false }
);

const CartItemSchema = new mongoose.Schema(
  {
    cartId: { type: mongoose.Schema.Types.ObjectId, ref: "Cart", required: true, index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true, index: true },
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: "Package", required: true },

    // Denormalized at add-to-cart time — same intent as Booking.js's
    // packageSnapshot: what the customer saw and picked, kept stable even
    // if the vendor edits the live package afterward. NOT re-derived on
    // every read; Step 13's staleness check compares this against the
    // package's current price explicitly, the same "computed on read, not
    // silently overwritten" pattern as WishlistItem's priceChanged flag.
    packageSnapshot: {
      name: { type: String },
      price: { type: Number },
      billingUnit: { type: String },
      image: { type: String },
      vendorType: { type: String },
      variantType: { type: String },
    },

    // Event context this line item was added for. The final BRD's
    // "Conflict guard" (Section 9: differing event dates across items
    // should block checkout) is a VALIDATION rule for Step 13's cart
    // mutation endpoints, not a schema constraint here — the model stays
    // permissive per-item so that rule has real data to check against.
    eventDetails: {
      // Added Phase 4 Step 17: the final BRD's checkout validation rules
      // (Section 10.5) require "Event type, event date and location
      // present on every vendor line" — captured here (not just at
      // checkout) so it flows through naturally when a CheckoutSession is
      // built from the cart, rather than forcing the customer to re-enter
      // it at checkout even when it was already set earlier.
      eventType: { type: String, default: null },
      date: { type: Date, default: null },
      timeSlot: { type: String, default: null },
      guestCount: { type: Number, default: null },
      location: { type: String, default: null },
    },

    selectedAddOns: { type: [SelectedAddOnSchema], default: [] },
    selectedItems: { type: [SelectedItemSchema], default: [] },

    // Per-vendor special request (final BRD Section 10.2) — lives here
    // since a CartItem is already vendor-scoped. If a vendor ever has more
    // than one CartItem in the same cart, each carries its own; nothing
    // here forces them to match — a display nuance for whoever builds the
    // Booking Summary read, not a data integrity concern.
    specialRequest: { type: String, trim: true, maxlength: 500, default: "" },

    quantity: { type: Number, default: 1, min: 1 },

    // Item-level select checkbox (final BRD Section 9) — lets the customer
    // check out a subset of the cart without removing the rest.
    selectedForCheckout: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: "customer_cart_items",
  }
);

CartItemSchema.index({ cartId: 1, vendorId: 1 });

export default mongoose.model("CartItem", CartItemSchema);
