import mongoose from "mongoose";
import Package from "./Package.js";
import djArtistStep2Schema from "./schemas/djArtistStep2Schema.js";
import policySchema from "./schemas/policySchema.js";

const DJArtistPackage = Package.discriminator(
  "DJArtist",
  new mongoose.Schema({
    step1_eventAndCrew: {
      // Base inherited fields that must be re-declared to prevent Mongoose from dropping them
      packageName: { type: String, required: true },
      eventCategories: [{ type: String }],
      poc: { type: String },
      duration: {
        minHours: { type: Number },
        maxHours: { type: Number },
      },
      crewSize: {
        minPeople: { type: Number },
        maxPeople: { type: Number },
        roles: [{ type: String }],
      },
      capacity: {
        minGuests: { type: Number },
        maxGuests: { type: Number },
      },
      venueNeeds: {
        power: { type: Boolean, default: false },
        ac: { type: Boolean, default: false },
        stage: { type: Boolean, default: false },
        lighting: { type: Boolean, default: false },
        security: { type: Boolean, default: false },
        customText: { type: String },
      },
      
      // DJ Artist specific fields
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
      experience: { type: String },
    },
    
    step2_productsAndPricing: djArtistStep2Schema,
    
    step3_policiesAndCharges: {
      // Base fields
      teamAndEquipment: {
        price: { type: Number },
        billingUnit: { type: String },
      },
      packagePricing: {
        price: { type: Number },
        billingUnit: { type: String },
        noOfPeople: { type: String },
        // Pre-discount price — see Package.js's own packagePricing.originalPrice
        // comment. Redeclared here (not inherited) because this discriminator
        // already redeclares its own step3_policiesAndCharges.packagePricing
        // in full rather than reusing the base schema's.
        originalPrice: { type: Number, default: null },
      },
      lastMinuteChargesDocUrl: { type: String },
      lastMinuteChargesDescription: { type: String },
      guestTiers: [
        {
          maxGuests: { type: Number },
          price: { type: Number },
        },
      ],
      dynamicPricing: {
        weekends: {
          enabled: { type: Boolean, default: false },
          price: { type: Number },
          percentage: { type: Number },
        },
        weddingSeason: {
          enabled: { type: Boolean, default: false },
          price: { type: Number },
          percentage: { type: Number },
        },
        festivals: {
          enabled: { type: Boolean, default: false },
          percentage: { type: Number },
          details: { type: mongoose.Schema.Types.Mixed },
        },
        customDates: {
          enabled: { type: Boolean, default: false },
          price: { type: Number },
          percentage: { type: Number },
          startDate: { type: String },
          endDate: { type: String },
        },
      },
      policiesDocUrl: { type: String },

      gstInclusive: { type: Boolean, default: false },
      gstRatePercent: { type: Number },
      cancellationPolicy: policySchema,
      lastMinutePolicy: policySchema,
      generalPolicies: [policySchema],

      // DJ Specific
      overtimeCharges: {
        price: { type: Number },
        billingUnit: { type: String },
      },
    },
    
    step4_sampleMedia: {
      // Base fields
      media: [
        {
          url: { type: String },
          type: { type: String, enum: ["image", "video"] },
          fileName: { type: String },
          size: { type: Number },
        },
      ],
      
      // DJ Specific
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
