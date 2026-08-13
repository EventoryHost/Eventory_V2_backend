import { z } from "zod";
import mongoose from "mongoose";

const objectId = (label) =>
  z
    .string()
    .trim()
    .refine((v) => mongoose.Types.ObjectId.isValid(v), `${label} must be a valid id`);

const selectedAddOnSchema = z.object({
  addOnId: objectId("addOnId").optional(),
  name: z.string().trim().min(1).max(200),
  price: z.coerce.number().min(0).default(0),
  quantity: z.coerce.number().int().min(1).default(1),
});

const selectedItemSchema = z.object({
  groupKey: z.string().trim().min(1).max(120),
  itemId: objectId("itemId").optional(),
  itemName: z.string().trim().min(1).max(200),
  price: z.coerce.number().min(0).default(0),
  isChargeable: z.coerce.boolean().default(false),
});

// source:"cart" needs nothing else — pulls the customer's own current cart.
// source:"direct" is a "Book Now" purchase that never touched the cart.
export const createCheckoutSessionSchema = z
  .object({
    source: z.enum(["cart", "direct"]),
    packageId: objectId("packageId").optional(),
    eventType: z.string().trim().max(100).optional(),
    guests: z.coerce.number().int().min(1).optional(),
    date: z.coerce.date().optional(),
    timeSlot: z.string().trim().max(60).optional(),
    location: z.string().trim().max(300).optional(),
    selectedAddOns: z.array(selectedAddOnSchema).max(50).optional(),
    selectedItems: z.array(selectedItemSchema).max(100).optional(),
    specialRequest: z.string().trim().max(500).optional(),
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
  packageId: objectId("packageId").optional(),
  eventType: z.string().trim().max(100).optional(),
  guests: z.coerce.number().int().min(1).optional(),
  date: z.coerce.date().optional(),
  timeSlot: z.string().trim().max(60).optional(),
  location: z.string().trim().max(300).optional(),
  selectedAddOns: z.array(selectedAddOnSchema).max(50).optional(),
  selectedItems: z.array(selectedItemSchema).max(100).optional(),
  specialRequest: z.string().trim().max(500).optional(),
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
