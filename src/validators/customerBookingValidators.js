import { z } from "zod";

const paginationFields = {
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

// tab defines which Booking.status values are in scope — see
// customerBookingController.js's STATUS_BY_TAB for the exact mapping and
// the reasoning behind where "Declined" lands.
export const bookingsQuerySchema = z.object({
  tab: z.enum(["active", "past", "cancelled"]).default("active"),
  q: z.string().trim().max(100).optional(), // matches bookingId, eventType, or vendor businessName
  sort: z.enum(["newest", "eventDate_asc", "eventDate_desc", "amount_desc"]).default("newest"),
  ...paginationFields,
});

// Same shape the cart carries (CartItem.js's CustomizeRequestSchema) — the
// follow-up round from Review Proposal is built by the same PDP workshop.
// status is deliberately absent: a new request is always Pending.
const customizeRequestSchema = z.object({
  setupId: z.string().trim().min(1).max(200),
  itemId: z.string().trim().min(1).max(200),
  requestType: z.enum(["change", "add", "remove"]),
  label: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(0).max(100000).nullish(),
  type: z.string().trim().max(200).nullish(),
  colours: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  volume: z.string().trim().max(100).nullish(),
});

export const addCustomizeRequestsSchema = z.object({
  requests: z.array(customizeRequestSchema).min(1).max(50),
});

