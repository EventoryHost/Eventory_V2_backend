import mongoose from "mongoose";

/**
 * Browsing-based retargeting campaign state — one record per (customer,
 * campaign type, anchor package group). The anchor is the package the
 * customer viewed that the popup is about: the package itself for
 * RECENTLY_VIEWED, the package the recommendations are "similar to" for
 * SIMILAR_EVENTS.
 *
 * Abandoned checkout is NOT stored here — it keeps its own lifecycle in
 * CheckoutRecovery.js (tied to one checkout session). This record only
 * holds prompt tracking: what was shown, impressions, CTA clicks,
 * dismissals, and the booking it converted into. No browsing history is
 * copied here; that stays in ViewedItem.
 *
 * Written only by services/retargetingCampaignService.js.
 */
export const BROWSING_CAMPAIGNS = ["RECENTLY_VIEWED", "SIMILAR_EVENTS"];
export const CAMPAIGN_STATUSES = ["Open", "Converted", "Retired"];

const RetargetingCampaignSchema = new mongoose.Schema(
  {
    customerId: { type: String, ref: "Customer", required: true, index: true },
    campaign: { type: String, enum: BROWSING_CAMPAIGNS, required: true },
    anchorPackageGroupId: { type: String, required: true },
    anchorPackageId: { type: String, required: true },
    // What the latest popup actually showed (package ids), for click and
    // conversion attribution.
    shownPackageIds: { type: [String], default: [] },

    status: { type: String, enum: CAMPAIGN_STATUSES, default: "Open" },
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
      lastPackageId: { type: String, default: null },
    },
    convertedAt: { type: Date, default: null },
    convertedCheckoutSessionId: { type: String, default: null },
    convertedPackageId: { type: String, default: null },
    // True when the customer clicked the popup's CTA before booking.
    convertedAfterClick: { type: Boolean, default: false },

    purgeAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true, collection: "customer_retargeting_campaigns" }
);

RetargetingCampaignSchema.index({ customerId: 1, campaign: 1, anchorPackageGroupId: 1 }, { unique: true });
RetargetingCampaignSchema.index({ customerId: 1, "impressions.lastShownAt": -1 });

export default mongoose.model("RetargetingCampaign", RetargetingCampaignSchema);
