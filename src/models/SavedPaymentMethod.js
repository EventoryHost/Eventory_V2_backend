import mongoose from "mongoose";

/**
 * A payment instrument the customer has saved — backs the Payment Details
 * page (Figma node 1414:6624), which lists saved UPI IDs and cards.
 *
 * SECURITY — read before adding fields:
 *
 * This collection stores NO cardholder data. There is deliberately no field
 * for a PAN (full card number), CVV, or expiry-with-PAN combination, and
 * none may be added. Payments run through Cashfree HOSTED CHECKOUT
 * (customerPaymentController.js sets order_meta.return_url and redirects),
 * so card details are entered on Cashfree's page and never reach this
 * server — keeping it that way is what holds this system out of PCI-DSS
 * scope.
 *
 * What IS stored: `instrumentRef`, Cashfree's own reference to the saved
 * instrument, plus display-only metadata (last four digits, network, the
 * UPI handle) so the UI can render a recognisable row. Charging a saved
 * instrument is done by handing `instrumentRef` back to Cashfree, never by
 * reconstructing card data here.
 *
 * Rows are created by the payment flow once Cashfree confirms an instrument
 * was saved — NOT by a customer-facing "add card" endpoint. There is no
 * route that accepts instrument details from the client, by design, and the
 * Payment Details UI only lists and deletes.
 */
const SavedPaymentMethodSchema = new mongoose.Schema(
  {
    customerId: { type: String, ref: "Customer", required: true, index: true },
    methodType: { type: String, enum: ["Card", "UPI"], required: true },

    /** Cashfree's reference for the saved instrument. Opaque to us. */
    instrumentRef: { type: String, required: true, trim: true },

    // ---- Display-only metadata ----
    /** Card: last four digits ONLY. Never the full number. */
    last4: { type: String, trim: true, maxlength: 4, default: null },
    network: {
      type: String,
      enum: ["visa", "mastercard", "rupay", "amex", "other", null],
      default: null,
    },
    /** Issuer label shown on the row, e.g. "Axis Bank Credit Card". */
    issuerLabel: { type: String, trim: true, default: null },
    holderName: { type: String, trim: true, default: null },
    /** UPI: the handle, e.g. "7664936589@ybl". */
    vpa: { type: String, trim: true, default: null },
    upiProvider: {
      type: String,
      enum: ["phonepe", "gpay", "paytm", "other", null],
      default: null,
    },

    isPrimary: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    // Explicit collection name, same reasoning as WishlistItem and
    // ViewedItem — this repo's shared "dev" database has form.
    collection: "customer_saved_payment_methods",
  }
);

// One row per (customer, instrument) — re-saving the same instrument at a
// later checkout updates the existing row instead of duplicating it.
SavedPaymentMethodSchema.index({ customerId: 1, instrumentRef: 1 }, { unique: true });

export default mongoose.model("SavedPaymentMethod", SavedPaymentMethodSchema);
