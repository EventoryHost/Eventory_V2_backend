import mongoose from "mongoose";

/**
 * A checkout session is a short-lived, price-locked snapshot of what a
 * customer is about to pay for — created either from their current Cart
 * (selected items) or a direct "Book Now" purchase that never touched the
 * cart at all (Phase 4 Step 15's own scope: "lock price version from
 * cart/direct Book Now").
 *
 * 30-minute expiry is not a guessed default like Cart's 30-day guest TTL —
 * it's the final Customer Portal BRD's own spec (Section 11: "the booking
 * draft is held for 30 minutes"; Section 19: "Session lost mid-checkout:
 * Draft persists for 30 minutes and is restored by reference"). Sliding on
 * every edit (see customerCheckoutController.js), not fixed-from-creation —
 * the BRD doesn't specify which, sliding is the more forgiving read and is
 * documented as an assumption in info.txt.
 *
 * contactDetails added in Phase 4 Step 17 — see that section below.
 */
const CheckoutLineSchema = new mongoose.Schema(
  {
    vendorId: { type: String, ref: "Vendor", required: true },
    packageId: { type: String, ref: "Package", required: true },
    // Set only when this line came from an actual Cart — Phase 4 Step 19
    // ("booking creation on payment success") will need this to know which
    // CartItems to clear afterward. Null for a direct "Book Now" line,
    // which was never a CartItem.
    sourceCartItemId: { type: String, ref: "CartItem", default: null },

    // Stored at line-creation time so a later variant switch (PATCH,
    // customerCheckoutController.js) can cheaply verify the new packageId
    // is a sibling variant of the SAME logical package, without an extra
    // lookup of the line's current package first.
    packageGroupId: { type: String, default: null },

    packageSnapshot: {
      name: { type: String },
      price: { type: Number },
      billingUnit: { type: String },
      image: { type: String },
      vendorType: { type: String },
      variantType: { type: String },
    },
    eventDetails: {
      // eventType added Step 17 — the final BRD's checkout validation
      // (Section 10.5) requires "Event type, event date and location
      // present on every vendor line."
      eventType: { type: String, default: null },
      date: { type: Date, default: null },
      timeSlot: { type: String, default: null },
      guestCount: { type: Number, default: null },
      location: { type: String, default: null },
    },
    selectedAddOns: { type: mongoose.Schema.Types.Mixed, default: [] },
    selectedItems: { type: mongoose.Schema.Types.Mixed, default: [] },
    // PDP "Customize items" workshop requests, carried over from the
    // CartItem this line was built from (or accepted directly for a
    // source:"direct" purchase) — see CartItem.js's CustomizeRequestSchema
    // for the full shape/reasoning. Mixed here too, same as
    // selectedAddOns/selectedItems above — a session line is a snapshot,
    // not a place that re-validates this shape.
    customizeRequests: { type: mongoose.Schema.Types.Mixed, default: [] },
    specialRequest: { type: String, trim: true, maxlength: 500, default: "" },
    // "Notes for vendor" image attachments — see CartItem.js's own comment
    // on noteAttachments for the full context. Carried over the same way
    // specialRequest is, right above.
    noteAttachments: { type: [String], default: [] },
    quantity: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true }
);

const CheckoutSessionSchema = new mongoose.Schema(
  {
    customerId: { type: String, ref: "Customer", required: true, index: true },
    source: { type: String, enum: ["cart", "direct"], required: true },
    // Set only when source:"cart" — which Cart this session was built from,
    // so Step 19 can find/clear the right cart after payment.
    sourceCartId: { type: String, ref: "Cart", default: null },

    lines: { type: [CheckoutLineSchema], default: [] },
    bookingNote: { type: String, trim: true, maxlength: 1000, default: "" },

    // Phase 4 Step 17 — ONE contact-details set for the whole order (final
    // BRD Section 10: "Enter your communication details to secure your
    // vendor lineup"), not per vendor/line. Pre-filled from the customer's
    // own profile at session-creation time so "capture/edit" starts from
    // "edit" when possible, not a blank form. Whether `phone` is actually
    // verified is NEVER stored here as a static flag — it's recomputed
    // live on every read by comparing against the customer's CURRENT
    // Customer.phone/isPhoneVerified (see customerCheckoutController.js),
    // so verifying it later (via the existing Phase 0 OTP flow) is picked
    // up automatically without needing to re-PATCH this endpoint.
    contactDetails: {
      name: { type: String, trim: true, default: null },
      phone: { type: String, trim: true, default: null },
      email: { type: String, trim: true, lowercase: true, default: null },
    },

    // The frozen quote from computeQuoteForLines at (re)lock time — Mixed,
    // same reasoning as elsewhere in this codebase for a computed,
    // shape-varying payload (e.g. Package's festivals.details): this is a
    // read/display snapshot, not something queried into or validated
    // against directly.
    lockedQuote: { type: mongoose.Schema.Types.Mixed, default: null },
    lockedAt: { type: Date, default: null },

    status: { type: String, enum: ["Active", "Expired", "Completed", "Cancelled"], default: "Active", index: true },

    // TTL-indexed, same pattern as RefreshToken.js/Cart.js guest carts.
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  {
    timestamps: true,
    collection: "customer_checkout_sessions",
  }
);

CheckoutSessionSchema.index({ customerId: 1, status: 1 });

export default mongoose.model("CheckoutSession", CheckoutSessionSchema);
