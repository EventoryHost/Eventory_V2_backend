import { z } from "zod";

import { MAX_UPLOAD_SIZE, SINGLE_UPLOAD_MAX_SIZE } from "../services/uploadService.js";

const fileName = z
  .string()
  .trim()
  .min(1, "fileName is required")
  .max(255, "fileName must be at most 255 characters")
  .refine((value) => !value.includes("/") && !value.includes("\\"), {
    message: "fileName must not contain a path",
  });

const vendorType = z.string().trim().min(1, "vendorType is required").max(100);

const size = z.coerce
  .number()
  .int("size must be a whole number of bytes")
  .positive("size must be greater than zero");

export const presignSchema = z.object({
  fileName,
  vendorType,
  contentType: z.string().trim().max(255).optional(),
  size: size.max(SINGLE_UPLOAD_MAX_SIZE, "File exceeds the single-upload limit").optional(),
});

export const multipartCreateSchema = z.object({
  fileName,
  vendorType,
  contentType: z.string().trim().max(255).optional(),
  size: size.max(MAX_UPLOAD_SIZE, "File exceeds the maximum upload size"),
});

export const multipartCompleteSchema = z.object({
  key: z.string().trim().min(1, "key is required"),
  uploadId: z.string().trim().min(1, "uploadId is required"),
  parts: z
    .array(
      z.object({
        partNumber: z.coerce.number().int().positive(),
        eTag: z.string().trim().min(1, "eTag is required"),
      }),
    )
    .min(1, "parts must not be empty"),
});

export const multipartAbortSchema = z.object({
  key: z.string().trim().min(1, "key is required"),
  uploadId: z.string().trim().min(1, "uploadId is required"),
});

export const deleteSchema = z
  .object({
    url: z.string().trim().min(1).optional(),
    key: z.string().trim().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.url && !data.key) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "Either url or key is required" });
    }
  });
