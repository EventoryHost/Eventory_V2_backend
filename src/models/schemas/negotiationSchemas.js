import mongoose from "mongoose";

/**
 * The negotiation surface shared by bookings and enquiries.
 *
 * A booking and an enquiry differ in when money changes hands, not in what is
 * being agreed: the same package snapshot, the same requested additions and
 * removals, the same cumulative pricing rows, the same instalment plan. Keeping
 * one definition is what makes converting an enquiry into a booking lossless.
 */

export const MILESTONE_STATUSES = ["Pending", "PaymentDue", "Received"];

export const CHANGE_TYPES = ["Add", "Remove"];

export const ITEM_KINDS = ["Item", "Addon"];

export const CHANGE_REQUEST_STATUSES = ["Pending", "Accepted", "Rejected"];

/** The package exactly as it was quoted, frozen at the moment of agreement. */
export const PackageSnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, immutable: true },
    price: { type: Number, immutable: true },
    image: { type: String, immutable: true },
    vendorType: { type: String, immutable: true },
    variantType: { type: String, immutable: true },
    gstRatePercent: { type: Number, immutable: true, default: null },
    gstInclusive: { type: Boolean, immutable: true, default: false },
    // Vendor-type-specific step-2 payload (spaces, setups, menus, items…).
    deliverables: {
      type: mongoose.Schema.Types.Mixed,
      immutable: true,
      default: null,
    },
  },
  { _id: false }
);

/**
 * One customer-requested addition or removal, and the vendor's decision on it.
 * `category` plus `item` locate the deliverable inside the package snapshot, so
 * a request always refers to something the customer was actually quoted.
 */
export const ChangeRequestSchema = new mongoose.Schema(
  {
    changeType: { type: String, enum: CHANGE_TYPES, required: true },
    itemKind: { type: String, enum: ITEM_KINDS, default: "Item" },
    category: { type: String, required: true, trim: true },
    item: { type: String, required: true, trim: true },
    qty: { type: Number, default: 1, min: 1 },
    status: {
      type: String,
      enum: CHANGE_REQUEST_STATUSES,
      default: "Pending",
    },
    requestedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date, default: null },
  },
  { _id: true }
);

/**
 * Vendor-authored pricing. One cumulative figure per breakdown row — the
 * vendor prices the whole set of additions, not each item — plus the discount
 * and tax rate. Every row of the pricing breakdown comes from here; see
 * `utils/pricingBreakdown.js`.
 *
 * All amounts are positive magnitudes. The breakdown applies the sign.
 */
export const PricingSchema = new mongoose.Schema(
  {
    // Overrides packageSnapshot.price when the price was negotiated separately.
    basePrice: { type: Number, default: null },

    itemsAdded: { type: Number, default: 0, min: 0 },
    addonsAdded: { type: Number, default: 0, min: 0 },

    itemsRemoved: { type: Number, default: 0, min: 0 },
    addonsRemoved: { type: Number, default: 0, min: 0 },

    discountAmount: { type: Number, default: 0, min: 0 },
    discountLabel: { type: String, default: "Discount Allowed" },
    taxRatePct: { type: Number, default: 18, min: 0, max: 100 },
    taxLabel: { type: String, default: "GST" },
    updatedAt: { type: Date, default: null },
  },
  { _id: false }
);

/**
 * One instalment of the payment plan. Titles are the vendor's own — neither a
 * booking nor a proposal is limited to a fixed set of instalments.
 */
export const PaymentMilestoneSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    percentage: { type: Number, default: null, min: 0, max: 100 },
    amount: { type: Number, required: true },
    dueDate: { type: Date, default: null },
    status: { type: String, enum: MILESTONE_STATUSES, default: "Pending" },
    receivedDate: { type: Date, default: null },
  },
  { _id: true }
);

/**
 * A customer- or vendor-supplied file. `name` and `sizeBytes` are carried so
 * the attachment can be listed without fetching it.
 */
export const AttachmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url: { type: String, default: null },
    contentType: { type: String, default: null },
    sizeBytes: { type: Number, default: null, min: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);
