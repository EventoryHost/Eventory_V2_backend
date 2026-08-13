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

export const addCartItemSchema = z.object({
  packageId: objectId("packageId"),
  eventType: z.string().trim().max(100).optional(),
  guests: z.coerce.number().int().min(1).optional(),
  date: z.coerce.date().optional(),
  timeSlot: z.string().trim().max(60).optional(),
  location: z.string().trim().max(300).optional(),
  selectedAddOns: z.array(selectedAddOnSchema).max(50).optional(),
  selectedItems: z.array(selectedItemSchema).max(100).optional(),
  specialRequest: z.string().trim().max(500).optional(),
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
  specialRequest: z.string().trim().max(500).optional(),
  quantity: z.coerce.number().int().min(1).optional(),
  selectedForCheckout: z.coerce.boolean().optional(),
});

export const applyCouponSchema = z.object({
  code: z.string().trim().min(1).max(40),
});
