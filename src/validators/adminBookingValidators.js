import { z } from "zod";
import Booking, {
  PAYMENT_TYPES,
  MILESTONE_STATUSES,
  CHANGE_TYPES,
  ITEM_KINDS,
  CHANGE_REQUEST_STATUSES,
} from "../models/Booking.js";

/**
 * Body schema for the admin's full-control booking edit
 * (PUT /api/admin/bookings/:bookingId — see adminBookingController.js's
 * updateBooking for how each key is applied).
 *
 * Every key is optional and only the keys present are applied. Keys this
 * schema doesn't declare — bookingId, _id, createdAt/updatedAt,
 * packageSnapshot (schema-immutable), totalAmount (derived from pricing) —
 * are stripped by validateRequest, so none of those can be written even by
 * a client that sends a whole booking object back. Every key that IS sent
 * counts as an edit, though (a totalReceived is an override, a pricing
 * object re-prices), so the admin UI sends only the keys that changed.
 */

// Booking.js doesn't export its status list (only the PRE_ACCEPTANCE/
// TERMINAL groupings), so read it off the schema rather than retyping it —
// stays correct if the enum changes.
const BOOKING_STATUSES = Booking.schema.path("status").enumValues;

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
// "HH:MM" 24h. The hour's leading zero is optional because checkout-created
// bookings store the slot exactly as the package's slot value was typed
// (bookingCreationService.js matches \d{1,2}:\d{2}), so a "9:00" already on
// a booking must still round-trip through this form.
const TIME_HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
// Date-only ("2026-10-12") or a full ISO timestamp.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;

// A cleared text input arrives as "" — store null, which is what every
// nullable field on Booking uses for "not set".
const blankToNull = (schema) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    schema.nullable()
  );

const nullableString = (max) => blankToNull(z.string().trim().max(max));

const objectId = z.string().trim().regex(OBJECT_ID, "must be a valid id");

const time = z.string().trim().regex(TIME_HHMM, "must be a time in HH:MM (24h) format");
const nullableTime = blankToNull(time);

// Date.parse rolls an impossible day over instead of rejecting it
// ("2026-02-31" -> 3 March), so the calendar date itself is checked too.
const isCalendarDate = (value) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
};

const isoDate = z
  .string()
  .trim()
  .regex(ISO_DATE, "must be an ISO date string")
  .refine((value) => !Number.isNaN(Date.parse(value)) && isCalendarDate(value), "must be a valid date")
  .transform((value) => new Date(value));
const nullableDate = blankToNull(isoDate);

const amount = z.number().min(0);

const customerSchema = z.object({
  name: z.string().trim().min(1, "customer.name is required").max(200).optional(),
  phone: nullableString(30).optional(),
  email: nullableString(320).optional(),
});

const eventTimingSchema = z.object({
  startTime: nullableTime.optional(),
  endTime: nullableTime.optional(),
});

const guestRangeSchema = z
  .object({
    min: z.number().int().min(0).nullable().optional(),
    max: z.number().int().min(0).nullable().optional(),
  })
  .refine(
    (range) => range.min == null || range.max == null || range.min <= range.max,
    { message: "guestRange.min cannot be greater than guestRange.max", path: ["min"] }
  );

const pricingSchema = z.object({
  basePrice: amount.nullable().optional(),
  itemsAdded: amount.optional(),
  addonsAdded: amount.optional(),
  itemsRemoved: amount.optional(),
  addonsRemoved: amount.optional(),
  discountAmount: amount.optional(),
  discountLabel: z.string().trim().max(100).optional(),
  taxRatePct: z.number().min(0).max(100).optional(),
  taxLabel: z.string().trim().max(50).optional(),
});

// Array entries mirror the subdocument schemas in Booking.js /
// negotiationSchemas.js field for field. `_id` is optional: supplied, it is
// kept (and matched against the stored entry); left out, Mongoose mints one.
const paymentMilestoneSchema = z.object({
  _id: objectId.optional(),
  title: z.string().trim().min(1).max(200),
  percentage: z.number().min(0).max(100).nullable().optional(),
  amount,
  dueDate: nullableDate.optional(),
  status: z.enum(MILESTONE_STATUSES).optional(),
  receivedDate: nullableDate.optional(),
});

const changeRequestSchema = z.object({
  _id: objectId.optional(),
  changeType: z.enum(CHANGE_TYPES),
  itemKind: z.enum(ITEM_KINDS).optional(),
  category: z.string().trim().min(1).max(200),
  item: z.string().trim().min(1).max(200),
  qty: z.number().min(1).optional(),
  status: z.enum(CHANGE_REQUEST_STATUSES).optional(),
  requestedAt: isoDate.optional(),
  respondedAt: nullableDate.optional(),
});

const customizeRequestSchema = z.object({
  _id: objectId.optional(),
  setupId: z.string().trim().min(1).max(200),
  itemId: z.string().trim().min(1).max(200),
  requestType: z.enum(["change", "add", "remove"]),
  label: z.string().trim().min(1).max(200),
  quantity: z.number().min(0).nullable().optional(),
  type: nullableString(100).optional(),
  colours: z.array(z.string().trim().max(50)).max(20).optional(),
  volume: nullableString(50).optional(),
  status: z.enum(CHANGE_REQUEST_STATUSES).optional(),
});

const selectedAddOnSchema = z.object({
  addOnId: nullableString(200).optional(),
  name: z.string().trim().min(1).max(200),
  price: amount.optional(),
  quantity: z.number().int().min(1).optional(),
  category: nullableString(100).optional(),
  subCategory: nullableString(100).optional(),
  color: nullableString(50).optional(),
  image: nullableString(2000).optional(),
});

// .url() accepts any scheme (see customerCartValidators.js's
// noteAttachmentsSchema on the data: URI it let through). A prefix check
// misses "DATA:" (schemes are case-insensitive) and "javascript:", so this
// allow-lists http(s) instead — the same rule as the admin UI's isHttpUrl.
const isHttpUrl = (value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const noteAttachmentsSchema = z
  .array(
    z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine(isHttpUrl, "Attachments must be an uploaded http(s) file URL, not a base64 data URI")
  )
  .max(20);

// Two entries sharing an _id would both be stored, and every .id(x) lookup
// (Payment.milestoneId, the vendor's accept/decline) only finds the first.
const uniqueIds = (entries, ctx) => {
  const seen = new Set();
  entries.forEach((entry, index) => {
    if (!entry._id) return;
    const key = entry._id.toLowerCase();
    if (seen.has(key)) {
      ctx.addIssue({ code: "custom", message: "duplicate id", path: [index, "_id"] });
    }
    seen.add(key);
  });
};

export const adminUpdateBookingSchema = z.object({
  // Who / linked account
  customer: customerSchema.optional(),
  customerId: nullableString(100).optional(),

  // Event
  eventType: nullableString(100).optional(),
  eventDate: isoDate.optional(),
  startTime: nullableTime.optional(),
  endTime: nullableTime.optional(),
  eventTiming: eventTimingSchema.optional(),
  guestRange: guestRangeSchema.optional(),
  location: nullableString(500).optional(),
  mapLink: nullableString(2000).optional(),

  // Lifecycle — a free override: any status, from any status
  status: z.enum(BOOKING_STATUSES).optional(),
  respondByAt: nullableDate.optional(),
  confirmedAt: nullableDate.optional(),
  declinedAt: nullableDate.optional(),
  cancelledAt: nullableDate.optional(),
  declineReason: nullableString(1000).optional(),
  cancellationReason: nullableString(1000).optional(),
  cancelledBy: z.enum(["Vendor", "Customer"]).nullable().optional(),

  // Money
  paymentType: z.enum(PAYMENT_TYPES).optional(),
  convenienceFee: amount.nullable().optional(),
  convenienceFeeBreakdown: z.unknown().optional(),
  totalReceived: amount.optional(),
  pricing: pricingSchema.optional(),
  paymentMilestones: z.array(paymentMilestoneSchema).max(50).superRefine(uniqueIds).optional(),

  // Negotiation (full replace)
  changeRequests: z.array(changeRequestSchema).max(200).superRefine(uniqueIds).optional(),
  customizeRequests: z.array(customizeRequestSchema).max(200).superRefine(uniqueIds).optional(),
  selectedAddOns: z.array(selectedAddOnSchema).max(100).optional(),

  // Notes
  notes: nullableString(5000).optional(),
  eventNote: nullableString(5000).optional(),
  calendarNote: nullableString(5000).optional(),
  noteAttachments: noteAttachmentsSchema.optional(),

  // Assignment
  vendorId: z.string().trim().min(1).max(100).optional(),
  packageId: z.string().trim().min(1).max(100).optional(),
  assignedEmId: nullableString(100).optional(),
  assignedEmName: nullableString(200).optional(),
  vendorDeleted: z.boolean().optional(),

  // Not stored — saves through a vendor date conflict instead of a 409
  allowConflict: z.boolean().optional(),
});

export default { adminUpdateBookingSchema };
