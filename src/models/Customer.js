import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { generateISTId } from "../utils/idGenerator.js";
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
      default: () => generateISTId("CUS"),
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

    // ---- Wishlist share link (Phase 2 Step 10) ----
    // A customer has at most one share link for their whole wishlist (not
    // one per item) — sharing exposes the current live list, not a
    // point-in-time snapshot. wishlistShareToken is only ever generated on
    // first share; wishlistShareEnabled gates whether the public read
    // endpoint honors it, so disabling sharing doesn't burn the token (the
    // same link works again if re-enabled) — only rotating mints a new one.
    // NO `default: null` here — a sparse unique index only skips documents
    // where the field is truly ABSENT, not documents where it's present
    // and explicitly null. `default: null` was giving every customer an
    // explicit null, so the second customer ever created (in the same
    // collection) always failed signup with a duplicate-key error on this
    // index — found via direct testing 2026-08-12, fixed by leaving the
    // field genuinely unset until shareWishlist() first writes a real value.
    wishlistShareToken: { type: String, index: { unique: true, sparse: true } },
    wishlistShareEnabled: { type: Boolean, default: false },

    // ---- Account status ----
    isDeactivated: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    // Explicit collection name — REQUIRED, do not remove. Mongoose's default
    // ("customers") collides with a large pre-existing, still-populated
    // legacy collection of that exact name (43 documents, a totally
    // different customer_name/contact_number/wishlisted_services/
    // applied_coupons-shaped schema from some other system sharing this
    // "dev" database) — discovered 2026-08-07 while building Wishlist
    // (Phase 2 Step 10), the same class of collision as the Review model
    // incident in Step 9. See info.txt Phase 0 for the full writeup.
    collection: "customer_accounts",
  }
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
