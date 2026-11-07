import { z } from "zod";
import { SUPPORT_CHAT_TOPICS } from "../models/SupportChat.js";

const transcriptLine = z.object({
  from: z.enum(["bot", "vendor"]),
  text: z.string().trim().min(1).max(2000),
  at: z.coerce.date(),
});

const transcript = z.array(transcriptLine).max(200);

/** Vendor opens Help on a Package Setup step, the publish screen or a booking. */
export const openSupportChatSchema = z
  .object({
    topic: z.enum(SUPPORT_CHAT_TOPICS).default("package_setup"),
    packageId: z.string().trim().min(1).max(64).optional(),
    step: z.coerce.number().int().min(1).max(20).optional(),
    bookingId: z.string().trim().min(1).max(64).optional(),
  })
  .refine((body) => body.topic !== "package_setup" || body.step != null, {
    message: "step is required for package setup help",
    path: ["step"],
  })
  .refine((body) => body.topic !== "booking" || body.bookingId != null, {
    message: "bookingId is required for booking help",
    path: ["bookingId"],
  });

/** Handover / call request / "Yes, that helps" — the quick replies so far. */
export const supportTranscriptSchema = z.object({
  transcript: transcript.default([]),
});

const messageBody = {
  text: z.string().trim().max(2000).default(""),
  imageUrls: z.array(z.string().trim().url().startsWith("https://").max(2048)).max(4).default([]),
};

const hasContent = [
  (body) => body.text.length > 0 || body.imageUrls.length > 0,
  { message: "A message needs text or a photo", path: ["text"] },
];

export const vendorSupportMessageSchema = z.object(messageBody).refine(...hasContent);

/** Who the Event Manager is, as the admin panel sends it on every call. */
const emIdentity = {
  emId: z.string().trim().max(64).optional(),
  emName: z.string().trim().min(1).max(60),
};

export const emJoinSchema = z.object(emIdentity);

export const emMessageSchema = z
  .object({
    ...emIdentity,
    ...messageBody,
  })
  .refine(...hasContent);

export const emResolveSchema = z.object({
  emId: emIdentity.emId,
  emName: z.string().trim().max(60).optional(),
});

export const adminSupportChatListSchema = z.object({
  status: z.enum(["automated", "call_requested", "waiting_for_em", "with_em", "resolved"]).optional(),
  topic: z.enum(SUPPORT_CHAT_TOPICS).optional(),
  ticket: z.string().trim().max(20).optional(),
  emId: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
