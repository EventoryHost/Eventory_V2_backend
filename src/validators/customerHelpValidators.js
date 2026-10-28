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
    /** Optional on the brief ("Not sure yet" when left out). */
    vendorType: optionalText(60),
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
    /** The help panel chat it's raised in; the ticket stays in it. */
    conversationId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
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
  areaSource: z.enum(["typed", "location_tag", "current_location"]).optional(),
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
  /** The panel's id for this message, so it's stored once. */
  clientId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

/** "Request a call back" screen: number, when, and what it's about. */
export const helpRequestCallBackSchema = z.object({
  anon_id: optionalText(64),
  phone: z
    .string()
    .trim()
    .refine((p) => p.replace(/\D/g, "").length >= 10, "A 10-digit phone number is required for a call back"),
  /** A call-time option label; left out = as soon as possible. */
  window: optionalText(60),
  note: optionalText(500),
});

/** The customer opened WhatsApp from a ticket. */
export const helpRequestWhatsAppSchema = z.object({
  anon_id: optionalText(64),
});

/** Booking help: a request about the customer's own bookings, for their Event Manager. */
export const bookingHelpRequestSchema = z.object({
  bookingRefs: z.array(z.string().trim().min(1).max(64)).min(1).max(10),
  /** What it's about, e.g. "Change guest count". */
  topic: z.string().trim().min(1).max(120),
  /** The customer's own words. */
  text: z.string().trim().min(1).max(1000),
  /** Structured details, one line each ("New guest count: 100"). */
  details: z.array(z.string().trim().max(300)).max(20).optional(),
  /** The panel's id for the first message, so it's stored once. */
  clientId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
  conversationId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
  transcript: z.array(z.string().trim().max(500)).max(20).optional(),
  pageUrl: optionalText(500),
  /** Event-day problem report (GRV ref) instead of a request. */
  report: z
    .object({
      /** Issue key from the panel, e.g. "noshow", "missing", "safety". */
      issue: z.string().trim().min(1).max(40),
      label: z.string().trim().min(1).max(120),
      /** The package it's about; null = not sure / the venue. */
      packageRef: z.string().trim().max(64).nullable().optional(),
      /** Safety / no-show: the duty manager is alerted too. */
      urgent: z.boolean().optional(),
      photoUrl: z.string().url().max(500).optional(),
      missing: z.array(z.string().trim().max(200)).max(30).optional(),
    })
    .optional(),
});

/** Event day: the customer revealed a vendor's on-ground number. */
export const vendorContactSchema = z.object({
  bookingRef: z.string().trim().min(1).max(64),
});

/** The team resolves (or reopens) a ticket. */
export const helpRequestStatusSchema = z.object({
  status: z.enum(["closed", "open"]),
  /** Who did it, for the thread line. */
  senderName: optionalText(60),
});

/** Event Manager reply, posted from the team's side. */
export const helpRequestReplySchema = z.object({
  /** The Event Manager's id on the team's side, if it has one. */
  senderId: optionalText(64),
  senderName: z.string().trim().min(1).max(60),
  text: z.string().trim().min(1).max(2000),
});

/** Help panel conversation save (the "Your chats" tab). */
export const helpConversationSaveSchema = z.object({
  anon_id: optionalText(64),
  items: z.array(z.record(z.string(), z.unknown())).max(400),
  state: z.record(z.string(), z.unknown()).nullable().optional(),
  enquiryId: optionalText(64),
  ticket: optionalText(20),
});
