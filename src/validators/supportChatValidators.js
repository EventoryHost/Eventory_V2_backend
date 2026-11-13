import { z } from "zod";
import { SUPPORT_CHAT_TOPICS } from "../models/SupportChat.js";
import { PROFILE_FIELDS } from "../services/supportFlows/businessProfileHelpFlows.js";

const label = z.string().trim().max(200);

const bookingFacts = z.object({
  bookingRef: label,
  stage: z.enum([
    "newBooking",
    "inDiscussion",
    "confirmed",
    "checkedIn",
    "settingUp",
    "takePayment",
    "live",
    "wrappingUp",
    "completed",
    "cancelled",
  ]),
  customerName: label,
  eventName: label,
  eventDate: label,
  isFreeBooking: z.boolean().default(false),
  cancelledByCustomer: z.boolean().default(false),
  timeLeftToRespond: label.nullish(),
  expiresAt: label.nullish(),
  venue: label.nullish(),
  setupDue: label.nullish(),
  eventStart: label.nullish(),
  eventEnd: label.nullish(),
  amountDue: label.nullish(),
  onGroundContact: label.nullish(),
  slot: label.nullish(),
});

/** What the app shows on the chat card; the bot's intro and booking answers use it. */
const chatContext = z
  .object({
    vendorType: label.nullish(),
    packageName: label.default(""),
    totalSteps: z.coerce.number().int().min(1).max(20).nullish(),
    stepName: label.nullish(),
    variantName: label.nullish(),
    booking: bookingFacts.nullish(),
    profileField: z.enum(PROFILE_FIELDS).nullish(),
  })
  .default({});

/** Vendor opens Help on a Package Setup step, the publish screen, a booking or a Business profile screen. */
export const openSupportChatSchema = z
  .object({
    topic: z.enum(SUPPORT_CHAT_TOPICS).default("package_setup"),
    packageId: z.string().trim().min(1).max(64).optional(),
    step: z.coerce.number().int().min(1).max(20).optional(),
    bookingId: z.string().trim().min(1).max(64).optional(),
    context: chatContext,
  })
  .refine((body) => body.topic !== "package_setup" || body.step != null, {
    message: "step is required for package setup help",
    path: ["step"],
  })
  .refine((body) => body.topic !== "booking" || (body.bookingId != null && body.context.booking != null), {
    message: "bookingId and the booking details are required for booking help",
    path: ["bookingId"],
  })
  .refine((body) => body.topic !== "business_profile" || body.context.profileField != null, {
    message: "context.profileField is required for business profile help",
    path: ["context", "profileField"],
  });

/** The vendor tapped one of the quick replies the server offered. */
export const selectSupportOptionSchema = z.object({
  optionId: z.string().trim().min(1).max(100),
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
