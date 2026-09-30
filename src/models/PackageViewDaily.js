import mongoose from "mongoose";

/**
 * How many times a package's detail page was opened, bucketed per UTC day.
 *
 * ViewedItem cannot answer this: it is one row per customer per package and
 * its viewedAt is overwritten on every revisit, so repeat views and guests are
 * both invisible to it, and there is no history to compare periods against.
 * A day bucket keeps the collection small (one row per variant per day it was
 * seen) while still giving the vendor analytics a total and a trend.
 *
 * Keyed by the variant, not the package group: legacy groups are resolved
 * through buildGroupFilter at read time, so analytics sums the rows of every
 * variant in the group rather than trusting a denormalised group id here.
 */
const PackageViewDailySchema = new mongoose.Schema(
  {
    packageId: { type: String, ref: "Package", required: true },
    // UTC midnight of the day the views fall in.
    day: { type: Date, required: true },
    count: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    collection: "package_view_daily",
  }
);

PackageViewDailySchema.index({ packageId: 1, day: 1 }, { unique: true });

export default mongoose.model("PackageViewDaily", PackageViewDailySchema);
