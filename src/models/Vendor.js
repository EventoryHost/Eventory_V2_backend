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

  isDeactivated: {
    type: Boolean,
    default: false,
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
