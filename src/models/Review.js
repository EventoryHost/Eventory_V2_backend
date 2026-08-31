import mongoose from "mongoose";

/**
 * Minimal Review model — created in Phase 1 Step 8 because the PDP endpoint
 * needed somewhere real to read reviews from, rather than faking a reviews
 * array. Step 9 (this step) adds categoryRatings + the standalone aggregate/
 * rating-breakdown endpoints. Still NOT the full Step 29 scope: no
 * submission endpoint yet, no moderation workflow, no vendor-reply
 * capability (see the Customer Reviews & Social Proof Page PRD notes in
 * info.txt PART 3/4 for what that still needs).
 *
 * bookingId is required — reviews are tied to a real, completed booking
 * ("verified purchase") per the PRD, not free-text reviews. There is
 * nothing yet that enforces the booking is actually Completed or that the
 * reviewer is the booking's customer — that eligibility check is explicitly
 * Step 29's job (submission endpoint), not this model.
 *
 * *** collection: "customer_reviews", NOT the Mongoose-default "reviews" ***
 * Discovered while testing Step 9: the shared dev database ALREADY has a
 * real "reviews" collection — not created by anything in this repo's code
 * (PART 1's original scan found no Review model anywhere), but populated
 * with real historical feedback (service_id/customer_id/feedback_id fields,
 * dated Sept 2025 - Jan 2026) from some other, unknown-to-this-repo part of
 * the system. mongoose.model("Review", ...) would default to that same
 * "reviews" collection name and silently mix brand-new documents (and
 * indexes) into someone else's existing data with a totally different
 * schema — which is exactly what happened for a few minutes during testing
 * before this was caught, cleaned up, and this explicit collection name was
 * added. See info.txt PART 4 — this needs a decision from you/seniors on
 * whether that legacy collection is a real, still-in-use feedback system
 * this should integrate with instead of building a parallel one.
 */
const ReviewSchema = new mongoose.Schema(
  {
    customerId: { type: String, ref: "Customer", required: true, index: true },
    vendorId: { type: String, ref: "Vendor", required: true, index: true },
    packageId: { type: String, ref: "Package", default: null, index: true },
    bookingId: { type: String, ref: "Booking", required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    // Optional per-category ratings (e.g. "Quality", "Value for Money",
    // "Punctuality" — whatever a submission form actually offers). Left as
    // an open Map rather than a hardcoded enum of category names: the
    // Customer Reviews & Social Proof Page PRD calls for a "rating
    // breakdown by category" but doesn't enumerate a fixed category list,
    // and inventing one here risks a mismatch with whatever the submission
    // UI (Step 29, not built yet) ends up sending. The aggregate endpoints
    // below compute a breakdown from whatever keys are actually present.
    categoryRatings: { type: Map, of: { type: Number, min: 1, max: 5 }, default: undefined },
    comment: { type: String, trim: true, maxlength: 2000, default: "" },
    // Moderation status — defaults to Published since no moderation flow
    // exists yet (that's part of Step 29). Read endpoints only ever surface
    // Published reviews.
    status: { type: String, enum: ["Published", "Pending", "Hidden"], default: "Published" },
  },
  { timestamps: true, collection: "customer_reviews" }
);

// One review per booking — a customer reviews a specific completed booking,
// not the package/vendor in the abstract, and shouldn't be able to submit
// more than one for the same booking.
ReviewSchema.index({ bookingId: 1 }, { unique: true });
ReviewSchema.index({ packageId: 1, status: 1, createdAt: -1 });
ReviewSchema.index({ vendorId: 1, status: 1, createdAt: -1 });

export default mongoose.model("Review", ReviewSchema);
