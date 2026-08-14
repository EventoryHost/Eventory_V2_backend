import mongoose from "mongoose";

const VendorSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true,
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

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("Vendor", VendorSchema);
