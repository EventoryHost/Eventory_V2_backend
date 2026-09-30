import mongoose from "mongoose";
import { generateISTId } from "../utils/idGenerator.js";
import {
  VendorVerificationSchema,
  VendorVerificationEventSchema,
} from "./schemas/vendorVerificationSchema.js";
import { VENDOR_STEPS } from "../constants/vendorSteps.js";
import {
  hasVerificationStatus,
  legacyVerification,
} from "../utils/vendorVerificationLegacy.js";
import { computeCompletion } from "../utils/profileCompletion.js";
import { deriveStatus } from "../utils/vendorVerificationStatus.js";

const VendorSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true,
    default: () => generateISTId("VEN"),
  },

  businessName: String,
  isIndividual: {
    type: Boolean,
    default: false,
  },
  pocName: String,
  pocPhone: String,

  // Points of contact beyond the primary pocName / pocPhone pair.
  additionalPocs: [{
    name: String,
    phone: String,
  }],

  vendorType: String,
  eventCategories: [String],

  email: String,
  phone: String,

  city: String,
  state: String,
  serviceAreas: [String],

  teamSize: String,
  bookingsPerYear: String,
  experience: String,

  profilePicture: String,
  description: String,
  businessPhotos: [String],
  coverImage: String,

  aadharNumber: String,
  isAadharVerified: {
    type: Boolean,
    default: false,
  },
  panNumber: String,
  isPanVerified: {
    type: Boolean,
    default: false,
  },
  gstNumber: String,
  isGstVerified: {
    type: Boolean,
    default: false,
  },
  // GST is optional: the vendor may Skip it on the GSTIN screen. Recorded so a
  // deliberate skip is told apart from a step not yet reached — package
  // submission requires GST verified or skipped. Cleared when a GSTIN is
  // verified.
  isGstSkipped: {
    type: Boolean,
    default: false,
  },
  
  isFaceMatchVerified: {
    type: Boolean,
    default: false,
  },
  faceMatchScore: {
    type: Number,
    default: null,
  },

  //business documents
  fssaiNumber: String,
  isFssaiVerified: {
    type: Boolean,
    default: false,
  },
  fssaiDocUrl: String,
  
  tradeLicenseNumber: String,
  isTradeLicVerified: {
    type: Boolean,
    default: false,
  },
  tradeLicUrl: String,
  
  gstDocUrl: String,
  
  fssaiLicense: String,
  tradeLicense: String,
  gstCertificate: String,

  bankDetails: [{
    beneficiaryId: String,
    beneficiaryName: String,
    accountNumber: String,
    ifscCode: String,
    bankName: String,
    branchName: String,
  }],

  // Customer-visible "verified" badge (utils/publicFields.js reads it). Set
  // when both review groups are approved, cleared when the admin sends a group
  // back or rejects it; a verified vendor's own edit leaves it on ("Needs
  // Action"). Only the verification service writes it.
  isVerified: {
    type: Boolean,
    default: false,
  },

  agreementDocUrl: String,
  isAgreementAccepted: {
    type: Boolean,
    default: false,
  },
  agreementAcceptedAt: Date,

  isDeactivated: {
    type: Boolean,
    default: false,
  },

  // Step-by-step admin review; see schemas/vendorVerificationSchema.js and
  // services/vendorVerificationService.js.
  verification: {
    type: VendorVerificationSchema,
    default: () => ({}),
  },
  verificationHistory: {
    type: [VendorVerificationEventSchema],
    default: [],
  },

  // DEPRECATED — superseded by `verification.steps`. Still read (for vendors
  // not yet migrated), no longer written.
  adminReview: {
    businessProfile:  { status: { type: String, enum: ["Approved", "Rejected", "Pending"] }, notes: String, reviewedAt: Date },
    contactAndLocation: { status: { type: String, enum: ["Approved", "Rejected", "Pending"] }, notes: String, reviewedAt: Date },
    experienceAndTeam: { status: { type: String, enum: ["Approved", "Rejected", "Pending"] }, notes: String, reviewedAt: Date },
    photosAndBranding: { status: { type: String, enum: ["Approved", "Rejected", "Pending"] }, notes: String, reviewedAt: Date },
    kycDocuments:     { status: { type: String, enum: ["Approved", "Rejected", "Pending"] }, notes: String, reviewedAt: Date },
    businessLicenses: { status: { type: String, enum: ["Approved", "Rejected", "Pending"] }, notes: String, reviewedAt: Date },
    bankDetails:      { status: { type: String, enum: ["Approved", "Rejected", "Pending"] }, notes: String, reviewedAt: Date },
    agreement:        { status: { type: String, enum: ["Approved", "Rejected", "Pending"] }, notes: String, reviewedAt: Date },
  },
  // Set when the vendor requests deletion from the app. Distinct from
  // isDeactivated, which support also sets on its own: a deletion request
  // deactivates the account *and* starts the retention window, and unlike a
  // support deactivation the vendor can still sign in to cancel it.
  // Cleared on cancellation; the purge job keys off this date.
  deletionRequestedAt: {
    type: Date,
    default: null,
  },

  isDarkMode: {
    type: Boolean,
    default: false,
  },

  rating: {
    type: Number,
    default: 0,
  },
  reviewsCount: {
    type: Number,
    default: 0,
  },
  // How many customers have this vendor on a wishlist — the sum of direct
  // "Vendor" saves AND "Package" saves of any package this vendor owns (a
  // customer who saves three of this vendor's packages counts three times,
  // which is what the "N+ Wishlisted" stat on the vendor card means).
  //
  // Denormalized on purpose, same pattern as rating/reviewsCount above: the
  // vendor listing reads it through PUBLIC_VENDOR_FIELDS on the already-
  // populated vendorId of every browse row, so the stat costs zero extra
  // queries. Maintained by $inc in customerWishlistController.js — see
  // src/utils/wishlistCount.js, and recomputeVendorWishlistCounts.mjs for
  // the backfill/reconciliation pass that repairs the drift any $inc
  // counter eventually accumulates.
  wishlistCount: {
    type: Number,
    default: 0,
  },
  assignedEmId: {
    type: String,
    default: null,
  },
  assignedEmName: {
    type: String,
    default: null,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

VendorSchema.index({ "verification.status": 1, createdAt: -1 });

// A vendor saved before step verification has no `verification`. Fill it in
// from the legacy fields as it loads, so the rest of the code never has to ask
// (the lean-query equivalent is effectiveVerification()). Only a document
// loaded with every field it needs is backfilled — a projected read can't
// derive the status correctly.
VendorSchema.pre("init", function (raw) {
  if (!raw || hasVerificationStatus(raw)) return;
  if (!("isVerified" in raw)) return;
  raw.verification = { ...(raw.verification || {}), ...legacyVerification(raw) };
  this.$locals.verificationBackfilled = true;
});

// Every path computeCompletion and deriveStatus read.
const COMPLETION_PATHS = [
  "verification",
  "isVerified",
  "adminReview",
  ...new Set(VENDOR_STEPS.flatMap((s) => s.fields)),
];

// Keep the derived fields (completionPercent, status) in sync on every
// document save: the verification service, the KYC verification controller,
// signup. Skipped for a projected document, which can't compute them.
VendorSchema.pre("save", function syncVerificationMirror() {
  if (!COMPLETION_PATHS.every((p) => this.isSelected(p))) return;
  // Persist a backfilled legacy verification whole, not as a few sub-paths.
  if (this.$locals.verificationBackfilled) {
    this.markModified("verification");
    this.$locals.verificationBackfilled = false;
  }
  const percent = computeCompletion(this).percent;
  if (this.verification.completionPercent !== percent) {
    this.verification.completionPercent = percent;
  }
  // A new vendor is never verified, whatever the create body said.
  if (this.isNew && this.isVerified) this.isVerified = false;
  const status = deriveStatus(this.verification, this.isVerified);
  if (this.verification.status !== status) this.verification.status = status;
});

export default mongoose.model("Vendor", VendorSchema);
