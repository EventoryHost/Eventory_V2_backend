import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { addressSchema } from "./schemas/addressSchema.js";

/**
 * Customer account model.
 *
 * Auth per the "Customer Login, Signup & Dashboard Specification" (v2.0):
 * email + password (bcrypt, salt rounds 12) as the primary path, with
 * Google/Facebook social login able to create OR link onto the same
 * account (authProviders[] supports more than one provider per customer).
 * Phone is intentionally NOT part of signup — it's collected later (first
 * booking or profile) and verified via the existing Cognito OTP flow,
 * repurposed as a standalone "verify phone" step rather than a way to
 * create an account. See src/controllers/customerPhoneController.js.
 */
const AuthProviderSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["local", "google", "facebook"],
      required: true,
    },
    providerId: { type: String, default: null }, // null for "local" (password-based)
    linkedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

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

    // ---- Auth ----
    // Never returned by default (select: false) — callers that need it for
    // login comparison must explicitly .select("+password").
    password: { type: String, select: false, default: null },
    authProviders: [AuthProviderSchema],
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
      enum: ["Unverified", "EmailVerified", "PhoneVerified", "FullyVerified"],
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

    // ---- Segmentation / dashboard personalization ----
    customerSegment: {
      type: String,
      enum: ["C1", "C2", "C3"], // Gen Z digital-first / Millennial hybrid / Traditional offline
      default: "C1",
    },
    profileCompleteness: { type: Number, default: 0, min: 0, max: 100 },
    lastLogin: { type: Date, default: null },

    // ---- Account status ----
    isDeactivated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Hash password on set/change — never store or compare plaintext.
// Async pre-hooks in Mongoose don't receive a callback `next`; returning
// the promise (implicit via async/await) is what signals completion.
CustomerSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password") || !this.password) return;
  this.password = await bcrypt.hash(this.password, 12); // salt rounds: 12, per spec
});

// Recompute profileCompleteness on every save so it never goes stale.
CustomerSchema.pre("save", function computeCompleteness() {
  const checklist = [
    Boolean(this.name),
    Boolean(this.email),
    Boolean(this.phone),
    Boolean(this.profilePicture),
    Array.isArray(this.addresses) && this.addresses.length > 0,
  ];
  const filled = checklist.filter(Boolean).length;
  this.profileCompleteness = Math.round((filled / checklist.length) * 100);
});

CustomerSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!this.password) return Promise.resolve(false); // no local password set (social-only account)
  return bcrypt.compare(candidate, this.password);
};

export default mongoose.model("Customer", CustomerSchema);
