import mongoose from "mongoose";
import Customer from "./Customer.js";
import { normalizePhone } from "../utils/phone.js";

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
    // Reference to the logged-in customer account this enquiry belongs to.
    // Optional/nullable — see the matching comment on Booking.customerId for
    // why (vendor-entered/offline enquiries may have no linked account, and
    // backfilling existing records is a separate decision, not automatic).
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },
    // Customer info (embedded) — point-in-time snapshot, not synced with the
    // Customer account afterwards. See Booking.customer for the same intent.
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

// Best-effort auto-link — see the identical hook on Booking.js for the full
// rationale. Additive only: never overwrites an existing customerId, never
// fails the save if no match is found or the lookup errors.
EnquirySchema.pre("save", async function autoLinkCustomer() {
  if (this.customerId || !this.customer?.phone) return;
  try {
    const normalized = normalizePhone(this.customer.phone);
    if (!normalized) return;
    const match = await Customer.findOne({ phone: normalized }).select("_id").lean();
    if (match) this.customerId = match._id;
  } catch (err) {
    console.warn("[Enquiry.autoLinkCustomer] lookup failed, continuing without a link:", err.message);
  }
});

// Compound indexes
EnquirySchema.index({ vendorId: 1, status: 1 });
// Supports a future customer-facing "my enquiries" view.
EnquirySchema.index({ customerId: 1, status: 1 });
export default mongoose.model("Enquiry", EnquirySchema);