import mongoose from "mongoose";

/**
 * One active cart per identity — either a logged-in customer (customerId)
 * or an anonymous browser (guestId), never both, mirroring the
 * customerId-XOR-vendorId pattern already used in WishlistItem.js. Line
 * items live in CartItem.js (one Cart : many CartItem), not embedded here,
 * so add/update/remove/select-for-checkout are all single-document
 * operations on CartItem rather than array-surgery on Cart.
 *
 * Guest cart support (Phase 3 Step 12's own scope line): a cart can exist
 * before login, identified by an opaque guestId the client generates/
 * stores (e.g. in localStorage) and sends back on every request. Merging a
 * guest cart into a customer's cart once they log in is deliberately NOT
 * built here — it's meaningless without the add/update endpoints that
 * would populate a guest cart in the first place, so it's deferred to
 * Step 13 alongside the CRUD endpoints (see info.txt).
 *
 * The coupon field is a SLOT, not the full Coupon/Offer model the final
 * Customer Portal BRD calls for (see info.txt PART 5 Flag #7) — that's
 * still a separate, not-yet-built model; this just holds whatever code was
 * applied and what it worked out to, once Step 13 builds the apply/
 * validate endpoint.
 */
const CartCouponSchema = new mongoose.Schema(
  {
    code: { type: String, trim: true, uppercase: true },
    discountAmount: { type: Number, default: 0 },
    appliedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const CartSchema = new mongoose.Schema(
  {
    // NO `default: null` on either field — a sparse unique index only skips
    // documents where the field is truly ABSENT, not present-and-null. With
    // an explicit default of null, every guest cart got customerId:null
    // (colliding with every OTHER guest cart on that index) and every
    // customer cart got guestId:null (same collision the other way) — the
    // bug never surfaced in this file's own Step 12/13 testing because
    // only one of each cart kind ever coexisted at a time; found via
    // direct testing 2026-08-12 while debugging the identical bug in
    // Customer.js's wishlistShareToken. Left genuinely unset instead.
    customerId: { type: String, ref: "Customer", index: { unique: true, sparse: true } },
    guestId: { type: String, index: { unique: true, sparse: true } },

    coupon: { type: CartCouponSchema, default: null },

    // Global booking note (BRD Section 10.3's "Add Booking Notes" — one
    // textarea for the whole order, distinct from any later per-vendor
    // special request, which lives on CartItem instead since that's
    // vendor-scoped).
    bookingNote: { type: String, trim: true, maxlength: 1000, default: "" },

    // Only ever set on guest carts (see the pre-save hook below) — customer
    // carts are never auto-expired. MongoDB TTL indexes skip documents
    // where the indexed field is absent/null, so this is safe to share one
    // index across both cart kinds. 30 days is a default, not a spec'd
    // value — nothing in the BRD says how long an abandoned guest cart
    // should live; worth confirming, not guessed at with false confidence.
    expiresAt: { type: Date, default: null, index: { expireAfterSeconds: 0 } },
  },
  {
    timestamps: true,
    // Explicit collection name, checked clear against a live listing first
    // — standard practice since the Step 9/10 collisions (see info.txt
    // Phase 0).
    collection: "customer_carts",
  }
);

// Mongoose 9 dropped callback-style pre() hooks (no `next` parameter) — a
// plain sync function that throws is how a hook now fails validation. See
// Customer.js / info.txt Phase 0 for the same fix applied there first.
CartSchema.pre("validate", function requireExactlyOneOwner() {
  const hasCustomer = Boolean(this.customerId);
  const hasGuest = Boolean(this.guestId);
  if (hasCustomer === hasGuest) {
    throw new Error("A cart must have exactly one of customerId or guestId, never both or neither");
  }
  if (hasGuest && !this.expiresAt) {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    this.expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);
  }
});

export default mongoose.model("Cart", CartSchema);
