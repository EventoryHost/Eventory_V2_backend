import mongoose from "mongoose";
import {
  ChangeRequestSchema,
  PackageSnapshotSchema,
  PaymentMilestoneSchema,
  PricingSchema,
} from "./schemas/negotiationSchemas.js";

export {
  MILESTONE_STATUSES,
  CHANGE_TYPES,
  ITEM_KINDS,
  CHANGE_REQUEST_STATUSES,
} from "./schemas/negotiationSchemas.js";

export const PAYMENT_TYPES = ["FreeBooking", "AdvancePaid", "FullPaid"];

const BOOKING_STATUSES = [
  "NewBooking",
  "Viewed",
  "InDiscussion",
  "Confirmed",
  "Declined",
  "Cancelled",
  "Completed",
];

//Statuses before the vendor has accepted — all share the same affordances.
export const PRE_ACCEPTANCE_STATUSES = ["NewBooking", "Viewed", "InDiscussion"];

// Statuses after which nothing about the booking can change
export const TERMINAL_STATUSES = ["Declined", "Cancelled", "Completed"];

const BookingSchema = new mongoose.Schema(
  {
    bookingId: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Package",
      required: true,
    },

    // Reference to the logged-in customer account this booking belongs to.
    // Optional/nullable: bookings can exist without one (vendor-entered
    // walk-in/offline bookings, enquiry-first bookings for a customer who
    // never created an account) — only a customer-initiated checkout flow
    // is expected to always set this. Existing bookings created before the
    // Customer model existed will have this as null; backfilling them is a
    // deliberate, separate decision (phone-number matching is not exact),
    // not something this field's presence does automatically.
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },

    // Customer info (embedded) — this is the point-in-time snapshot of who
    // booked (same intent as packageSnapshot below): it is NOT kept in sync
    // with the Customer account after creation, and remains the source of
    // truth for "who did this booking say it was for" even if customerId is
    // null or the linked account's details later change.
    customer: {
      name: { type: String, required: true },
      phone: { type: String, default: null },
      email: { type: String, default: null },
    },

    // Event details
    eventType: {
      type: String,
      default: null,
    },
    eventDate: {
      type: Date,
      required: true,
    },
    guestRange: {
      min: { type: Number },
      max: { type: Number },
    },
    location: {
      type: String,
      default: null,
    },
    // Map link / deep-link backing the "See on map" action in the UI
    mapLink: {
      type: String,
      default: null,
    },
    startTime: {
      type: String,
      default: null,
    },
    endTime: {
      type: String,
      default: null,
    },

    packageSnapshot: {
      type: PackageSnapshotSchema,
      default: null,
    },

    // Booking metadata
    paymentType: {
      type: String,
      enum: PAYMENT_TYPES,
      required: true,
    },
    status: {
      type: String,
      enum: BOOKING_STATUSES,
      default: "NewBooking",
    },

    // Status transition trail — backs the message card on the details screen
    respondByAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    declinedAt: { type: Date, default: null },
    declineReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, enum: ["Vendor", "Customer"], default: null },
    cancellationReason: { type: String, default: null },

    // Customer-requested additions/removals, and the vendor's decision on each
    changeRequests: [ChangeRequestSchema],

    pricing: {
      type: PricingSchema,
      default: () => ({}),
    },

    // Payment milestones
    paymentMilestones: [PaymentMilestoneSchema],

    // Derived from the pricing breakdown on every pricing-affecting change
    totalAmount: {
      type: Number,
      default: 0,
    },
    totalReceived: {
      type: Number,
      default: 0,
    },

    notes: {
      type: String,
      default: null,
    },
    // Vendor-private note from the "Calendar Note" section
    calendarNote: {
      type: String,
      default: null,
    },
    // Set when the vendor's account is purged. The booking is the customer's
    // record too, so it is retained and anonymised rather than deleted.
    vendorDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Best-effort auto-link: if a booking is saved without a customerId but has
// a customer.phone, try to match it to an existing Customer account so
// vendor-created bookings (walk-ins, enquiry-first, vendor manually typing
// in a phone number) still end up linked when that phone happens to belong
// to a registered customer — without vendorController/bookingController
// (not touched by this change) needing any awareness of Customer accounts
// at all. Never overwrites an already-set customerId, never fails the save
// if no match is found or the lookup errors — this is purely additive.
BookingSchema.pre("save", async function autoLinkCustomer() {
  if (this.customerId || !this.customer?.phone) return;
  try {
    const normalized = normalizePhone(this.customer.phone);
    if (!normalized) return;
    const match = await Customer.findOne({ phone: normalized }).select("_id").lean();
    if (match) this.customerId = match._id;
  } catch (err) {
    console.warn("[Booking.autoLinkCustomer] lookup failed, continuing without a link:", err.message);
  }
});

// Compound indexes
BookingSchema.index({ vendorId: 1, status: 1 });
BookingSchema.index({ vendorId: 1, eventDate: 1 });
// Supports the customer-facing "my bookings" dashboard (active/past/cancelled
// tabs, sorted/filtered by status or event date) once that endpoint exists.
BookingSchema.index({ customerId: 1, status: 1 });
BookingSchema.index({ customerId: 1, eventDate: 1 });

export default mongoose.model("Booking", BookingSchema);
