import mongoose from "mongoose";

/**
 * The event-level half of the customer "Add a review" screen: how the event
 * went overall, and how the event support & coordination was. Both rate
 * Eventory's own service rather than any one vendor, which is why this
 * isn't a Review row — Review.vendorId is required and there is no vendor
 * to put there.
 *
 * *** What "an event" is: *** Booking.js has no groupId tying together the
 * bookings made for one event (see customerBookingController.js's
 * KNOWN LIMITATION note). The customer side groups them by event type +
 * calendar day (UTC), exactly as My Bookings and Booking Details do, so
 * this model keys an event the same way — eventKey is
 * "<eventType or 'Event'>|<YYYY-MM-DD>" — and records which bookings made
 * up the event when the review was written (bookingIds).
 *
 * Its own collection name for the same reason Review.js has one: the
 * shared dev database may already hold legacy collections under the
 * Mongoose-default names.
 */
const EventReviewSchema = new mongoose.Schema(
  {
    customerId: { type: String, ref: "Customer", required: true, index: true },
    eventKey: { type: String, required: true },
    eventType: { type: String, default: null },
    eventDate: { type: Date, required: true },
    // The booking the review was opened from, plus every booking in the
    // event at the time — the group can change later (a cancelled package,
    // a new one added for the same day), so this is a snapshot.
    bookingId: { type: String, ref: "Booking", required: true },
    bookingIds: { type: [String], default: [] },
    // Each question is optional on its own — a customer can answer one and
    // skip the other — but a review needs at least one (enforced by the
    // submission validator, not here).
    overallRating: { type: Number, min: 1, max: 5, default: null },
    supportRating: { type: Number, min: 1, max: 5, default: null },
    // The "What made it exceptional?" chips picked under each question.
    // Free strings rather than an enum: the chip list lives in the
    // frontend and isn't final yet, and the validator already caps count
    // and length.
    overallHighlights: { type: [String], default: [] },
    supportHighlights: { type: [String], default: [] },
    status: { type: String, enum: ["Published", "Pending", "Hidden"], default: "Published" },
  },
  { timestamps: true, collection: "customer_event_reviews" }
);

// One event-level review per customer per event.
EventReviewSchema.index({ customerId: 1, eventKey: 1 }, { unique: true });

export default mongoose.model("EventReview", EventReviewSchema);
