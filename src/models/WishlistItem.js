import mongoose from "mongoose";

/**
 * A single saved item on a customer's wishlist — either a Package or a
 * Vendor (per the final Customer Portal BRD's "Saved packages/vendors with
 * notes and share" — see info.txt Phase 2 Step 10). One document per saved
 * item, not one document per customer, so add/remove/note-update are all
 * single-document operations.
 *
 * priceSnapshot captures the package's price at save time so a later GET
 * can flag "price changed since you saved this" — see
 * customerWishlistController.js. This is a passive, computed-on-read
 * signal, not a push/email notification: no notification channel
 * (nodemailer etc.) exists in this codebase yet, see info.txt PART 4.
 */
const WishlistItemSchema = new mongoose.Schema(
  {
    customerId: { type: String, ref: "Customer", required: true, index: true },
    itemType: { type: String, enum: ["Package", "Vendor"], required: true },
    packageId: { type: String, ref: "Package", default: null },
    vendorId: { type: String, ref: "Vendor", default: null },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    // Only meaningful for itemType "Package" — null for Vendor saves.
    priceSnapshot: { type: Number, default: null },
  },
  {
    timestamps: true,
    // Explicit collection name on purpose, not left to Mongoose's default
    // pluralization — this repo's shared "dev" database has already turned
    // out twice (Review in Step 9, Customer in Step 10 — see that step's
    // note) to have pre-existing, differently-shaped collections sitting
    // under the exact name Mongoose would have guessed. No "wishlist"/
    // "wishlistitems" collection existed at the time this was added
    // (checked directly against the database first), but naming it
    // explicitly here means that check never has to be re-done or trusted
    // to stay true by luck.
    collection: "customer_wishlist_items",
  }
);

// One save per (customer, package) or (customer, vendor) — re-saving the
// same item is a no-op from the client's perspective, enforced here rather
// than trusting the controller to check first. Partial/sparse: a Package
// wishlist item has vendorId:null and vice versa, and the unique index
// must not treat every null the same as a duplicate of every other null —
// partialFilterExpression scopes each index to only the documents where
// that field is actually set.
WishlistItemSchema.index(
  { customerId: 1, packageId: 1 },
  { unique: true, partialFilterExpression: { packageId: { $type: "string" } } }
);
WishlistItemSchema.index(
  { customerId: 1, vendorId: 1 },
  { unique: true, partialFilterExpression: { vendorId: { $type: "string" } } }
);

export default mongoose.model("WishlistItem", WishlistItemSchema);
