import { z } from "zod";
import mongoose from "mongoose";

const objectId = (label) =>
  z
    .string()
    .trim()
    .refine((v) => mongoose.Types.ObjectId.isValid(v), `${label} must be a valid id`);

/**
 * A wishlist item is either a Package save (packageId set, vendorId absent)
 * or a Vendor save (vendorId set, packageId absent) — never both, never
 * neither. superRefine enforces that pairing since zod's discriminated
 * union would otherwise require the client to nest packageId/vendorId under
 * a type-specific key instead of the flatter shape the rest of this API
 * uses.
 */
export const addWishlistItemSchema = z
  .object({
    itemType: z.enum(["Package", "Vendor"]),
    packageId: objectId("packageId").optional(),
    vendorId: objectId("vendorId").optional(),
    note: z.string().trim().max(500, "note must be at most 500 characters").optional(),
  })
  .superRefine((data, ctx) => {
    if (data.itemType === "Package" && !data.packageId) {
      ctx.addIssue({ code: "custom", path: ["packageId"], message: "packageId is required when itemType is Package" });
    }
    if (data.itemType === "Package" && data.vendorId) {
      ctx.addIssue({ code: "custom", path: ["vendorId"], message: "vendorId must not be set when itemType is Package" });
    }
    if (data.itemType === "Vendor" && !data.vendorId) {
      ctx.addIssue({ code: "custom", path: ["vendorId"], message: "vendorId is required when itemType is Vendor" });
    }
    if (data.itemType === "Vendor" && data.packageId) {
      ctx.addIssue({ code: "custom", path: ["packageId"], message: "packageId must not be set when itemType is Vendor" });
    }
  });

export const updateWishlistNoteSchema = z.object({
  note: z.string().trim().max(500, "note must be at most 500 characters"),
});

export const wishlistShareQuerySchema = z.object({
  rotate: z.coerce.boolean().optional(),
});
