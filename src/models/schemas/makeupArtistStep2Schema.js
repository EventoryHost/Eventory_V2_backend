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
      makeupType: { type: String },
      longevity: { type: String },
      hairServiceType: { type: String },
      brandOrigin: { type: String },
      styles: [{ type: String }],
      coverages: [{ type: String }],
      coneTypes: [{ type: String }],
      skinTypes: [{ type: String }],
      customOptions: [
        {
          category: { type: String },
          options: [{ type: String }],
        },
      ],
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
  drapingIncluded: { type: Boolean, default: false },
  drapingServiceTypes: [{ type: String }],
}, { _id: false });

export default makeupArtistStep2Schema;
