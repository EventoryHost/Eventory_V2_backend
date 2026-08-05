import mongoose from "mongoose";
import { addressSchema } from "./schemas/addressSchema.js";

/**
 * Customer account model (BRD §21: User + CustomerProfile entities merged
 * into a single document, mirroring the existing Vendor model pattern).
 *
 * Auth is OTP-based via a dedicated Cognito user pool (COGNITO_*_USERS env
 * vars) — no password is ever stored here, consistent with Vendor.js.
 */
const CustomerSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      unique: true,
      required: true,
    },

    // ---- Identity ----
    name: { type: String, trim: true },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true, // allows multiple docs with no email while keeping uniqueness when present
      unique: true,
    },
    phone: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
    },

    // ---- Auth / role ----
    authProvider: {
      type: String,
      enum: ["cognito"],
      default: "cognito",
    },
    role: {
      type: String,
      enum: ["customer"], // kept as an enum (not a free string) so a future
      // admin/staff role can be added deliberately, not accidentally set via API
      default: "customer",
    },

    // ---- Verification status ----
    isPhoneVerified: { type: Boolean, default: false },
    isEmailVerified: { type: Boolean, default: false },
    verificationStatus: {
      type: String,
      enum: ["Unverified", "PhoneVerified", "FullyVerified"],
      default: "Unverified",
    },

    // ---- Profile ----
    profilePicture: String,
    dateOfBirth: Date,
    gender: { type: String, enum: ["Male", "Female", "Other", "PreferNotToSay"] },

    // ---- Saved addresses ----
    addresses: [addressSchema],

    // ---- Preferences ----
    preferences: {
      preferredEventCategories: [String], // Wedding, Birthday, Corporate, etc.
      notification: {
        email: { type: Boolean, default: true },
        sms: { type: Boolean, default: true },
        whatsapp: { type: Boolean, default: false },
      },
      isDarkMode: { type: Boolean, default: false },
    },

    // ---- Account status ----
    isDeactivated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Customer", CustomerSchema);
