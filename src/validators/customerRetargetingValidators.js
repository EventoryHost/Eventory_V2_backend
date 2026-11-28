import { z } from "zod";
import mongoose from "mongoose";

const objectId = (label) =>
  z
    .string()
    .trim()
    .refine((id) => mongoose.Types.ObjectId.isValid(id), `${label} must be a valid id`);

export const campaignIdParamsSchema = z.object({ campaignId: objectId("campaignId") });

export const retargetingClickSchema = z.object({ packageId: objectId("packageId").optional() });
