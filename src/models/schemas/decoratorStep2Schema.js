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
      items: [
        {
          name: String,
          qty: { type: Number, default: 1 },
          unit: String,
          price: Number,
          chargeBySize: { type: Boolean, default: false },
          pricePerMeter: Number,
          itemType: String,
          subCategory: String,
          length: Number,
          description: String,
          colors: [{ type: String }],
          volume: String,
        },
      ],
      notPartOfSetup: String,
      partOfSetup: String,
      structures: [{ type: String }],
      themes: [{ type: String }],
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
