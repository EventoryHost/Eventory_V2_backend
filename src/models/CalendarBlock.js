import mongoose from "mongoose";

const CalendarBlockSchema = new mongoose.Schema(
  {
    vendorId: {
      type: String,
      ref: "Vendor",
      required: true,
      index: true,
    },
    blockType: {
      type: String,
      enum: ["OfflineBooking", "Holiday"],
      required: true,
    },

    // Date range (single day: startDate === endDate)
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },

    // Time range. Always set for OfflineBooking. For Holiday it is optional:
    // null = full-day block; set = partial-day block (from a timed "mark as
    // holiday" or the remainder left after a time-range unblock).
    startTime: {
      type: String,
      default: null,
    },
    endTime: {
      type: String,
      default: null,
    },

    // Offline booking fields
    eventName: {
      type: String,
      default: null,
    },
    serviceType: {
      type: String,
      enum: [
        "Caterer",
        "Decorator",
        "PAV",
        "DJArtist",
        "MakeupArtist",
        "VenueProvider",
        null,
      ],
      default: null,
    },
    description: {
      type: String,
      default: null,
    },

    // Holiday fields
    reason: {
      type: String,
      default: null,
    },

    // Status
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Compound indexes for efficient calendar queries
CalendarBlockSchema.index({
  vendorId: 1,
  startDate: 1,
  endDate: 1,
  isActive: 1,
});
CalendarBlockSchema.index({
  vendorId: 1,
  blockType: 1,
  isActive: 1,
});

export default mongoose.model("CalendarBlock", CalendarBlockSchema);
