import mongoose from "mongoose";
import {
  AttachmentSchema,
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

export const ENQUIRY_STATUSES = [
  "NewEnquiry",
  "Viewed",
  "InDiscussion",
  "AwaitingResponse",
  "ProposalSent",
  "Converted",
  "Declined",
];

// Statuses before the vendor has sent a proposal — all share the same affordances.
export const PRE_PROPOSAL_STATUSES = [
  "NewEnquiry",
  "Viewed",
  "InDiscussion",
  "AwaitingResponse",
];

// Statuses after which nothing about the enquiry can change
export const TERMINAL_ENQUIRY_STATUSES = ["Converted", "Declined"];

export const MATCH_STRENGTHS = ["Strong", "Good", "Weak"];

export const ENQUIRY_PRIORITIES = ["High", "Medium", "Low"];

/**
 * One question the customer answered when raising a price enquiry, e.g.
 * "Expected budget" → "₹35,000 – ₹50,000". Free-form on both sides: the
 * question set is owned by the customer-facing app and changes with it.
 */
const PriceAnswerSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, default: null, trim: true },
  },
  { _id: false }
);

/**
 * An extra the vendor priced into the proposal that was not part of the
 * package — the "custom add-on" rows on the customise-proposal screen.
 */
const CustomAddonSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    qty: { type: Number, default: 1, min: 1 },
    price: { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

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
    // Drives the per-vendor-type requirement layout on the detail screen.
    // Mirrors packageSnapshot.vendorType when the enquiry names a package.
    vendorType: {
      type: String,
      default: null,
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
    location: {
      type: String,
      default: null,
    },
    // Map link / deep-link backing the "See on map" action in the UI
    mapLink: {
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
      enum: [...MATCH_STRENGTHS, null],
      default: null,
    },
    // Lifecycle
    status: {
      type: String,
      enum: ENQUIRY_STATUSES,
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
    // Status transition trail — backs the message card on the detail screen
    respondByAt: { type: Date, default: null },
    viewedAt: { type: Date, default: null },
    proposalSentAt: { type: Date, default: null },
    convertedAt: { type: Date, default: null },
    declinedAt: { type: Date, default: null },
    declineReason: { type: String, default: null },
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
    specialInstructions: [{ type: String }],
    customerMessage: {
      type: String,
      default: null,
    },
    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Package",
      default: null,
    },
    // The package the enquiry is against, carrying the same per-vendor-type
    // deliverables a booking snapshots. Requested changes point into this.
    packageSnapshot: {
      type: PackageSnapshotSchema,
      default: null,
    },
    attachments: [AttachmentSchema],
    priority: {
      type: String,
      enum: [...ENQUIRY_PRIORITIES, null],
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
    // ── What the customer is asking for ──────────────────────
    // Additions/removals against the package snapshot, and the vendor's
    // decision on each. Same shape as a booking's, so conversion is lossless.
    changeRequests: [ChangeRequestSchema],
    // The "Enquiry for Price" answers, when the customer questioned the price
    // rather than the contents.
    priceEnquiry: {
      answers: [PriceAnswerSchema],
      customerNote: { type: String, default: null },
    },
    // ── Vendor-authored pricing ──────────────────────────────
    // Populated as the vendor customises the proposal; the breakdown card is
    // derived from it by `utils/pricingBreakdown.js`.
    pricing: {
      type: PricingSchema,
      default: () => ({}),
    },
    // Derived from the pricing breakdown on every pricing-affecting change
    totalAmount: {
      type: Number,
      default: 0,
    },
    // ── Proposal Details (submitted by vendor) ────────────────
    proposal: {
      // Kept in step with the pricing breakdown's final amount.
      customPrice: {
        type: Number,
        default: null,
      },
      paymentMilestones: [PaymentMilestoneSchema],
      lineItems: [{ type: String }],
      customAddons: [CustomAddonSchema],
      vendorNotes: {
        type: String,
        default: null,
      },
      // Terms & policies the vendor attached to this proposal
      terms: {
        type: String,
        default: null,
      },
      attachments: [AttachmentSchema],
      mediaUrls: [{ type: String }],
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
EnquirySchema.index({ vendorId: 1, eventDate: 1 });

export default mongoose.model("Enquiry", EnquirySchema);
