import mongoose from "mongoose";

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
    startTime: {
      type: String,
      default: null,
    },
    endTime: {
      type: String,
      default: null,
    },

    // Package snapshot (denormalized at booking time)
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
  },
  { timestamps: true }
);

// Compound indexes
BookingSchema.index({ vendorId: 1, status: 1 });
BookingSchema.index({ vendorId: 1, eventDate: 1 });

export default mongoose.model("Booking", BookingSchema);
