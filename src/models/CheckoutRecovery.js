import mongoose from "mongoose";

/**
 * One abandoned-checkout recovery record per CheckoutSession — the state
 * behind the "Still interested? Your booking is waiting!" prompt.
 *
 * Why a separate collection rather than fields on CheckoutSession: a
 * session is TTL-deleted 30 minutes after its last edit (CheckoutSession.js,
 * the BRD's own hold window), while a recovery prompt is meant for a
 * customer who comes back hours or days later. This record keeps only what
 * is needed to (a) show the prompt and (b) resume — never contact details,
 * never prices as a promise (they are re-locked on resume), never anything
 * payment-related beyond what Payment already stores.
 *
 * Written ONLY by services/checkoutRecoveryService.js:
 *   - kept in step with its CheckoutSession by that model's post-save hook
 *     (create/edit → Open + fresh snapshot, Cancelled → Invalidated,
 *     Completed → Converted). Completed is only ever set server-side after
 *     payment is verified (customerPaymentController.js), so a client can
 *     never mark a recovery converted.
 *   - prompt state (impressions/dismissals/CTA clicks) via the customer
 *     recovery endpoints.
 *
 * `campaign` exists so later campaigns (offers, recommendations, reminders
 * over other channels) can share this model's lifecycle and frequency
 * fields without a schema change. Only "abandoned_checkout" exists today.
 */
export const RECOVERY_CAMPAIGNS = ["abandoned_checkout"];
export const RECOVERY_STATUSES = ["Open", "Converted", "Invalidated", "Superseded", "Retired"];

const RecoveryItemSchema = new mongoose.Schema(
  {
    packageId: { type: String, required: true },
    vendorId: { type: String, default: null },
    packageGroupId: { type: String, default: null },
    sourceCartItemId: { type: String, default: null },
    // Display snapshot only — name/image are re-read from the live Package
    // when the prompt is served; these are the fallback if that read fails.
    name: { type: String, default: null },
    image: { type: String, default: null },
    vendorType: { type: String, default: null },
    eventDetails: {
      eventType: { type: String, default: null },
      date: { type: Date, default: null },
      timeSlot: { type: String, default: null },
      guestCount: { type: Number, default: null },
      location: { type: String, default: null },
    },
    quantity: { type: Number, default: 1 },
  },
  { _id: false }
);

const CheckoutRecoverySchema = new mongoose.Schema(
  {
    customerId: { type: String, ref: "Customer", required: true, index: true },
    campaign: { type: String, enum: RECOVERY_CAMPAIGNS, default: "abandoned_checkout" },
    checkoutSessionId: { type: String, ref: "CheckoutSession", required: true, unique: true },
    source: { type: String, enum: ["cart", "direct"], required: true },
    sourceCartId: { type: String, default: null },
    items: { type: [RecoveryItemSchema], default: [] },

    // The session's own updatedAt while it was Active — i.e. the customer's
    // last real checkout edit. Inactivity is measured from here, never from
    // a client clock.
    lastActivityAt: { type: Date, required: true },

    status: { type: String, enum: RECOVERY_STATUSES, default: "Open" },
    statusReason: { type: String, default: null },
    statusChangedAt: { type: Date, default: null },

    impressions: {
      count: { type: Number, default: 0 },
      lastShownAt: { type: Date, default: null },
    },
    dismissals: {
      count: { type: Number, default: 0 },
      lastDismissedAt: { type: Date, default: null },
    },
    ctaClicks: {
      count: { type: Number, default: 0 },
      lastClickedAt: { type: Date, default: null },
    },
    convertedAt: { type: Date, default: null },
    // Set when this checkout was reopened from another record's prompt
    // ("Continue Booking" → fresh session), so its conversion still counts.
    resumedFrom: { type: String, default: null },
    // True when the customer clicked "Continue Booking" (on this record, or
    // the one in resumedFrom) before converting — prompt attribution.
    convertedAfterPrompt: { type: Boolean, default: false },

    // Bounded retention (data minimisation): purged this long after the last
    // checkout edit, whatever the status. See config/checkoutRecovery.js.
    purgeAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true, collection: "customer_checkout_recoveries" }
);

CheckoutRecoverySchema.index({ customerId: 1, status: 1, lastActivityAt: -1 });

export default mongoose.model("CheckoutRecovery", CheckoutRecoverySchema);
