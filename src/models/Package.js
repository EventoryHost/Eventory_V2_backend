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
    bookingSettings: {
      bookingType: {
        type: String,
        enum: ["Ready-to-Book", "Enquiry/Quote"],
        required: true,
      },

      paymentType: {
        type: String,
        enum: ["Free", "Token"],
        required: true,
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
    variantType: {
      type: String,
      default: "Premium",
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
        ac: { type: Boolean, default: false },
        stage: { type: Boolean, default: false },
        lighting: { type: Boolean, default: false },
        security: { type: Boolean, default: false },
        customText: { type: String },
      },
      tastingSession: { type: Boolean, default: false },
      // Makeup Artist specific
      durationPerPerson: { type: Number },
      durationOfSetup: { type: Number },
      trialOffered: { type: Boolean, default: false },
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
  },
  packageOptions
);

PackageSchema.pre("save", function (next) {
  const milestones =
    this.paymentMilestones?.milestones || [];

  const total = milestones.reduce(
    (sum, milestone) => sum + milestone.percentage,
    0
  );

  if (total !== 100) {
    return next(
      new Error(
        `Total milestone percentage must equal 100%. Current total: ${total}%`
      )
    );
  }

  next();
});

const Package = mongoose.model("Package", PackageSchema);

export default Package;
