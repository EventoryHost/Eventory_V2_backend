import mongoose from "mongoose";

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

    // Customer info (embedded)
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
    // Set when the vendor's account is purged. The booking is the customer's
    // record too, so it is retained and anonymised rather than deleted.
    vendorDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Compound indexes
BookingSchema.index({ vendorId: 1, status: 1 });
BookingSchema.index({ vendorId: 1, eventDate: 1 });

export default mongoose.model("Booking", BookingSchema);
