import { z } from "zod";

const optionalText = (max) => z.string().trim().max(max).optional();

/**
 * Help panel "Send to an Event Manager" brief (frontend HelpBriefCard).
 * Occasion / guests / budget / vendor type are the brief card's own chip
 * labels, stored verbatim — this is a lead for a person to read, not data
 * anything else filters on.
 */
export const createHelpRequestSchema = z
  .object({
    anon_id: optionalText(64),
    occasion: z.string().trim().min(1).max(60),
    guests: z.string().trim().min(1).max(40),
    budget: z.string().trim().min(1).max(40),
    vendorType: z.string().trim().min(1).max(60),
    area: optionalText(120),
    date: optionalText(60),
    replyMode: z.enum(["reply-here", "call-me"]),
    /** A reference photo is attached on the customer's side; not uploaded. */
    hasPhoto: z.boolean().optional(),
    callTime: optionalText(60),
    phone: optionalText(20),
    pageUrl: optionalText(500),
    /** Last few chat lines, so the Event Manager doesn't ask again. */
    transcript: z.array(z.string().trim().max(500)).max(20).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.replyMode === "call-me" && !(data.phone && data.phone.replace(/\D/g, "").length >= 10)) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "A 10-digit phone number is required for a call back" });
    }
  });

/** Help panel location step: is this area served? */
export const areaCheckQuerySchema = z.object({
  area: z.string().trim().min(1).max(200),
});

/** "Notify me when Eventory begins serving {area}" (out-of-area card). */
export const areaWaitlistSchema = z.object({
  anon_id: optionalText(64),
  area: z.string().trim().min(1).max(200),
  areaSource: z.enum(["typed", "location_tag"]).optional(),
  phone: z
    .string()
    .trim()
    .refine((p) => p.replace(/\D/g, "").length >= 10, "A 10-digit phone number is required"),
  consent: z.literal(true, { error: "WhatsApp consent is required" }),
  occasion: optionalText(60),
  guests: optionalText(40),
  budget: optionalText(40),
  requestText: optionalText(500),
  pageUrl: optionalText(500),
});

/** Customer follow-up in the help thread after the brief is sent. */
export const helpRequestMessageSchema = z.object({
  anon_id: optionalText(64),
  text: z.string().trim().min(1).max(1000),
});

/** "Get a call back" from the status card. */
export const helpRequestCallBackSchema = z.object({
  anon_id: optionalText(64),
  phone: z
    .string()
    .trim()
    .refine((p) => p.replace(/\D/g, "").length >= 10, "A 10-digit phone number is required for a call back"),
});

/** Event Manager reply, posted from the team's side. */
export const helpRequestReplySchema = z.object({
  senderName: z.string().trim().min(1).max(60),
  text: z.string().trim().min(1).max(2000),
});
