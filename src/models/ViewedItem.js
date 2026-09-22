import mongoose from "mongoose";

/**
 * A package the customer has opened, for the account dashboard's "Viewed
 * Items" count and the Viewed Items page (Figma nodes 1414:5931 and
 * 1414:8076).
 *
 * One document per (customer, package) rather than one per visit — the UI
 * shows a de-duplicated "recently viewed" list, so a repeat visit bumps
 * viewedAt instead of appending. That makes recording a view a single
 * idempotent upsert, and keeps the collection bounded by catalogue size
 * rather than by traffic.
 *
 * Package details are NOT snapshotted here: the page renders live package
 * data via populate, so a price or title change is reflected rather than
 * frozen at view time. A package that is later deleted leaves packageId
 * unpopulated, which the controller filters out.
 */
const ViewedItemSchema = new mongoose.Schema(
  {
    customerId: { type: String, ref: "Customer", required: true, index: true },
    packageId: { type: String, ref: "Package", required: true },
    viewedAt: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true,
    // Explicit collection name, same reasoning as WishlistItem: this repo's
    // shared "dev" database has twice turned out to hold pre-existing,
    // differently-shaped collections under the name Mongoose would guess.
    collection: "customer_viewed_items",
  }
);

// One row per (customer, package) — recordView upserts against this.
ViewedItemSchema.index({ customerId: 1, packageId: 1 }, { unique: true });

export default mongoose.model("ViewedItem", ViewedItemSchema);
