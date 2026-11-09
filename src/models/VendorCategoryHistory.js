import mongoose from "mongoose";

/**
 * Every vendor demand-tier change (PRD §5.6). Confirmed bookings never
 * reprice when the tier moves; this trail explains which tier any booking
 * or package review was priced under.
 */
const VendorCategoryHistorySchema = new mongoose.Schema(
  {
    vendorId: { type: String, required: true, index: true },
    previousTier: { type: String, default: null },
    newTier: { type: String, required: true },
    demandScore: { type: Number, default: null },
    preEventoryScore: { type: Number, default: null },
    behaviourScore: { type: Number, default: null },
    behaviourWeight: { type: Number, default: null },
    source: { type: String, enum: ["COMPUTED", "ADMIN_OVERRIDE", "MONTHLY_REVIEW"], required: true },
    reason: { type: String, default: null },
    categoryRuleVersion: { type: String, default: null },
    by: { type: String, default: null },
    effectiveFrom: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const VendorCategoryHistory = mongoose.model("VendorCategoryHistory", VendorCategoryHistorySchema);

export default VendorCategoryHistory;
