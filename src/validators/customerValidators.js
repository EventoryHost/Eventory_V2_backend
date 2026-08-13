import { z } from "zod";

/**
 * Zod schemas for customer-facing request bodies, consumed by
 * src/middlewares/validateRequest.js. Kept alongside the existing
 * src/validators/*.js (which validate vendor/booking payloads with plain
 * hand-rolled functions) — same folder/purpose, schema-based approach for
 * the customer side going forward.
 */

const MOBILE_REGEX = /^[6-9]\d{9}$/; // 10-digit Indian mobile

// ---- Email + password auth (primary, per the Login/Signup spec) ----

export const customerSignupSchema = z.object({
  name: z.string().trim().min(2, "name must be 2-50 characters").max(50, "name must be 2-50 characters"),
  email: z.string().trim().toLowerCase().email("email must be a valid email address"),
  password: z.string().min(8, "password must be at least 8 characters"),
});

export const customerLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("email must be a valid email address"),
  password: z.string().min(1, "password is required"),
});

export const customerRefreshTokenSchema = z.object({
  // Normally read from the httpOnly cookie; this body fallback only matters
  // for non-browser clients that can't rely on cookies.
  refreshToken: z.string().trim().min(1).optional(),
});

export const linkAccountSchema = z.object({
  provider: z.enum(["google", "facebook"]),
  providerId: z.string().trim().min(1, "providerId is required"),
});

// ---- Phone verification (post-signup, authenticated) ----

export const phoneOtpRequestSchema = z.object({
  mobile: z
    .string()
    .trim()
    .regex(MOBILE_REGEX, "mobile must be a valid 10-digit Indian mobile number"),
});

export const phoneOtpVerifySchema = z.object({
  mobile: z
    .string()
    .trim()
    .regex(MOBILE_REGEX, "mobile must be a valid 10-digit Indian mobile number"),
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "code must be a 4-8 digit numeric OTP"),
  session: z.string().trim().min(1, "session is required"),
});

// ---- Profile update ----

const noDataUri = (val) => typeof val !== "string" || !val.startsWith("data:");

const addressSchema = z.object({
  label: z.string().trim().max(50).optional(),
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  pincode: z.string().trim().max(12).optional(),
  country: z.string().trim().max(100).optional(),
  mapLink: z.string().trim().url("mapLink must be a valid URL").optional(),
  isDefault: z.boolean().optional(),
});

const preferencesSchema = z.object({
  preferredEventCategories: z.array(z.string().trim().max(60)).max(20).optional(),
  notification: z
    .object({
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
    })
    .optional(),
  isDarkMode: z.boolean().optional(),
});

// Phase 5 Step 25 — changing an already-set email. Deliberately its own
// endpoint/schema, not folded into updateCustomerSchema — email is an
// identity field with a real side effect (isEmailVerified reset), same
// reasoning as why it's excluded from SELF_UPDATABLE_FIELDS in
// customerController.js.
export const updateEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email("email must be a valid email address"),
});

export const updateCustomerSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    profilePicture: z
      .string()
      .trim()
      .max(2048)
      .refine(noDataUri, "profilePicture must be a URL, not inline image data")
      .optional(),
    dateOfBirth: z.coerce.date().optional(),
    gender: z.enum(["Male", "Female", "Other", "PreferNotToSay"]).optional(),
    addresses: z.array(addressSchema).max(10).optional(),
    preferences: preferencesSchema.optional(),
  })
  .strict("Unrecognized field in profile update"); // extra hardening on top of the controller's own field whitelist
