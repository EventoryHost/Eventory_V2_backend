import mongoose from "mongoose";

const EnquirySchema = new mongoose.Schema(
  {
    enquiryId: {
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

    // Enquiry-specific fields
    budgetMin: {
      type: Number,
      default: null,
    },
    budgetMax: {
      type: Number,
      default: null,
    },
    requests: [{ type: String }],
    matchStrength: {
      type: String,
      enum: ["Strong", "Good", "Weak", null],
      default: null,
    },

    // Lifecycle
    status: {
      type: String,
      enum: [
        "NewEnquiry",
        "AwaitingResponse",
        "ProposalSent",
        "Converted",
        "Declined",
      ],
      default: "NewEnquiry",
    },

    // If converted, link to booking
    convertedBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
    },

    notes: {
      type: String,
      default: null,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Compound indexes
EnquirySchema.index({ vendorId: 1, status: 1 });

export default mongoose.model("Enquiry", EnquirySchema);
