const mongoose = require("mongoose");

const ServiceSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },

  vendorId: String,

  name: String,

  category: String,

  subCategory: String,

  description: String,

  status: {
    type: String,
    enum: ["draft", "published", "deleted"],
    default: "draft",
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Service", ServiceSchema);
