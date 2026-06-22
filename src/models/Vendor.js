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

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("Vendor", VendorSchema);
