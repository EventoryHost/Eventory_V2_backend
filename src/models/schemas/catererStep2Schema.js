import mongoose from "mongoose";
import policySchema from "./policySchema.js";

/// A single dish. `price` stays optional — the vendor menu builder prices per
/// plate, not per dish, but per-dish pricing is still used by older menus.
/// `foodType` is the long-standing field; `dishType` is what the app's menu
/// builder sends. They mean the same thing, so both are kept in agreement.
///
/// Only `dishType` carries a setter, mirroring into `foodType`. The reverse is
/// handled by a virtual-free read fallback rather than a second setter, because
/// Mongoose applies `default` values after setters run: a `foodType` setter
/// that seeded `dishType` would be overwritten by dishType's own default, and a
/// non-veg dish from a legacy payload would read back as "Veg".
const foodItemSchema = new mongoose.Schema(
  {
    name: String,
    price: Number,
    foodType: { type: String, enum: ["Veg", "Non-veg", "Egg"], default: "Veg" },
    dishType: {
      type: String,
      enum: ["Veg", "Non-veg", "Egg"],
      // dishType wins when both are supplied and disagree: it is the field the
      // current client drives, while foodType may just be carrying its default.
      set: function (v) {
        if (v) this.foodType = v;
        return v;
      },
    },
  },
  { _id: false }
);

// Fills `dishType` from `foodType` for payloads that only send the older field.
// Runs after defaults are applied, so it cannot be clobbered by them.
foodItemSchema.pre("validate", function () {
  if (!this.dishType && this.foodType) {
    this.$set("dishType", this.foodType, { setters: false });
  }
});

/// A vendor-named food category — "Starters", "Breads", or anything the vendor
/// invents. Replaces the fixed `items` buckets below, which could not hold a
/// category the schema had not anticipated.
const menuCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    items: [foodItemSchema],
    // How many dishes a guest may pick from this category. Null means they get
    // everything in it.
    chooseCount: Number,
  },
  { _id: false }
);

const catererStep2Schema = new mongoose.Schema({
  crockery: {
    included: Boolean,
    type: { type: [String] }
  },
  menus: [
    {
      name: String,
      // Meal type. "Brunch" and "Custom" were added alongside the app's
      // meal-type picker; "Custom" covers a meal that is none of the others.
      type: {
        type: String,
        enum: ["Breakfast", "Lunch", "Dinner", "Snacks", "Brunch", "Custom"],
      },
      // Free-form rather than enum: these labels are presentation copy that has
      // already changed once ("Table" became "Sit-down / Plated"), and an enum
      // here rejects the whole save rather than the one bad value.
      serviceStyle: [{ type: String }],
      cuisineType: [{ type: String }],
      additionalTags: [{ type: String }],
      perPlatePrice: Number,
      // Vendor-named categories — the current shape written by the app.
      categories: [menuCategorySchema],
      // Legacy fixed buckets. Still written by the app for backward
      // compatibility and still read by older clients, so they stay. New code
      // should read `categories` and fall back to these only when it is empty.
      items: {
        salads: [foodItemSchema],
        breads: [foodItemSchema],
        rice: [foodItemSchema],
        starters: [foodItemSchema],
        mainCourse: [foodItemSchema],
        dessert: [foodItemSchema],
        beverages: [foodItemSchema],
        desserts: [foodItemSchema],
        chats: [foodItemSchema],
        miscillenous: [foodItemSchema],
        drinks: [foodItemSchema]
      },
    },
  ],
  addOns: [
    {
      addOnType: { type: String, enum: ["Service", "Product"] },
      name: String,
      // "Others" matches the label the app sends; "Other" is retained so
      // add-ons saved before that spelling settled still load.
      type: { type: String, enum: ["Food", "Drinks", "Others", "Other"] },
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
