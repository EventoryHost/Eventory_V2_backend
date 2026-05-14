import mongoose from "mongoose";
import Package from "./Package.js";
import decoratorStep2Schema from "./schemas/decoratorStep2Schema.js";

const DecoratorPackage = Package.discriminator(
  "Decorator",
  new mongoose.Schema({
    step2_productsAndPricing: decoratorStep2Schema,
  })
);

export default DecoratorPackage;
