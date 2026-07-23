import mongoose from "mongoose";

const CustomizedLineItemSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    amount: { type: Number, required: true },
    qty: { type: Number, default: 1 },
    type: {
      type: String,
      enum: ["Base", "Addon", "Fee", "Discount", "Tax"],
      default: "Addon",
    },
  },
  { _id: false }
);

const CustomizedPackageSchema = new mongoose.Schema(
  {
    packageName: { type: String, default: null },
    basePrice: { type: Number, default: null },
    billingUnit: {
      type: String,
      enum: ["Per Event", "Per Hour", "Per Day", "Per Guest"],
      default: "Per Event",
    },
    lineItems: [CustomizedLineItemSchema],
    totalAmount: { type: Number, default: 0 },
    notes: { type: String, default: null },
    customizedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ChargeSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    // "Base" = per-guest/package line, "Fee" = additional charge (cleaning, etc.)
    type: {
      type: String,
      enum: ["Base", "Fee", "Discount", "Tax"],
      default: "Fee",
    },
  },
  { _id: true }
);

const PaymentMilestoneSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["Token", "Advanced1", "Advanced2", "FinalClearance"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["Pending", "PaymentDue", "Received"],
      default: "Pending",
    },
    receivedDate: {
      type: Date,
      default: null,
    },
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

    // Package snapshot (denormalized at booking time — never mutated after creation)
    packageSnapshot: {
      name: { type: String },
      price: { type: Number },
      image: { type: String },
      vendorType: { type: String },
      variantType: { type: String },
    },

    // Booking metadata
    paymentType: {
      type: String,
      enum: ["FreeBooking", "AdvancePaid", "FullPaid"],
      required: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Accepted", "Declined", "Cancelled", "Completed"],
      default: "Pending",
    },

    // Payment milestones
    paymentMilestones: [PaymentMilestoneSchema],

    // Itemized payment breakdown shown in the "Payment Details" section.
    // Synced from customizedPackage.lineItems when the vendor customizes.
    charges: [ChargeSchema],

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
    // Vendor's per-booking package customization (null = using original packageSnapshot)
    customizedPackage: {
      type: CustomizedPackageSchema,
      default: null,
    },
  },
  { timestamps: true }
);

// Compound indexes
BookingSchema.index({ vendorId: 1, status: 1 });
BookingSchema.index({ vendorId: 1, eventDate: 1 });

export default mongoose.model("Booking", BookingSchema);
