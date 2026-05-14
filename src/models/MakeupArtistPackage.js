import mongoose from "mongoose";
import Package from "./Package.js";
import makeupArtistStep2Schema from "./schemas/makeupArtistStep2Schema.js";

const MakeupArtistPackage = Package.discriminator(
  "MakeupArtist",
  new mongoose.Schema({
    step1_eventAndCrew: {
      durationPerPerson: { type: Number },
      durationOfSetup: { type: Number },
      trialOffered: { type: Boolean, default: false },
      parallelServicingPossible: { type: Boolean, default: false },
    },
    step2_productsAndPricing: makeupArtistStep2Schema,
    step3_policiesAndCharges: {
      overtimeCharges: {
        price: { type: Number },
        billingUnit: { type: String },
      },
    },
  })
);

export default MakeupArtistPackage;
