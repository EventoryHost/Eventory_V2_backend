import { z } from "zod";
import mongoose from "mongoose";

const objectId = (label) =>
  z
    .string()
    .trim()
    .refine((v) => mongoose.Types.ObjectId.isValid(v), `${label} must be a valid id`);

export const createTokenPaymentSchema = z.object({
  checkoutSessionId: objectId("checkoutSessionId"),
});
