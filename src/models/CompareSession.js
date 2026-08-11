import mongoose from "mongoose";

/**
 * One active compare list per customer — same "single replaceable working
 * set" shape as the Wishlist share list, not a separate document per
 * comparison. Capped at 3 packageIds (enforced in the controller, not just
 * here, so a full list gives a clean 409 rather than a generic validation
 * error).
 *
 * Packages only for now, not Vendors/Essentials — the "compare up to 3
 * items" requirement (final Customer Portal BRD, Section 3/5) doesn't say
 * whether compare covers anything beyond packages, and info.txt's OPEN
 * QUESTIONS already flags this exact ambiguity for wishlist/compare
 * generally. Defaulting to Packages-only here rather than guessing wider.
 *
 * Deliberately restricted to ONE vendorType per session (see
 * customerCompareController.js) — comparing a Caterer package against a DJ
 * package side by side isn't a meaningful comparison, since their
 * step2_productsAndPricing shapes are entirely different per vendor type.
 */
const CompareSessionSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true, unique: true, index: true },
    packageIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Package" }],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 3,
        message: "A compare session can hold at most 3 packages",
      },
    },
  },
  {
    timestamps: true,
    // Explicit collection name, checked clear against a live listing of the
    // database's actual collections first — standard practice since the
    // Step 9/10 collisions (see info.txt Phase 0).
    collection: "customer_compare_sessions",
  }
);

export default mongoose.model("CompareSession", CompareSessionSchema);
