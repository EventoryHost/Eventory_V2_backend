import { z } from "zod";
import mongoose from "mongoose";

const validId = (label) =>
  z
    .string()
    .trim()
    .min(1, `${label} must be a valid id`);

// addOnId/itemId NOT validated as strict ObjectIds — same real bug/fix as
// customerCartValidators.js's identical schemas (2026-08-21, frontend-reported).
// category/subCategory/color/image — same 2026-09-17 addition as
// customerCartValidators.js's identical schema; kept in sync since checkout
// lines can be updated directly (see updateCheckoutLine below), not just
// copied over from the cart at checkout-start.
const selectedAddOnSchema = z.object({
  addOnId: z.string().trim().max(200).optional(),
  name: z.string().trim().min(1).max(200),
  price: z.coerce.number().min(0).default(0),
  quantity: z.coerce.number().int().min(1).default(1),
  category: z.string().trim().max(100).optional(),
  subCategory: z.string().trim().max(100).optional(),
  color: z.string().trim().max(50).optional(),
  image: z.string().trim().max(2000).optional(),
});

const selectedItemSchema = z.object({
  groupKey: z.string().trim().min(1).max(120),
  itemId: z.string().trim().max(200).optional(),
  itemName: z.string().trim().min(1).max(200),
  price: z.coerce.number().min(0).default(0),
  isChargeable: z.coerce.boolean().default(false),
});

// PDP "Customize items" workshop requests — same shape/reasoning as
// customerCartValidators.js's identical schema (2026-08-27).
const customizeRequestSchema = z.object({
  setupId: z.string().trim().min(1).max(200),
  itemId: z.string().trim().min(1).max(200),
  requestType: z.enum(["change", "add", "remove"]),
  label: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().min(0).optional(),
  type: z.string().trim().max(100).optional(),
  colours: z.array(z.string().trim().max(50)).max(20).optional(),
  volume: z.string().trim().max(50).optional(),
});

// "Notes for vendor" image attachments — same shape/reasoning as
// customerCartValidators.js's identical schema (2026-09-03), including the
// explicit data: URI rejection (z.string().url() alone does NOT reject
// one — confirmed live, see that file's own comment for the full story).
const noteAttachmentsSchema = z
  .array(
    z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine((url) => !url.startsWith("data:"), "Attachments must be an uploaded file URL, not a base64 data URI")
  )
  .max(5)
  .optional();

// source:"cart" needs nothing else — pulls the customer's own current cart.
// source:"direct" is a "Book Now" purchase that never touched the cart.
export const createCheckoutSessionSchema = z
  .object({
    source: z.enum(["cart", "direct"]),
    packageId: validId("packageId").optional(),
    eventType: z.string().trim().max(100).optional(),
    guests: z.coerce.number().int().min(1).optional(),
    date: z.coerce.date().optional(),
    timeSlot: z.string().trim().max(60).optional(),
    location: z.string().trim().max(300).optional(),
    selectedAddOns: z.array(selectedAddOnSchema).max(50).optional(),
    selectedItems: z.array(selectedItemSchema).max(100).optional(),
    customizeRequests: z.array(customizeRequestSchema).max(100).optional(),
    specialRequest: z.string().trim().max(500).optional(),
    noteAttachments: noteAttachmentsSchema,
    quantity: z.coerce.number().int().min(1).default(1),
  })
  .superRefine((data, ctx) => {
    if (data.source === "direct" && !data.packageId) {
      ctx.addIssue({ code: "custom", path: ["packageId"], message: "packageId is required when source is 'direct'" });
    }
  });

export const updateCheckoutLineSchema = z.object({
  // Switch to a sibling variant of the SAME logical package (validated
  // server-side against packageGroupId) — not a way to swap to an unrelated
  // package; that goes through Cart/PDP instead.
  packageId: validId("packageId").optional(),
  eventType: z.string().trim().max(100).optional(),
  guests: z.coerce.number().int().min(1).optional(),
  date: z.coerce.date().optional(),
  timeSlot: z.string().trim().max(60).optional(),
  location: z.string().trim().max(300).optional(),
  selectedAddOns: z.array(selectedAddOnSchema).max(50).optional(),
  selectedItems: z.array(selectedItemSchema).max(100).optional(),
  customizeRequests: z.array(customizeRequestSchema).max(100).optional(),
  specialRequest: z.string().trim().max(500).optional(),
  noteAttachments: noteAttachmentsSchema,
  quantity: z.coerce.number().int().min(1).optional(),
});

// Phase 4 Step 17 — final BRD Section 10.5: "Contact name (2–100 chars),
// phone (valid Indian mobile, OTP-verified on first use), email (valid,
// optional if phone verified)." Whether phone is ACTUALLY verified is
// checked server-side against the customer's real profile, not by this
// schema (see customerCheckoutController.js) — this only validates shape.
const MOBILE_REGEX = /^[6-9]\d{9}$/;
export const updateContactDetailsSchema = z
  .object({
    name: z.string().trim().min(2, "name must be 2-100 characters").max(100, "name must be 2-100 characters").optional(),
    phone: z.string().trim().regex(MOBILE_REGEX, "phone must be a valid 10-digit Indian mobile number").optional(),
    email: z.string().trim().toLowerCase().email("email must be a valid email address").optional(),
  })
  .refine((data) => data.name !== undefined || data.phone !== undefined || data.email !== undefined, {
    message: "Provide at least one of name, phone, or email",
  });

// "When's the event?" (Contact page's EventTimingSection.tsx) — "HH:MM" 24h,
// same TIME_OPTIONS half-hour-step values the frontend's picker already
// generates. Not required to both be present together (letting one field
// save on its own change, like updateContactDetailsSchema above), but when
// both are present end must be after start — a real, checkable business
// rule, unlike start/end being independently optional.
const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
export const updateEventTimingSchema = z
  .object({
    startTime: z.string().trim().regex(HHMM_REGEX, "startTime must be HH:MM (24h)").optional(),
    endTime: z.string().trim().regex(HHMM_REGEX, "endTime must be HH:MM (24h)").optional(),
  })
  .refine((data) => data.startTime !== undefined || data.endTime !== undefined, {
    message: "Provide at least one of startTime or endTime",
  })
  .refine((data) => !(data.startTime && data.endTime) || data.endTime > data.startTime, {
    message: "endTime must be after startTime",
    path: ["endTime"],
  });
