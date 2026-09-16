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

// A dimension the vendor types with the unit they measured it in — the app
// offers Sq. Ft./Sq. Mtr. for area and M/Ft. for height, so the unit travels
// with the number rather than being assumed.
const measurement = {
  value: { type: Number },
  unit: { type: String },
};

const capacity = {
  standing: { type: Number },
  sitting: { type: Number },
  dining: { type: Number },
};

/**
 * Amenities used to be five fixed booleans. The app now offers an open list
 * ("Generator Backup", "Wheelchair Access", …), so the stored shape is a plain
 * list of labels. Spaces saved under the old shape are translated on read by
 * the pre-init hook below, using these labels.
 */
const LEGACY_AMENITY_LABELS = {
  power: "Power",
  ac: "AC",
  stage: "Stage",
  lighting: "Lighting",
  security: "Security",
};

const normalizeAmenities = (holder) => {
  const raw = holder?.amenities;
  if (!raw || Array.isArray(raw) || typeof raw !== "object") return;
  holder.amenities = Object.entries(LEGACY_AMENITY_LABELS)
    .filter(([flag]) => raw[flag] === true)
    .map(([, label]) => label);
};

const venueSchema = new mongoose.Schema({
  step1_eventAndCrew: {
    venueAddress: { type: String },
    tourAvailable: { type: Boolean },
  },

  step2_productsAndPricing: {
    spaces: [
      {
        name: { type: String },
        spaceType: { type: String },
        area: measurement,
        height: measurement,
        layout: { type: String },
        capacity,
        environment: { type: String, enum: ["Indoor", "Outdoor"] },
        activities: [{ type: String }],
        amenities: [{ type: String }],
        price: { type: Number },
        billingUnit: { type: String },
        // Rooms that come with the space, and whether they are bundled into
        // the space price rather than charged on top.
        numberOfRooms: { type: Number },
        roomIncluded: { type: Boolean, default: false },
        // Whether the customer has to take this space with the package.
        mandatory: { type: Boolean, default: false },
        parking: {
          fourWheelerCapacity: { type: Number },
          twoWheelerCapacity: { type: Number },
          valetService: { type: Boolean, default: false },
        },
      },
    ],
    inHouseServices: {
      caterer: [
        new mongoose.Schema(
          {
            serviceType: String, // "Placeholder" in screenshots
            data: catererStep2Schema,
            sampleMedia: [mediaSchema],
            // Whether the customer has to take this service with the package.
            mandatory: { type: Boolean, default: false },
          },
          { _id: true }
        ),
      ],
      decorator: [
        new mongoose.Schema(
          {
            serviceType: String,
            data: decoratorStep2Schema,
            sampleMedia: [mediaSchema],
            mandatory: { type: Boolean, default: false },
          },
          { _id: true }
        ),
      ],
      pav: [
        new mongoose.Schema(
          {
            serviceType: String,
            data: pavStep2Schema,
            sampleMedia: [mediaSchema],
            mandatory: { type: Boolean, default: false },
            // What the venue charges for running this service in-house. The
            // caterer and decorator price theirs inside their own step-2 body
            // (per plate, per setup), so only these three carry it here.
            price: { type: Number },
            billingUnit: { type: String },
          },
          { _id: true }
        ),
      ],
      djArtist: [
        new mongoose.Schema(
          {
            serviceType: String,
            data: djArtistStep2Schema,
            sampleMedia: [mediaSchema],
            mandatory: { type: Boolean, default: false },
            price: { type: Number },
            billingUnit: { type: String },
          },
          { _id: true }
        ),
      ],
      makeupArtist: [
        new mongoose.Schema(
          {
            serviceType: String,
            data: makeupArtistStep2Schema,
            sampleMedia: [mediaSchema],
            mandatory: { type: Boolean, default: false },
            price: { type: Number },
            billingUnit: { type: String },
          },
          { _id: true }
        ),
      ],
    },
    addOns: [
      {
        // "Asset" is what the app's add-on picker calls a physical item it
        // hands over (a generator, a projector); "Product" is the older
        // spelling, kept so add-ons saved under it still load.
        addOnType: {
          type: String,
          enum: ["Service", "Product", "Space", "Asset"],
        },
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
          capacity,
          environment: { type: String, enum: ["Indoor", "Outdoor"] },
          activities: [{ type: String }],
          amenities: [{ type: String }],
          numberOfRooms: { type: Number },
          roomIncluded: { type: Boolean, default: false },
          area: measurement,
          height: measurement,
        },
      },
    ],
    included: [{ type: String }],
    notIncluded: [{ type: String }],
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
});

// Runs against the raw document straight out of MongoDB, before casting, so a
// space stored with the old boolean-map `amenities` loads as labels instead of
// failing to cast into the string list.
venueSchema.pre("init", function (raw) {
  const step2 = raw?.step2_productsAndPricing;
  if (!step2) return;
  for (const space of step2.spaces ?? []) normalizeAmenities(space);
  for (const addOn of step2.addOns ?? []) normalizeAmenities(addOn.spaceDetails);
});

const VenueProviderPackage = Package.discriminator("VenueProvider", venueSchema);

export default VenueProviderPackage;
