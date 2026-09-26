import mongoose from "mongoose";
import { generateISTId } from "../utils/idGenerator.js";

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

export default mongoose.model("Vendor", VendorSchema);
