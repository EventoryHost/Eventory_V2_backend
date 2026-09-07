import mongoose from "mongoose";

/**
 * The EM (Eventory Manager) review surface for a package.
 *
 * A review decision belongs to the logical package — the packageGroupId — not
 * to one variant, so every field defined here is written to all variants of a
 * group in a single updateMany. Denormalising it onto each document keeps the
 * vendor's Inventory list (getVendorPackages) a single query with no join.
 *
 * `items` is the whole review: the verdict the EM records against each wizard
 * step as they work through it, plus anything else they raise. One list, so
 * there is a single source of truth for what the vendor is asked to fix.
 */

/**
 * What kind of issue a row is. The kinds are independent and a single review
 * can mix them — a package can need step fixes AND documents at the same
 * time — so this lives on the item, not on the action.
 *
 * "StepReview"       — a verdict on one of the four wizard steps.
 * "DocumentRequired" — a document the vendor still has to provide.
 * "Rejection"        — a quality/authenticity objection. Recoverable: the
 *                      vendor still gets Fix & Resubmit. A terminal refusal is
 *                      packageStatus "Deleted" instead.
 * "Custom"           — anything the other three do not cover.
 */
export const EM_ITEM_TYPES = [
  "StepReview",
  "DocumentRequired",
  "Rejection",
  "Custom",
];

/** Only "Rejected" rows are shown to the vendor as something to fix. */
export const EM_ITEM_STATUSES = ["Approved", "Rejected", "Pending"];

/**
 * Which business document a "DocumentRequired" row asks for. `label` is the
 * display text; this is what the app drives its uploader with and what the
 * vendor record is written through, so it has to be a fixed vocabulary.
 */
export const EM_DOC_KEYS = ["fssai", "tradeLicense", "gst"];

/** docKey -> the Vendor fields the upload writes. */
export const VENDOR_DOC_FIELDS = {
  fssai: { url: "fssaiLicense", verified: "isFssaiVerified" },
  tradeLicense: { url: "tradeLicense", verified: "isTradeLicVerified" },
  gst: { url: "gstCertificate", verified: "isGstVerified" },
};

export const REVIEW_EVENTS = [
  "Submitted",
  "Approved",
  "ActionRaised",
  "Rejected",
  "WentLive",
];

/**
 * One row of the review: what kind of issue it is, where it applies, the
 * verdict, and what to fix.
 *
 * `label` is free text so the same row shape covers a wizard step ("Step 1"),
 * a document ("Business Documents"), or nothing at all — a rejection bullet is
 * a bare note. `note` is what the vendor reads, and is only meaningful on a
 * Rejected row.
 */

export const EmActionItemSchema = new mongoose.Schema(
  {
    type: { type: String, enum: EM_ITEM_TYPES, default: "StepReview" },
    label: { type: String, trim: true },
    // Set only on a DocumentRequired row.
    docKey: { type: String, enum: [...EM_DOC_KEYS, null], default: null },
    note: { type: String, trim: true },
    status: { type: String, enum: EM_ITEM_STATUSES, default: "Rejected" },
    reviewedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

export const EmActionSchema = new mongoose.Schema(
  {
    // Heading suffix for the rejection block: "Rejected (Quality/Authenticity
    // Issues)". Applies to the Rejection rows.
    reasonCategory: { type: String, trim: true },
    // The general note above the divider in the design's fix list.
    summary: { type: String, trim: true },
    items: { type: [EmActionItemSchema], default: [] },
    raisedBy: { type: String, trim: true },
    raisedAt: { type: Date, default: null },
  },
  { _id: false }
);

/** Append-only audit row. `action` snapshots the emAction as it stood. */
export const PackageReviewEventSchema = new mongoose.Schema(
  {
    event: { type: String, enum: REVIEW_EVENTS, required: true },
    action: { type: EmActionSchema, default: null },
    by: { type: String, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

/** The rows the vendor is actually asked to act on. */
export const actionableItems = (emAction) =>
  (emAction?.items || []).filter((i) => i.status === "Rejected");

export default EmActionSchema;
