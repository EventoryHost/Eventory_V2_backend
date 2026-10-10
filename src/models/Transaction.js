import mongoose from "mongoose";
import { generateISTId } from "../utils/idGenerator.js";

const TransactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      unique: true,
      required: true,
      default: () => generateISTId("TXN"),
      index: true,
    },
    vendorId: {
      type: String,
      ref: "Vendor",
      required: true,
      index: true,
    },
    bookingId: {
      type: String,
      ref: "Booking",
      // Not required — a payout settled from the business admin portal
      // isn't necessarily tied to one specific booking (e.g. a catch-up/
      // ad-hoc payment), unlike the per-milestone due record this app
      // writes itself (vendorPayoutService.js), which always has one.
      default: null,
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
      default: "Manual Payout",
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
    // `amount` above is the SUGGESTED net amount owed to the vendor
    // (grossAmount - commission - gstOnCommission), not the customer's
    // gross milestone payment — a due record is self-describing without
    // needing the Booking looked up again. See vendorPayoutService.js.
    // This app only ever writes these as "PaymentDue" (never fires a real
    // transfer); the business admin portal is the one that approves a
    // payout and is expected to write the transfer/settlement fields below
    // back into this same collection once it does.
    grossAmount: { type: Number, default: null },
    commission: { type: Number, default: null },
    commissionRatePercent: { type: Number, default: null },
    gstOnCommission: { type: Number, default: null },
    // Cashfree Payouts transfer reference — set by the business admin
    // portal once it actually fires a transfer; null while a record is
    // still "PaymentDue".
    transferId: { type: String, default: null },
    cfTransferStatus: { type: String, default: null },
    // Set on a "PaymentDue" record once a payout from the business admin
    // portal explicitly settles it — links the due record to the
    // transferId that actually paid it, without forcing the paid amount to
    // equal this due record's suggested amount (partial/combined
    // settlements are the portal's call, not enforced here).
    settledByTransferId: { type: String, default: null },
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
