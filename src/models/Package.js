import mongoose from "mongoose";
import { generateISTId } from "../utils/idGenerator.js";
import policySchema from "./schemas/policySchema.js";

const packageOptions = {
  discriminatorKey: "vendorType", // This will store the vendor type (e.g., 'Caterer')
  timestamps: true,
};

const PackageSchema = new mongoose.Schema(
  {
    vendorId: {
      type: String,
      ref: "Vendor",
      required: true,
    },
    packageStatus: {
      type: String,
      enum: ["Draft", "Under Review", "Live", "Deleted"],
      default: "Draft",
    },
    bookingSettings: {
      bookingType: {
        type: String,
        enum: ["Ready-to-Book", "Enquiry/Quote"],
      },

      paymentType: {
        type: String,
        enum: ["Free", "Token"],
      },

      token: {
        tokenType: {
          type: String,
          enum: ["Percentage", "Fixed"],
        },

        value: {
          type: Number,
          min: 0,
        },
      },
    },
    availabilitySettings: {
      weeklyAvailability: {
        type: [String],
        enum: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ],
        default: [],
      },

      repeatType: {
        type: String,
        enum: ["30 DAYS", "3 MONTHS", "CUSTOM"],
      },

      customDateRange: {
        startDate: Date,
        endDate: Date,
      },

      workMode: {
        type: String,
        enum: ["FULL_DAY", "TIME_SLOTS"],
        default: "FULL_DAY",
      },

      timeSlots: [
        {
          startTime: String, // "10:00 AM"
          endTime: String,   // "02:00 PM"
        },
      ],
    },
    paymentMilestones: {
      milestones: [
        {
          title: {
            type: String,
            required: true,
          },
          percentage: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
          },
          dueDays: {
            type: String,
          },
        },
      ],
    },
    bookingCapacity: {
      dailyCapacity: {
        type: Number,
        default: 1,
      },
      simultaneousBookings: {
        type: Number,
        default: 1,
      }
    },
    availabilityCalendar: [
      {
        date: { type: Date },
        status: { type: String, enum: ["Available", "Blocked", "Booked"] },
      },
    ],
    // Groups the variants of one logical package. Every variant is its own
    // document; siblings are tied together by sharing this id rather than by
    // matching on the (mutable, user-typed) step1_eventAndCrew.packageName.
    packageGroupId: {
      type: String,
      required: true,
      default: () => generateISTId("PKG_GRP"),
      index: true,
    },
    variantType: {
      type: String,
      default: "Premium",
    },
    completedSteps: [{ type: Number }],

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
        ac: { type: Boolean, default: false },
        stage: { type: Boolean, default: false },
        lighting: { type: Boolean, default: false },
        security: { type: Boolean, default: false },
        customText: { type: String },
      },
      venueNeedsList: [{ type: String }],
      tastingSession: { type: Boolean, default: false },
      tastingSessionCost: { type: Number },
      // Makeup Artist specific
      durationPerPerson: { type: Number },
      durationOfSetup: { type: Number },
      atHomeService: { type: Boolean, default: false },
      trialOffered: { type: Boolean, default: false },
      trialCost: { type: Number },
      parallelServicingPossible: { type: Boolean, default: false },
      // DJ Artist specific
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
      // PAV specific
      crewBreakdown: {
        photographers: { type: Number, default: 0 },
        videographers: { type: Number, default: 0 },
        otherAssistants: { type: Number, default: 0 },
        editors: { type: Number, default: 0 },
      },
    },

    // -- Step 3: Policies & Charges (Mostly Shared) --
    step3_policiesAndCharges: {
      teamAndEquipment: {
        price: { type: Number },
        billingUnit: { type: String },
      },
      overtimeCharges: {
        price: { type: Number },
        billingUnit: { type: String },
      },
      packagePricing: {
        price: { type: Number },
        billingUnit: { type: String },
        noOfPeople: { type: String },
      },
      // Whether the quoted prices are inclusive of GST.
      gstInclusive: { type: Boolean, default: false },
      // GST rate as a whole-number percentage (e.g. 5 or 18).
      gstRatePercent: { type: Number },
      // Policies and other documents (template / uploaded files / written text).
      cancellationPolicy: policySchema,
      lastMinutePolicy: policySchema,
      generalPolicies: [policySchema],
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
      cancellationDocUrl: { type: String },
      // PAV Specific
      dateRangeDynamicPricing: [
        {
          fromDate: { type: Date },
          toDate: { type: Date },
          price: { type: Number },
        },
      ],
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
      socialMediaLinks: {
        youtube: { type: String },
        instagram: { type: String },
        spotify: { type: String },
        facebook: { type: String },
        twitter: { type: String },
        other: { type: String },
      },
    },
    adminReview: {
      step1: { status: { type: String, enum: ["Approved", "Rejected", "Pending"] }, notes: String, reviewedAt: Date },
      step2: { status: { type: String, enum: ["Approved", "Rejected", "Pending"] }, notes: String, reviewedAt: Date },
      step3: { status: { type: String, enum: ["Approved", "Rejected", "Pending"] }, notes: String, reviewedAt: Date },
      step4: { status: { type: String, enum: ["Approved", "Rejected", "Pending"] }, notes: String, reviewedAt: Date },
    }
  },
  packageOptions
);

// Loading every variant of one logical package (the common read).
PackageSchema.index({ packageGroupId: 1, variantType: 1 });
// Listing a vendor's packages, optionally filtered by status.
PackageSchema.index({ vendorId: 1, packageStatus: 1 });

const Package = mongoose.model("Package", PackageSchema);

export default Package;
