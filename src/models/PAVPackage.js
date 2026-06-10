import mongoose from "mongoose";
import Package from "./Package.js";
import pavStep2Schema from "./schemas/pavStep2Schema.js";

const PAVPackage = Package.discriminator(
  "PAV",
  new mongoose.Schema({
    // step1_eventAndCrew uses base schema + crewBreakdown defined in base
    step2_productsAndPricing: pavStep2Schema,
    // step3_policiesAndCharges uses base schema + dateRangeDynamicPricing defined in base
  })
);

export default PAVPackage;
