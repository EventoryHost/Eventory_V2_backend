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

export const MILESTONE_STATUSES = ["Pending", "PaymentDue", "Received"];

export const CHANGE_TYPES = ["Add", "Remove"];

export const ITEM_KINDS = ["Item", "Addon", "Substitute"];

export const CHANGE_REQUEST_STATUSES = ["Pending", "Accepted", "Rejected"];

//The package exactly as the customer bought 
const PackageSnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, immutable: true },
    price: { type: Number, immutable: true },
    image: { type: String, immutable: true },
    vendorType: { type: String, immutable: true },
    variantType: { type: String, immutable: true },
    gstRatePercent: { type: Number, immutable: true, default: null },
    gstInclusive: { type: Boolean, immutable: true, default: false },
    // Vendor-type-specific step-2 payload (spaces, setups, menus, items…).
    deliverables: {
      type: mongoose.Schema.Types.Mixed,
      immutable: true,
      default: null,
    },
  },
  { _id: false }
);

const ChangeRequestSchema = new mongoose.Schema(
  {
    changeType: { type: String, enum: CHANGE_TYPES, required: true },
    itemKind: { type: String, enum: ITEM_KINDS, default: "Item" },
    category: { type: String, required: true, trim: true },
    item: { type: String, required: true, trim: true },
    qty: { type: Number, default: 1, min: 1 },
    status: {
      type: String,
      enum: CHANGE_REQUEST_STATUSES,
      default: "Pending",
    },
    requestedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date, default: null },
  },
  { _id: true }
);

// PDP "Customize items" workshop requests — added 2026-08-27 per the
// frontend team's exact request (their suggested shape, used verbatim).
// DELIBERATELY SEPARATE from ChangeRequestSchema/changeRequests above,
// which already covers a similar-in-spirit "customer requests an item
// change, vendor decides" concept but a different shape (changeType Add/
// Remove only, no "change" type; category/item free text, no setupId;
// no colour/type/volume). Confirmed with the user before adding this
// rather than trying to force the frontend's shape into changeRequests or
// guessing how the two should reconcile — flagged here as a likely future
// duplication worth resolving with whoever owns changeRequests, not
// silently merged. See CartItem.js's CustomizeRequestSchema for the
// customer-side origin of this same shape (Cart -> CheckoutSession line ->
// here, unchanged at each hop). Accept-and-store only, same as upstream —
// no validation against the package's actual item catalog.
const CustomizeRequestSchema = new mongoose.Schema(
  {
    setupId: { type: String, required: true },
    itemId: { type: String, required: true },
    requestType: { type: String, enum: ["change", "add", "remove"], required: true },
    label: { type: String, required: true, trim: true },
    quantity: { type: Number, default: null, min: 0 },
    type: { type: String, default: null, trim: true },
    colours: { type: [String], default: [] },
    volume: { type: String, default: null, trim: true },
  },
  { _id: false }
);

/**
 * Vendor-authored pricing. One cumulative figure per breakdown row — the
 * vendor prices the whole set of additions, not each item — plus the discount
 * and tax rate. Every row of the pricing breakdown comes from here; see
 * `utils/pricingBreakdown.js`.
 *
 * All amounts are positive magnitudes. The breakdown applies the sign.
 */
const PricingSchema = new mongoose.Schema(
  {
    // Overrides packageSnapshot.price when the price was negotiated separately.
    basePrice: { type: Number, default: null },

    itemsAdded: { type: Number, default: 0, min: 0 },
    addonsAdded: { type: Number, default: 0, min: 0 },
    substituteItemsAdded: { type: Number, default: 0, min: 0 },

    itemsRemoved: { type: Number, default: 0, min: 0 },
    addonsRemoved: { type: Number, default: 0, min: 0 },

    discountAmount: { type: Number, default: 0, min: 0 },
    discountLabel: { type: String, default: "Discount Allowed" },
    taxRatePct: { type: Number, default: 18, min: 0, max: 100 },
    taxLabel: { type: String, default: "GST" },
    updatedAt: { type: Date, default: null },
  },
  { _id: false }
);

/**
 * One instalment of the payment plan. Titles are the vendor's own — a booking
 * is not limited to a fixed set of instalments — and mirror the shape an
 * enquiry proposal already uses, so converting one to the other is lossless.
 */
const PaymentMilestoneSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    percentage: { type: Number, default: null, min: 0, max: 100 },
    amount: { type: Number, required: true },
    dueDate: { type: Date, default: null },
    status: { type: String, enum: MILESTONE_STATUSES, default: "Pending" },
    receivedDate: { type: Date, default: null },
  },
  { _id: true }
);

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

    // PDP "Customize items" workshop requests — see CustomizeRequestSchema's
    // own comment above for why this is separate from changeRequests.
    customizeRequests: [CustomizeRequestSchema],

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
