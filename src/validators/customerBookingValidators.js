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
