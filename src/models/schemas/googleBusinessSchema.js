import mongoose from "mongoose";

export const GOOGLE_BUSINESS_STATUSES = ["linked", "pending", "rejected"];
export const GOOGLE_BUSINESS_VERIFIED_VIA = ["phone_match", "em"];

export const GoogleBusinessSchema = new mongoose.Schema(
  {
    placeId: { type: String, required: true },
    status: { type: String, enum: GOOGLE_BUSINESS_STATUSES, required: true },
    verifiedVia: { type: String, enum: [...GOOGLE_BUSINESS_VERIFIED_VIA, null], default: null },
    linkedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
  },
  { _id: false }
);

export default GoogleBusinessSchema;
