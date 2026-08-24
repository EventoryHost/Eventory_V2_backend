import mongoose from "mongoose";
import policySchema from "./policySchema.js";

const catererStep2Schema = new mongoose.Schema({
  crockery: {
    included: Boolean,
    type: { type: [String] }
  },
  menus: [
    {
      name: String,
      type: { type: String, enum: ["Breakfast", "Lunch", "Dinner", "Snacks", "Brunch", "Custom"] },
      serviceStyle: [{
        type: String,
        enum: ["Buffet", "Table", "Live Counter", "Family"],
      }],
      perPlatePrice: Number,
      items: {
        salads: [{ name: String, price: Number, foodType: { type: String, enum: ["Veg", "Non-veg", "Egg"], default: "Veg" } }],
        breads: [{ name: String, price: Number, foodType: { type: String, enum: ["Veg", "Non-veg", "Egg"], default: "Veg" } }],
        rice: [{ name: String, price: Number, foodType: { type: String, enum: ["Veg", "Non-veg", "Egg"], default: "Veg" } }],
        starters: [{ name: String, price: Number, foodType: { type: String, enum: ["Veg", "Non-veg", "Egg"], default: "Veg" } }],
        mainCourse: [{ name: String, price: Number, foodType: { type: String, enum: ["Veg", "Non-veg", "Egg"], default: "Veg" } }],
        dessert: [{ name: String, price: Number, foodType: { type: String, enum: ["Veg", "Non-veg", "Egg"], default: "Veg" } }],
        beverages: [{ name: String, price: Number, foodType: { type: String, enum: ["Veg", "Non-veg", "Egg"], default: "Veg" } }],
        desserts: [{ name: String, price: Number, foodType: { type: String, enum: ["Veg", "Non-veg", "Egg"], default: "Veg" } }],
        chats: [{ name: String, price: Number, foodType: { type: String, enum: ["Veg", "Non-veg", "Egg"], default: "Veg" } }],
        miscillenous: [{ name: String, price: Number, foodType: { type: String, enum: ["Veg", "Non-veg", "Egg"], default: "Veg" } }],
        drinks: [{ name: String, price: Number, foodType: { type: String, enum: ["Veg", "Non-veg", "Egg"], default: "Veg" } }]
      },
    },
  ],
  addOns: [
    {
      addOnType: { type: String, enum: ["Service", "Product"] },
      name: String,
      type: { type: String, enum: ["Food", "Drinks", "Other"] },
      category: String,
      subCategory: String,
      quantity: String,
      isNonVeg: Boolean,
      description: String,
      price: Number,
      billingUnit: String,
      policyDocUrl: String,
      policy: policySchema,
      mediaUrls: [String],
    },
  ],
  included: [{ type: String }],
  notIncluded: [{ type: String }],
  minMealsPreference: { type: Number },
}, { _id: false });

export default catererStep2Schema;
