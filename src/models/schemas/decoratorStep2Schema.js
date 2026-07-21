import mongoose from "mongoose";

const decoratorStep2Schema = new mongoose.Schema({
  totalPackagePrice: { type: Number, default: 0 },
  setups: [
    {
      name: String,
      setupPhoto: String,
      referenceStyle: String,
      description: String,
      price: Number,
      decoratingWhat: String,
      structuresIncluded: [String],
      themes: [String],
      items: [
        {
          name: String,
          itemType: { type: String, enum: ["Flowers", "Lighting", "Balloons", "Carpet/Flooring Decor", "Furniture", "Custom", ""] },
          flowerType: String,
          volume: String,
          lightingType: String,
          dimensions: String,
          colors: [String],
          chargeMoreForLargerSize: { type: Boolean, default: false },
          description: String,
          qty: { type: Number, default: 1 },
          unit: String,
          price: Number,
        },
      ],
      notPartOfSetup: String,
      partOfSetup: String,
    },
  ],
  addOns: [
    {
      addOnType: { type: String, enum: ["Service", "Product"] },
      name: String,
      category: String,
      subCategory: String,
      quantity: Number,
      description: String,
      price: Number,
      billingUnit: String,
      productUsage: { type: String, enum: ["Indoor", "Outdoor", "Both"] },
      physicalSpec: {
        color: String,
        dimensions: {
          length: Number,
          breadth: Number,
          height: Number,
          unit: String,
        },
      },
      materialOptions: [{ material: String, price: Number }],
      policyDocUrl: String,
      mediaUrls: [String],
    },
  ],
  included: [{ type: String }],
  notIncluded: [{ type: String }],
}, { _id: false });

export default decoratorStep2Schema;
