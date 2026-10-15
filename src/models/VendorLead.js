import mongoose from "mongoose";
import { generateISTId } from "../utils/idGenerator.js";

/**
 * Pre-signup "Contact Us" lead from the customer-facing Become a Vendor
 * page — someone who typed their name/vendor-type/phone and asked to be
 * called, NOT a real Vendor account (no auth, no onboarding steps started).
 * Deliberately a separate model/collection from Vendor.js, same reasoning
 * as ChatEnquiry.js being kept separate from the vendor-authored
 * Enquiry.js: this represents pre-vendor-selection intent, nothing else.
 *
 * The business admin app is expected to read leads directly from this
 * collection ("vendor_leads") to follow up — there is no webhook/push to
 * it from this backend; this is purely the write side.
 */
const VendorLeadSchema = new mongoose.Schema(
  {
    leadId: { type: String, unique: true, required: true, default: () => generateISTId("VLEAD") },

    name: { type: String, required: true, trim: true },
    // Free-text label (e.g. "Decorator", "Caterer") as shown in the
    // dropdown — not constrained to Vendor.vendorType's enum, since a
    // prospective vendor hasn't gone through any onboarding/category
    // validation yet at this point.
    vendorType: { type: String, required: true, trim: true },
    // Digits only, no country code — +91 is implicit (the form's own fixed
    // prefix), same convention as Vendor.phone elsewhere in this codebase.
    phone: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: ["New", "Contacted", "Converted", "NotInterested"],
      default: "New",
    },
  },
  { timestamps: true, collection: "vendor_leads" }
);

VendorLeadSchema.index({ createdAt: -1 });

export default mongoose.model("VendorLead", VendorLeadSchema);
