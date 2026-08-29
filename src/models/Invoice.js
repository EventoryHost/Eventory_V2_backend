import mongoose from "mongoose";
import { generateISTId } from "../utils/idGenerator.js";

/**
 * Phase 5 Step 24 — Invoice model. ONE INVOICE PER BOOKING (per vendor),
 * confirmed with the user first: the final BRD's own open question #6
 * ("Invoice per vendor, or one consolidated Eventory invoice?" —
 * info.txt) is still unresolved, and Booking.js has no field correlating
 * multiple Bookings from the same checkout (PART 5 Flag #4, also still
 * open) — a consolidated invoice would need that linkage built first,
 * which is a vendor-schema change out of scope without separate sign-off.
 * Per-Booking is what the current data model actually supports today.
 *
 * A snapshot document, same philosophy as Booking.packageSnapshot — once
 * issued, an invoice's own line items/amounts are frozen at issue time,
 * never recomputed from the live Booking even if the Booking later
 * changes (e.g. a later milestone payment). Re-issuing to reflect new
 * payments is a deliberate, separate action (see invoiceService.js), not
 * automatic.
 */
const InvoiceLineItemSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    amount: { type: Number, required: true },
    type: { type: String, enum: ["Base", "Addon", "Fee", "Discount", "Tax"], default: "Fee" },
  },
  { _id: false }
);

const InvoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, default: () => generateISTId("INV") },
    bookingId: { type: String, ref: "Booking", required: true, unique: true, index: true },
    customerId: { type: String, ref: "Customer", required: true, index: true },
    vendorId: { type: String, ref: "Vendor", required: true },

    // Snapshots — frozen at issue time, see class comment above.
    customerSnapshot: {
      name: { type: String },
      phone: { type: String },
      email: { type: String },
    },
    vendorSnapshot: {
      businessName: { type: String },
      city: { type: String },
    },
    packageSnapshot: {
      name: { type: String },
      vendorType: { type: String },
    },

    lineItems: { type: [InvoiceLineItemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    totalReceivedAtIssue: { type: Number, default: 0 }, // what had actually been paid as of THIS issue, not live
    amountDueAtIssue: { type: Number, default: 0 },

    eventDate: { type: Date, default: null },
    issuedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "customer_invoices",
  }
);

export default mongoose.model("Invoice", InvoiceSchema);
