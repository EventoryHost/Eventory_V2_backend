import mongoose from "mongoose";

const packageOptions = {
  discriminatorKey: "vendorType", // This will store the vendor type (e.g., 'Caterer')
  timestamps: true,
};

const PackageSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    packageStatus: {
      type: String,
      enum: ["Draft", "Under Review", "Live", "Deleted"],
      default: "Draft",
    },
    bookingType: {
      type: String,
      enum: ["Ready-to-Book", "Enquiry/Quote"],
      required: true,
    },
    availabilityCalendar: [
      {
        date: { type: Date },
        status: { type: String, enum: ["Available", "Blocked", "Booked"] },
      },
    ],
    variantType: {
      type: String,
      enum: ["Premium", "Standard", "Custom"],
      default: "Standard",
    },
    completedSteps: [{ type: Number }], // Track which steps (1, 2, 3, 4) are finished

    // -- Step 1: Event & Crew (Mostly Shared) --
    step1_eventAndCrew: {
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
        camera: { type: Boolean, default: false },
        ac: { type: Boolean, default: false },
        stage: { type: Boolean, default: false },
        lighting: { type: Boolean, default: false },
        security: { type: Boolean, default: false },
        customText: { type: String },
      },
      tastingSession: { type: Boolean, default: false },
    },

    // -- Step 3: Policies & Charges (Mostly Shared) --
    step3_policiesAndCharges: {
      teamAndEquipment: {
        price: { type: Number },
        billingUnit: { type: String },
      },
      lastMinuteChargesDocUrl: { type: String },
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
          percentage: { type: Number },
        },
        festivals: {
          enabled: { type: Boolean, default: false },
          percentage: { type: Number },
        },
        customDates: {
          enabled: { type: Boolean, default: false },
          percentage: { type: Number },
        },
      },
      policiesDocUrl: { type: String },
    },

    // -- Step 4: Sample Media (Shared) --
    step4_sampleMedia: {
      media: [
        {
          url: { type: String },
          type: { type: String, enum: ["image", "video"] },
          fileName: { type: String },
          size: { type: Number },
        },
      ],
    },
  },
  packageOptions
);

const Package = mongoose.model("Package", PackageSchema);

export default Package;
