import mongoose from "mongoose";

/**
 * Reusable embedded address sub-schema.
 * Used by Customer (saved addresses) and can be reused anywhere
 * a postal address needs to be captured (bookings, invoices, etc).
 */
export const addressSchema = new mongoose.Schema(
  {
    label: {
      type: String, // e.g. "Home", "Office", "Venue"
      trim: true,
    },
    // Recipient details, captured per address by the customer-side Saved
    // Address form (Figma node 1414:9025) — a venue/banquet contact is often
    // not the account holder, so these can't be read off the Customer.
    fullName: { type: String, trim: true },
    phone: { type: String, trim: true },
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    landmark: { type: String, trim: true },
    pincode: { type: String, trim: true },
    country: { type: String, trim: true, default: "India" },
    mapLink: { type: String, trim: true },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true }
);

export default addressSchema;
