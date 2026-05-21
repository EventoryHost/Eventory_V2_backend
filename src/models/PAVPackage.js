import mongoose from "mongoose";
import Package from "./Package.js";
import pavStep2Schema from "./schemas/pavStep2Schema.js";

const PAVPackage = Package.discriminator(
  "PAV",
  new mongoose.Schema({
    step1_eventAndCrew: {
      crewBreakdown: {
        photographers: { type: Number, default: 0 },
        videographers: { type: Number, default: 0 },
        otherAssistants: { type: Number, default: 0 },
        editors: { type: Number, default: 0 },
      },
    },
    step2_productsAndPricing: pavStep2Schema,
    step3_policiesAndCharges: {
      packagePricing: {
        price: { type: Number },
        billingUnit: { type: String },
      },
      dateRangeDynamicPricing: [
        {
          fromDate: { type: Date },
          toDate: { type: Date },
          price: { type: Number },
        },
      ],
    },
  })
);

export default PAVPackage;
