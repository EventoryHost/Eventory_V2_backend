import mongoose from "mongoose";

/**
 * A package saved for reuse. Templates are a shared catalog: every vendor's
 * templates are visible to all vendors, while "My Templates" scopes to the
 * ones the signed-in vendor created.
 *
 * `data` is an immutable snapshot of the source package group (all variants) at
 * save time — the template does NOT track later edits to the source package.
 */
const TemplateSchema = new mongoose.Schema(
  {
    packageName: { type: String, required: true },
    note: { type: String },
    coverImageUrl: { type: String },
    // Display label of the vendor category, e.g. "MAKEUP ARTIST".
    vendorTypeLabel: { type: String },

    ownerVendorId: {
      type: String,
      ref: "Vendor",
      required: true,
    },
    // The vendor's human-readable id (e.g. "VEN..."), which is what the client
    // holds in session — responses expose this as `ownerVendorId` so the app
    // can tell which templates it owns.
    ownerVendorCustomId: { type: String },
    ownerName: { type: String },

    // The package this template was created from (owner-side only).
    sourcePackageId: { type: String },

    // Full package snapshot: { packages: [ ...package documents ] }
    data: { type: mongoose.Schema.Types.Mixed, required: true },

    isLive: {
      type: Boolean,
      default: false, // Templates start hidden until EM explicitly publishes them
    },
  },
  { timestamps: true }
);

TemplateSchema.index({ ownerVendorId: 1, createdAt: -1 });
TemplateSchema.index({ createdAt: -1 });

const Template = mongoose.model("Template", TemplateSchema);

export default Template;
