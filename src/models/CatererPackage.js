import mongoose from "mongoose";
import Package from "./Package.js";
import catererStep2Schema from "./schemas/catererStep2Schema.js";

const CatererPackage = Package.discriminator(
  "Caterer",
  new mongoose.Schema({
    step2_productsAndPricing: catererStep2Schema,
  })
);

export default CatererPackage;
