import mongoose from "mongoose";

/**
 * Package interaction analytics (PRD §5.1). Raw events only — they never
 * feed vendor demand directly; qualified leads are counted from Booking /
 * Enquiry (services/commercial/bookingCounters.js, enquiryCounters.js).
 * Package views stay in PackageViewDaily (already aggregated per day).
 */
export const COMMERCIAL_EVENT_TYPES = [
  "WISHLIST_ADD",
  "WISHLIST_REMOVE",
  "CART_ADD",
  "CART_REMOVE",
  "CHECKOUT_STARTED",
];

const CommercialEventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: COMMERCIAL_EVENT_TYPES, required: true },
    customerId: { type: String, default: null },
    guestId: { type: String, default: null },
    packageId: { type: String, default: null, index: true },
    vendorId: { type: String, default: null, index: true },
    eventDate: { type: Date, default: null },
    // Customer-visible price at the moment of the event (price friction).
    price: { type: Number, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
    at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

CommercialEventSchema.index({ type: 1, at: -1 });

export default mongoose.model("CommercialEvent", CommercialEventSchema);
