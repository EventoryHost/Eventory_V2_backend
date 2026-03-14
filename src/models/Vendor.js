const mongoose = require("mongoose");

const VendorSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true,
  },

  name: String,

  vendorType: {
    type: String,
    enum: ["caterer", "decorator", "venue", "photographer", "makeup", "dj"],
  },

  email: String,
  phone: String,

  city: String,
  state: String,

  isVerified: {
    type: Boolean,
    default: false,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Vendor", VendorSchema);
