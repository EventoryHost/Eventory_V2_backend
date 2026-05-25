import mongoose from "mongoose";

const catererStep2Schema = new mongoose.Schema({
  crockery: {
    included: Boolean,
    type: { type: String }
  },
  menus: [
    {
      name: String,
      type: { type: String, enum: ["Breakfast", "Lunch", "Dinner"] },
      serviceStyle: {
        type: String,
        enum: ["Buffet", "Table", "Live Counter", "Family"],
      },
      priceModel: String,
      billingUnit: String,
      items: {
        starters: [{ name: String, price: Number }],
        mainCourse: [{ name: String, price: Number }],
        dessert: [{ name: String, price: Number }],
        drinks: [{ name: String, price: Number }],
      },
    },
  ],
  addOns: [
    {
      name: String,
      type: { type: String, enum: ["Food", "Drinks", "Other"] },
      category: String,
      subCategory: String,
      quantity: String,
      description: String,
      price: Number,
      billingUnit: String,
      policyDocUrl: String,
      mediaUrls: [String],
    },
  ],
  included: [{ type: String }],
  notIncluded: [{ type: String }],
}, { _id: false });

export default catererStep2Schema;
