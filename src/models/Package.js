const mongoose = require("mongoose");

// ---- Sub-schemas (embedded documents) ----

const MediaSchema = new mongoose.Schema({
  id: String,

  url: String,

  type: {
    type: String,
    enum: ["image", "video", "pdf"],
  },

  name: String,
});

const ItemSchema = new mongoose.Schema({
  id: String,

  name: String,

  category: String,

  description: String,

  quantity: Number,

  price: Number,

  specifications: mongoose.Schema.Types.Mixed,
});

const AddonSchema = new mongoose.Schema({
  id: String,

  name: String,

  type: {
    type: String,
    enum: ["service", "product"],
  },

  description: String,

  quantity: Number,

  pricingModel: String,

  price: Number,

  specifications: mongoose.Schema.Types.Mixed,

  media: [MediaSchema],
});

const PricingSchema = new mongoose.Schema({
  model: {
    type: String,
    enum: ["per_head", "per_plate", "per_hour", "per_product", "per_event"],
  },

  price: Number,

  additionalCharges: Number,
});

const PolicySchema = new mongoose.Schema({
  lastMinuteCharges: String,

  laborEquipmentCharges: Number,

  scalingAllowed: Boolean,

  documents: [MediaSchema],
});

// ---- Main Package schema ----

const PackageSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },

  serviceId: String,

  name: String,

  eventCategory: String,

  setupDuration: Number,

  crew: {
    supervisors: Number,
    workers: Number,
  },

  requirementsFromVenue: String,

  items: [ItemSchema],

  addons: [AddonSchema],

  pricing: PricingSchema,

  policies: PolicySchema,

  media: [MediaSchema],

  status: {
    type: String,
    enum: ["draft", "published"],
    default: "draft",
  },
});

module.exports = mongoose.model("Package", PackageSchema);
