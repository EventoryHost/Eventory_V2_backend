import mongoose from "mongoose";
import policySchema from "./policySchema.js";

const makeupArtistStep2Schema = new mongoose.Schema({
  items: [
    {
      name: { type: String },
      itemType: {
        type: String,
        enum: ["Makeup", "Hair", "Skin & Spa", "Mehendi", "Nail", "Other"],
      },
      options: [
        {
          name: { type: String },
          price: { type: Number, default: 0 },
        },
      ],
      brands: [
        {
          name: { type: String },
          price: { type: Number, default: 0 },
        },
      ],
      allowCustomInput: { type: Boolean, default: false },
    },
  ],
  addOns: [
    {
      addOnType: { type: String, enum: ["Service", "Product"] },
      name: { type: String },
      category: { type: String },
      subCategory: { type: String },
      quantity: { type: Number },
      description: { type: String },
      price: { type: Number },
      billingUnit: { type: String },
      policyDocUrl: { type: String },
      policy: policySchema,
      mediaUrls: [{ type: String }],
    },
  ],
  included: [{ type: String }],
  notIncluded: [{ type: String }],
}, { _id: false });

export default makeupArtistStep2Schema;
