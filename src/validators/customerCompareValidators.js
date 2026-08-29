import { z } from "zod";
import mongoose from "mongoose";

export const addCompareItemSchema = z.object({
  packageId: z
    .string()
    .trim()
    .min(1, "packageId must be a valid id"),
});

export const compareExportQuerySchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
});
