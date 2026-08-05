import { z } from "zod";

/**
 * Zod schemas for customer-facing request bodies, consumed by
 * src/middlewares/validateRequest.js. Kept alongside the existing
 * src/validators/*.js (which validate vendor/booking payloads with plain
 * hand-rolled functions) — same folder/purpose, schema-based approach for
 * the customer side going forward.
 */

const MOBILE_REGEX = /^[6-9]\d{9}$/; // 10-digit Indian mobile, matches customerAuthController

export const customerLoginSchema = z.object({
  mobile: z
    .string()
    .trim()
    .regex(MOBILE_REGEX, "mobile must be a valid 10-digit Indian mobile number"),
  isSignup: z.boolean().optional(),
});

export const customerVerifyOtpSchema = z.object({
  mobile: z
    .string()
    .trim()
    .regex(MOBILE_REGEX, "mobile must be a valid 10-digit Indian mobile number"),
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "code must be a 4-8 digit numeric OTP"),
  session: z.string().trim().min(1, "session is required"),
  // Optional, only meaningful on first-time sign-up
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email("email must be a valid email address").optional(),
});

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
