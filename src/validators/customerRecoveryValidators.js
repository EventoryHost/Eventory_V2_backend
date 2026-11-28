import { z } from "zod";
import mongoose from "mongoose";

export const recoveryIdParamsSchema = z.object({
  recoveryId: z
    .string()
    .trim()
    .refine((id) => mongoose.Types.ObjectId.isValid(id), "recoveryId must be a valid id"),
});
