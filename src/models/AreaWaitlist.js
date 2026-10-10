import mongoose from "mongoose";

/**
 * "Notify me when Eventory begins serving {area}" — the help panel's
 * out-of-area lead (frontend HelpOutOfAreaCard, Figma "09 — Location").
 * One row per phone + area; asking again just refreshes it. `notifiedAt`
 * is set once the one promised WhatsApp message has gone out, so nobody is
 * messaged twice. Own collection, like the rest of the chat models.
 */
const AreaWaitlistSchema = new mongoose.Schema(
  {
    area: { type: String, required: true }, // as the customer gave it, e.g. "Jaipur"
    areaKey: { type: String, required: true }, // lower-cased, for de-duping
    pincode: { type: String, default: null },
    // Where it came from: typed in the chat, or the site's location tag.
    areaSource: { type: String, enum: ["typed", "location_tag"], default: "typed" },
    phone: { type: String, required: true },
    // WhatsApp consent (the card's checkbox; account holders consent by account).
    consent: { type: Boolean, required: true },
    customerId: { type: String, ref: "Customer", default: null, index: true },
    anonId: { type: String, default: null },
    customerName: { type: String, default: null },
    // What they were planning, so the first message can be relevant.
    occasion: { type: String, default: null },
    guests: { type: String, default: null },
    budget: { type: String, default: null },
    requestText: { type: String, default: null },
    pageUrl: { type: String, default: null },
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "customer_area_waitlist" }
);

AreaWaitlistSchema.index({ phone: 1, areaKey: 1 }, { unique: true });
AreaWaitlistSchema.index({ areaKey: 1, notifiedAt: 1 });

export default mongoose.model("AreaWaitlist", AreaWaitlistSchema);
