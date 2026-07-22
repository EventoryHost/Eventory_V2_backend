import mongoose from "mongoose";

/**
 * Single-document collection powering the dynamic QR redirect.
 * The printed QR always points at GET /api/redirect; only the
 * `destinationUrl` stored here ever changes.
 */
const RedirectSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: "main",
    },
    destinationUrl: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true, _id: false }
);

export default mongoose.model("Redirect", RedirectSchema);
