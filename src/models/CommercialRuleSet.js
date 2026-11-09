import mongoose from "mongoose";

/**
 * Versioned Commercial Engine rule set (PRD §2 "Rules are configuration",
 * §16 rule versioning). One document holds the whole rule object the engine
 * reads (same shape as src/services/commercial/rules.v1.js).
 *
 * Lifecycle: DRAFT -> ACTIVE -> RETIRED. Exactly one ACTIVE at a time;
 * an ACTIVE set is never edited — changes go into a new DRAFT version, so
 * bookings that recorded a version can always be explained later.
 */
const CommercialRuleSetSchema = new mongoose.Schema(
  {
    version: { type: String, required: true, unique: true },
    status: { type: String, enum: ["DRAFT", "ACTIVE", "RETIRED"], default: "DRAFT", index: true },
    rules: { type: mongoose.Schema.Types.Mixed, required: true },
    notes: { type: String, default: null },
    createdBy: { type: String, default: null },
    activatedAt: { type: Date, default: null },
    activatedBy: { type: String, default: null },
    retiredAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false }
);

const CommercialRuleSet = mongoose.model("CommercialRuleSet", CommercialRuleSetSchema);

export default CommercialRuleSet;
