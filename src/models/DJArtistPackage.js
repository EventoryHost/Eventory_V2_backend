import mongoose from "mongoose";
import Package from "./Package.js";
import djArtistStep2Schema from "./schemas/djArtistStep2Schema.js";

const DJArtistPackage = Package.discriminator(
  "DJArtist",
  new mongoose.Schema({
    step1_eventAndCrew: {
      audienceCapacity: {
        min: { type: Number },
        max: { type: Number },
      },
      performers: {
        count: { type: Number },
        performingArtists: [
          {
            name: { type: String },
            size: { type: Number },
          },
        ],
      },
      supportingCrew: { type: Number },
      visitingIncluded: { type: Boolean, default: false },
    },
    step2_productsAndPricing: djArtistStep2Schema,
    step3_policiesAndCharges: {
      overtimeCharges: {
        price: { type: Number },
        billingUnit: { type: String },
      },
    },
    step4_sampleMedia: {
      socialMediaLinks: {
        youtube: { type: String },
        instagram: { type: String },
        spotify: { type: String },
        facebook: { type: String },
        twitter: { type: String },
        other: { type: String },
      },
    },
  })
);

export default DJArtistPackage;
