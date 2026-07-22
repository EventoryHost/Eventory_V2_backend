import mongoose from "mongoose";
import Package from "./Package.js";
import catererStep2Schema from "./schemas/catererStep2Schema.js";
import decoratorStep2Schema from "./schemas/decoratorStep2Schema.js";
import pavStep2Schema from "./schemas/pavStep2Schema.js";
import djArtistStep2Schema from "./schemas/djArtistStep2Schema.js";
import makeupArtistStep2Schema from "./schemas/makeupArtistStep2Schema.js";
import policySchema from "./schemas/policySchema.js";

const mediaSchema = {
  url: { type: String },
  type: { type: String, enum: ["image", "video"] },
  fileName: { type: String },
  size: { type: Number },
};

const VenueProviderPackage = Package.discriminator(
  "VenueProvider",
  new mongoose.Schema({
    step1_eventAndCrew: {
      venueAddress: { type: String },
      tourAvailable:{type: Boolean},
    },

    step2_productsAndPricing: {
      spaces: [
        {
          name: { type: String },
          spaceType: { type: String },
          area: {
            value: { type: Number },
            unit: { type: String },
          },
          height: {
            value: { type: Number },
            unit: { type: String },
          },
          layout: { type: String },
          capacity: {
            standing: { type: Number },
            sitting: { type: Number },
            dining: { type: Number },
          },
          environment: { type: String, enum: ["Indoor", "Outdoor"] },
          activities: [{ type: String }],
          amenities: {
            power: { type: Boolean, default: false },
            ac: { type: Boolean, default: false },
            stage: { type: Boolean, default: false },
            lighting: { type: Boolean, default: false },
            security: { type: Boolean, default: false },
          },
          price: { type: Number },
          billingUnit: { type: String },
        },
      ],
      inHouseServices: {
        caterer: [
          new mongoose.Schema({
            serviceType: String, // "Placeholder" in screenshots
            data: catererStep2Schema,
            sampleMedia: [mediaSchema],
          }, { _id: true }),
        ],
        decorator: [
          new mongoose.Schema({
            serviceType: String,
            data: decoratorStep2Schema,
            sampleMedia: [mediaSchema],
          }, { _id: true }),
        ],
        pav: [
          new mongoose.Schema({
            serviceType: String,
            data: pavStep2Schema,
            sampleMedia: [mediaSchema],
          }, { _id: true }),
        ],
        djArtist: [
          new mongoose.Schema({
            serviceType: String,
            data: djArtistStep2Schema,
            sampleMedia: [mediaSchema],
          }, { _id: true }),
        ],
        makeupArtist: [
          new mongoose.Schema({
            serviceType: String,
            data: makeupArtistStep2Schema,
            sampleMedia: [mediaSchema],
          }, { _id: true }),
        ],
      },
      addOns: [
        {
          addOnType: { type: String, enum: ["Service", "Product", "Space"] },
          name: { type: String },
          category: { type: String },
          subCategory: { type: String },
          quantity: { type: Number },
          minCapacity: { type: Number },
          maxCapacity: { type: Number },
          description: { type: String },
          price: { type: Number },
          billingUnit: { type: String },
          policyDocUrl: { type: String },
          policy: policySchema,
          mediaUrls: [{ type: String }],
          spaceDetails: {
            spaceType: { type: String },
            layout: { type: String },
            capacity: {
              standing: { type: Number },
              sitting: { type: Number },
              dining: { type: Number },
            },
            environment: { type: String, enum: ["Indoor", "Outdoor"] },
            activities: [{ type: String }],
            amenities: {
              power: { type: Boolean, default: false },
              ac: { type: Boolean, default: false },
              stage: { type: Boolean, default: false },
              lighting: { type: Boolean, default: false },
              security: { type: Boolean, default: false },
            },
          },
        },
      ],
    },

    step3_policiesAndCharges: {
      overallPriceOfPackage: {
        price: { type: Number },
        billingUnit: { type: String },
      },
      // Whether the quoted prices are inclusive of GST.
      gstInclusive: { type: Boolean, default: false },
      // GST rate as a whole-number percentage (e.g. 5 or 18).
      gstRatePercent: { type: Number },
      // Policies and other documents (template / uploaded files / written text).
      cancellationPolicy: policySchema,
      lastMinutePolicy: policySchema,
      generalPolicies: [policySchema],
    },

    step4_sampleMedia: {
      spaceMedia: [
        {
          spaceName: { type: String },
          spaceIndex: { type: Number },
          media: [mediaSchema],
        },
      ],
    },
  })
);

export default VenueProviderPackage;
