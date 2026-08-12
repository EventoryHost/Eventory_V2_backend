import mongoose from "mongoose";

const TransactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },

    // Denormalized for quick listing
    customerName: {
      type: String,
      default: null,
    },
    eventDate: {
      type: Date,
      default: null,
    },

    // Payment details — the milestone's title as the vendor wrote it.
    milestoneTitle: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["Received", "Pending", "PaymentDue"],
      default: "Received",
    },
    receivedDate: {
      type: Date,
      default: null,
    },
    // Set when the vendor's account is purged. Financial records are retained
    // and anonymised rather than deleted.
    vendorDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Indexes for earnings queries
TransactionSchema.index({ vendorId: 1, createdAt: -1 });
TransactionSchema.index({ vendorId: 1, status: 1 });
TransactionSchema.index({ bookingId: 1 });

export default mongoose.model("Transaction", TransactionSchema);
