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
    // ── Additional Detail Fields ─────────────────────────────
    venueName: {
      type: String,
      default: null,
    },
    guestCountMin: {
      type: Number,
      default: null,
    },
    guestCountMax: {
      type: Number,
      default: null,
    },
    mealType: {
      type: String,
      default: null,
    },
    specialInstructions: [{
      type: String,
    }],
    customerMessage: {
      type: String,
      default: null,
    },
    primaryPackage: {
      name: { type: String, default: null },
      price: { type: Number, default: null },
      image: { type: String, default: null },
    },
    attachments: [{
      type: String,
    }],
    priority: {
      type: String,
      enum: ["High", "Medium", "Low", null],
      default: null,
    },
    eventImageUrl: {
      type: String,
      default: null,
    },
    conflictDetected: {
      type: Boolean,
      default: false,
    },
    // ── Proposal Details (submitted by vendor) ────────────────
    proposal: {
      customPrice: {
        type: Number,
        default: null,
      },
      paymentMilestones: [
        {
          title: { type: String, required: true },
          percentage: { type: Number, required: true },
          amount: { type: Number, required: true },
        },
      ],
      lineItems: [{
        type: String,
      }],
      vendorNotes: {
        type: String,
        default: null,
      },
      attachments: [{
        type: String,
      }],
      mediaUrls: [{
        type: String,
      }],
      submittedAt: {
        type: Date,
        default: null,
      },
    },
  },
  { timestamps: true }
);
// Compound indexes
EnquirySchema.index({ vendorId: 1, status: 1 });
export default mongoose.model("Enquiry", EnquirySchema);