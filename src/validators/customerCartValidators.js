import { z } from "zod";
import mongoose from "mongoose";

const validId = (label) =>
  z
    .string()
    .trim()
    .min(1, `${label} must be a valid id`);

// addOnId/itemId are NOT validated as strict ObjectIds — REAL BUG FOUND
// 2026-08-21 (frontend-reported "Cast to ObjectId failed" on add-to-cart):
// the vendor's step2 add-on/item subdocuments have no _id at all for
// almost every currently-seeded package (confirmed against the real dev
// DB), so the frontend correctly falls back to a synthetic id like
// "addon-0" when a package has none. These fields are never used as an
// actual lookup/ref anywhere downstream (CartItem/CheckoutSession just
// carry them through as a display/tracking tag — checked cartPricingService.js,
// customerCartController.js, customerCheckoutController.js, bookingCreationService.js),
// so there's no correctness reason to reject a non-ObjectId value. Matches
// CartItem.js's own field type (String, not ObjectId — same fix applied there).
const selectedAddOnSchema = z.object({
  addOnId: z.string().trim().max(200).optional(),
  name: z.string().trim().min(1).max(200),
  price: z.coerce.number().min(0).default(0),
  quantity: z.coerce.number().int().min(1).default(1),
});

const selectedItemSchema = z.object({
  groupKey: z.string().trim().min(1).max(120),
  itemId: z.string().trim().max(200).optional(),
  itemName: z.string().trim().min(1).max(200),
  price: z.coerce.number().min(0).default(0),
  isChargeable: z.coerce.boolean().default(false),
});

// PDP "Customize items" workshop requests — added 2026-08-27 per frontend's
// exact request (see CartItem.js's own comment for the full context).
// setupId/itemId are plain strings (same reasoning as addOnId/itemId
// above), and no validation against the package's actual item catalog is
// done here — accept-and-store only, matching the existing choose-N gap's
// own "no ground truth on Package to validate against" precedent.
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

// "Notes for vendor" image attachments — added 2026-09-03 (see CartItem.js's
// own comment on noteAttachments for the full context). Real https URLs
// only — the frontend uploads to S3 itself and sends back the resulting
// URL. z.string().url() alone does NOT reject this — confirmed live while
// testing this fix: a "data:image/...;base64,..." string is a technically
// valid URL per the WHATWG spec (the same URL constructor Zod's .url()
// uses under the hood accepts a data: scheme), so it round-tripped straight
// into the database on the first version of this validator. The explicit
// .refine() below is the actual guard — same convention as
// rejectBase64Fields (customerController.js), just enforced per-array-entry
// here instead of on a flat field.
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

export const addCartItemSchema = z.object({
  packageId: validId("packageId"),
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
});

// All optional — a partial update touches only the fields sent, same
// deep-merge philosophy as the vendor-side updatePackageStep.
export const updateCartItemSchema = z.object({
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
  selectedForCheckout: z.coerce.boolean().optional(),
});

export const applyCouponSchema = z.object({
  code: z.string().trim().min(1).max(40),
});
