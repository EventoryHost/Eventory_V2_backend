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
    expectedBudgetStr: { type: String, default: null },
    guestCountStr: { type: String, default: null },
    questionnaire: [{
      question: String,
      answer: String,
    }],
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
      url: String,
      name: String,
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
    // ── Detailed Requests & Customisation Data ────────────────
    detailedRequests: [{
      category: String,
      title: String,
      fields: [{ label: String, value: String }],
      sections: [{
        dividerText: String,
        title: String,
        subtitleLabel: String,
        subtitle: String,
        fields: [{ label: String, value: String }]
      }]
    }],
    customiseData: {
      additionsTitle: { type: String, default: null },
      additions: [{
        id: String,
        label: String,
        value: String,
        status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
        image: String
      }],
      groupedAdditions: [{
        dividerText: String,
        title: String,
        subtitle: String,
        items: [{
          id: String,
          label: String,
          value: String,
          status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
          hasColorPicker: Boolean
        }]
      }],
      exclusionsTitle: { type: String, default: null },
      exclusions: [{
        id: String,
        label: String,
        value: String,
        status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
        image: String
      }],
      groupedExclusions: [{
        dividerText: String,
        title: String,
        subtitle: String,
        items: [{
          id: String,
          label: String,
          value: String,
          status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
          suggestedSubstitute: String
        }]
      }],
      equipments: [{
        id: String,
        name: String,
        desc: String,
        qty: Number,
        image: String
      }],
      addons: [{
        id: String,
        name: String,
        desc: String,
        price: Number,
        image: String,
        fields: [{ label: String, value: String }]
      }]
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
      pricing: {
        original: { type: Number, default: 0 },
        itemsAdded: { type: Number, default: 0 },
        addonsAdded: { type: Number, default: 0 },
        substituteItemsAdded: { type: Number, default: 0 },
        itemsRemoved: { type: Number, default: 0 },
        addonsRemoved: { type: Number, default: 0 },
        discount: { type: Number, default: 0 },
        gst: { type: Number, default: 0 },
        finalAmount: { type: Number, default: 0 },
        isOverrideEnabled: { type: Boolean, default: false }
      },
      termsAndPolicies: {
        type: String,
        default: null
      },
      termsAttachmentUrl: {
        type: String,
        default: null
      }
    },
  },
  { timestamps: true }
);
// Compound indexes
EnquirySchema.index({ vendorId: 1, status: 1 });
export default mongoose.model("Enquiry", EnquirySchema);