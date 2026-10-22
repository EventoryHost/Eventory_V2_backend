import mongoose from "mongoose";
import { generateISTId } from "../utils/idGenerator.js";
import { normalizePhone } from "../utils/phone.js";
import {
  CHANGE_REQUEST_STATUSES,
  ChangeRequestSchema,
  PackageSnapshotSchema,
  PaymentMilestoneSchema,
  PricingSchema,
} from "./schemas/negotiationSchemas.js";

export {
  MILESTONE_STATUSES,
  CHANGE_TYPES,
  ITEM_KINDS,
  CHANGE_REQUEST_STATUSES,
} from "./schemas/negotiationSchemas.js";

export const PAYMENT_TYPES = ["FreeBooking", "AdvancePaid", "FullPaid"];

const BOOKING_STATUSES = [
  "NewBooking",
  "Viewed",
  "InDiscussion",
  "Confirmed",
  "Declined",
  "Cancelled",
  "Completed",
];

//Statuses before the vendor has accepted — all share the same affordances.
export const PRE_ACCEPTANCE_STATUSES = ["NewBooking", "Viewed", "InDiscussion"];

// Statuses after which nothing about the booking can change
export const TERMINAL_STATUSES = ["Declined", "Cancelled", "Completed"];

// The customer's answer to the vendor's proposal — see Booking.proposalResponse.
export const PROPOSAL_RESPONSE_STATUSES = ["Accepted", "ChangesRequested"];

// Post-event issues. The categories mirror the Support rows on the vendor
// app's booking details screen.
export const ISSUE_CATEGORIES = [
  "Booking",
  "Items",
  "Payment",
  "PaymentMilestone",
  "Application",
  "Other",
];
export const ISSUE_STATUSES = ["Open", "Resolved"];

/**
 * Whether all the money on a booking is in: every payment milestone marked
 * Received, or — for a booking with no schedule — the full total received.
 * A booking can only be completed once this holds.
 */
export const isFullyPaid = (booking) => {
  const milestones = booking.paymentMilestones ?? [];
  if (milestones.length) return milestones.every((m) => m.status === "Received");
  const total = booking.totalAmount || 0;
  // Amounts are rounded to the rupee, so allow a rupee short.
  return total > 0 && (booking.totalReceived || 0) >= total - 1;
};

// How long after the event ends an issue may still be raised.
export const ISSUE_WINDOW_HOURS = 48;

// Slot times ("HH:MM") are Indian local time.
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// The event's IST calendar day as [year, month, day] — eventDate is stored
// as an instant, so shifting it by the IST offset before reading the UTC
// parts gives the date the customer and vendor actually mean.
const istDayOf = (eventDate) => {
  const ist = new Date(new Date(eventDate).getTime() + IST_OFFSET_MS);
  return [ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()];
};

// "HH:MM" -> minutes past midnight, or null when absent/unparseable.
const slotMinutes = (t) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "").trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/**
 * When the event finishes: the end of the booked slot on the event's IST
 * calendar day, or the end of that day when no slot was booked. A slot
 * ending before it starts runs past midnight into the next day.
 */
export const eventEndOf = ({ eventDate, startTime, endTime }) => {
  if (!eventDate) return null;
  const [y, m, d] = istDayOf(eventDate);
  const end = slotMinutes(endTime);
  const start = slotMinutes(startTime);
  const minutes = end ?? 23 * 60 + 59;
  const overnight = end != null && start != null && end <= start;
  return new Date(
    Date.UTC(y, m, d + (overnight ? 1 : 0), 0, minutes) - IST_OFFSET_MS
  );
};

/**
 * When the event starts: the start of the booked slot on the event's IST
 * calendar day, or that day's IST midnight when no slot was booked. The
 * vendor can't mark teardown before this.
 */
export const eventStartOf = ({ eventDate, startTime }) => {
  if (!eventDate) return null;
  const [y, m, d] = istDayOf(eventDate);
  return new Date(Date.UTC(y, m, d, 0, slotMinutes(startTime) ?? 0) - IST_OFFSET_MS);
};

/**
 * Whether `now` falls on the event day — the gate for the vendor's check-in
 * and the customer's day requests. That is the event's whole IST calendar
 * day, stretched to the event's end (eventEndOf) when the slot runs past
 * midnight, so an overnight event's small hours still count.
 */
export const isEventDay = (booking, now = new Date()) => {
  if (!booking?.eventDate) return false;
  const [y, m, d] = istDayOf(booking.eventDate);
  const dayStart = Date.UTC(y, m, d) - IST_OFFSET_MS;
  const t = new Date(now).getTime();
  if (t < dayStart) return false;
  if (t < dayStart + DAY_MS) return true;
  const end = eventEndOf(booking);
  return !!end && t <= end.getTime();
};

// ─── Event day ──────────────────────────────────────────────
// The vendor's on-the-day flow: check in at the venue, prove the setup with
// photos, ask for the balance, clear the venue. Each step is a timestamp on
// the booking (see BookingSchema below) rather than a status, because the
// booking stays Confirmed throughout — completeBooking still closes it.

// Proof-of-setup photos the vendor may attach.
export const MAX_SETUP_PHOTOS = 10;

// A day request is Pending until the vendor sends an update on it. There is
// no "rejected": on the day, the vendor answers with a message instead.
export const DAY_REQUEST_STATUSES = ["Pending", "Updated"];

// The vendor's answer to a day request. Replaced wholesale if the vendor
// sends another, so it always shows the latest word.
const DayRequestUpdateSchema = new mongoose.Schema(
  {
    message: { type: String, default: null, trim: true, maxlength: 1000 },
    photos: { type: [String], default: [] },
    sentAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// A change the customer asks for on the event day ("move the stage left").
// `_id: true` so the vendor's update can address one request by id.
const DayRequestSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 500 },
    addedAt: { type: Date, default: Date.now },
    status: { type: String, enum: DAY_REQUEST_STATUSES, default: "Pending" },
    update: { type: DayRequestUpdateSchema, default: null },
  },
  { _id: true }
);

// The vendor's on-ground contact for the day. `code` keys the public,
// read-only page at /g/:code (GET /api/ground/:code); it is random and
// regenerated whenever the contact is replaced, so a removed contact's link
// stops working. `link` is not stored — it is derived from code when the
// booking is serialised (utils/groundLink.js), so a change of web host
// doesn't leave stale links in the database.
const GroundStaffSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    // Canonical "+91XXXXXXXXXX", same as Customer.phone (utils/phone.js).
    phone: { type: String, required: true },
    code: { type: String, required: true },
    assignedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const IssueSchema = new mongoose.Schema(
  {
    category: { type: String, enum: ISSUE_CATEGORIES, required: true },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    raisedBy: { type: String, enum: ["Vendor", "Customer"], required: true },
    status: { type: String, enum: ISSUE_STATUSES, default: "Open" },
    raisedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date, default: null },
  },
  { _id: true }
);

// Statuses that actually OCCUPY the vendor's slot for their event date.
//
// Changed 2026-09-25: a slot is reserved ONLY once the vendor has accepted.
// This list used to be "everything except Cancelled/Declined", which meant a
// booking held its date from the instant checkout created it — before the
// vendor had agreed to anything, and regardless of whether the payment then
// failed or the customer walked away. Those pre-acceptance rows are never
// cleaned up (nothing cancels a booking when its payment fails), so the date
// stayed occupied indefinitely and later customers were refused it.
//
// "Confirmed" alone is the answer to "has the vendor committed to this
// date": acceptBooking is the single transition into it, and the same
// moment writes the "Booked" availabilityCalendar entry. Deliberately
// EXCLUDED:
//   - NewBooking/Viewed/InDiscussion — a request the vendor hasn't accepted.
//     The customer may have paid a token, but the vendor can still decline;
//     holding the date against other customers in the meantime is what
//     caused the stuck slots.
//   - Completed — the event already happened. It cannot occupy a date in any
//     forward-looking availability sense.
//   - Cancelled/Declined — as before.
export const SLOT_OCCUPYING_STATUSES = ["Confirmed"];

// A confirmed booking the customer reopened with follow-up requests goes back
// to InDiscussion but keeps its confirmedAt — and keeps its date: the vendor
// committed to it, and only the details are being renegotiated. Every query
// for "bookings holding a date" uses this filter rather than
// SLOT_OCCUPYING_STATUSES alone.
export const slotOccupyingFilter = () => ({
  $or: [
    { status: { $in: SLOT_OCCUPYING_STATUSES } },
    { status: "InDiscussion", confirmedAt: { $ne: null } },
  ],
});

// PDP "Customize items" workshop requests — added 2026-08-27 per the
// frontend team's exact request (their suggested shape, used verbatim).
// DELIBERATELY SEPARATE from ChangeRequestSchema/changeRequests above,
// which already covers a similar-in-spirit "customer requests an item
// change, vendor decides" concept but a different shape (changeType Add/
// Remove only, no "change" type; category/item free text, no setupId;
// no colour/type/volume). Confirmed with the user before adding this
// rather than trying to force the frontend's shape into changeRequests or
// guessing how the two should reconcile — flagged here as a likely future
// duplication worth resolving with whoever owns changeRequests, not
// silently merged. See CartItem.js's CustomizeRequestSchema for the
// customer-side origin of this same shape (Cart -> CheckoutSession line ->
// here, unchanged at each hop). Accept-and-store only, same as upstream —
// no validation against the package's actual item catalog.
const CustomizeRequestSchema = new mongoose.Schema(
  {
    setupId: { type: String, required: true },
    itemId: { type: String, required: true },
    requestType: { type: String, enum: ["change", "add", "remove"], required: true },
    label: { type: String, required: true, trim: true },
    quantity: { type: Number, default: null, min: 0 },
    type: { type: String, default: null, trim: true },
    colours: { type: [String], default: [] },
    volume: { type: String, default: null, trim: true },
    // Added 2026-09-22 with `_id: true` below, so the vendor can decide each
    // request individually from the booking details screen. Reuses
    // CHANGE_REQUEST_STATUSES rather than minting a parallel enum — the
    // decision a vendor makes here is the same` Pending/Accepted/Rejected
    // decision changeRequests already carries, even though the two request
    // shapes stay separate (see this schema's own comment above).
    status: {
      type: String,
      enum: CHANGE_REQUEST_STATUSES,
      default: "Pending",
    },
    // When the vendor last decided this request — stamped by updateBooking,
    // same as ChangeRequestSchema's own respondedAt.
    respondedAt: { type: Date, default: null },
    // When the customer sent it. Requests carried from checkout predate the
    // field; ones sent later from "Still needs changes" on Review Proposal
    // carry it, so the vendor can tell a follow-up round apart.
    requestedAt: { type: Date, default: null },
    // The vendor's optional reason when rejecting — see ChangeRequestSchema.
    vendorNote: { type: String, default: null, trim: true, maxlength: 500 },
  },
  // `_id: true` — was false until 2026-09-22. The vendor's accept/decline
  // addresses one request by id, so ids must be STABLE: Mongoose mints a
  // fresh _id every time it hydrates a subdocument that has none stored, so
  // an id read in a GET would not match the one a later PUT resolves
  // against. scripts/backfill-customize-request-ids.mjs persists ids on
  // every already-stored booking; run it before relying on this.
  { _id: true }
);

// Which of an item's OWN vendor-offered colours the customer picked — see
// CartItem.js's ColourPreferenceSchema for the full context (added
// 2026-09-30). Deliberately separate from CustomizeRequestSchema above:
// this is never something the vendor needs to accept/reject, just a
// preference to see, so it carries no `status` field.
const ColourPreferenceSchema = new mongoose.Schema(
  {
    setupId: { type: String, required: true },
    itemId: { type: String, required: true },
    itemLabel: { type: String, required: true, trim: true },
    colours: { type: [String], default: [] },
  },
  { _id: false }
);

// Added 2026-09-17 — Booking previously had NO field for the selected
// add-ons at all: pricing.addonsAdded only ever kept a rolled-up total
// (see bookingCreationService.js), and this schema itself never carried the
// per-addon list forward from the checkout line. That's a bigger gap than
// just missing color/category — the "Added Add-ons" list on the booking
// summary page had nothing real to read AT ALL, for any field, not just the
// ones the frontend flagged. Mirrors CartItem.js's SelectedAddOnSchema
// exactly (same category/subCategory/color/image fields, same reasoning:
// snapshot what the customer actually picked, not re-derivable catalog
// data) — kept as its own copy rather than a shared import since Booking.js
// and CartItem.js don't otherwise share schema modules. addOnId is a String
// for the same reason it is in CartItem.js: vendor step2 add-on
// subdocuments frequently have no _id at all, and the frontend falls back
// to a synthetic id ("addon-0"). Empty on vendor-created bookings (walk-ins
// etc.), which never go through a cart.
const SelectedAddOnSchema = new mongoose.Schema(
  {
    addOnId: { type: String, default: null },
    name: { type: String, required: true },
    price: { type: Number, required: true, default: 0 },
    quantity: { type: Number, default: 1, min: 1 },
    category: { type: String, default: null, trim: true },
    subCategory: { type: String, default: null, trim: true },
    color: { type: String, default: null, trim: true },
    image: { type: String, default: null },
  },
  { _id: false }
);

// Same gap/fix as SelectedAddOnSchema above, for choose-N picks instead of
// add-ons: pricing.itemsAdded only ever kept the rolled-up total, and this
// schema had no field to carry the actual selections (which items, from
// which group) forward from the checkout line at all — mirrors CartItem.js's
// SelectedItemSchema exactly (groupKey/itemId/itemName/price/isChargeable).
// itemId is a String for the same reason addOnId above is: vendor step2 item
// subdocuments frequently have no real _id, and the frontend falls back to a
// synthetic one.
const SelectedItemSchema = new mongoose.Schema(
  {
    groupKey: { type: String, required: true },
    itemId: { type: String, default: null },
    itemName: { type: String, required: true },
    price: { type: Number, default: 0 },
    isChargeable: { type: Boolean, default: false },
  },
  { _id: false }
);

const BookingSchema = new mongoose.Schema(
  {
    bookingId: {
      type: String,
      unique: true,
      required: true,
      default: () => generateISTId("EVT"),
      index: true,
    },
    vendorId: {
      type: String,
      ref: "Vendor",
      required: true,
      index: true,
    },
    packageId: {
      type: String,
      ref: "Package",
      required: true,
    },

    // Reference to the logged-in customer account this booking belongs to.
    // Optional/nullable: bookings can exist without one (vendor-entered
    // walk-in/offline bookings, enquiry-first bookings for a customer who
    // never created an account) — only a customer-initiated checkout flow
    // is expected to always set this. Existing bookings created before the
    // Customer model existed will have this as null; backfilling them is a
    // deliberate, separate decision (phone-number matching is not exact),
    // not something this field's presence does automatically.
    customerId: {
      type: String,
      ref: "Customer",
      default: null,
      index: true,
    },

    // Customer info (embedded) — this is the point-in-time snapshot of who
    // booked (same intent as packageSnapshot below): it is NOT kept in sync
    // with the Customer account after creation, and remains the source of
    // truth for "who did this booking say it was for" even if customerId is
    // null or the linked account's details later change.
    customer: {
      name: { type: String, required: true },
      phone: { type: String, default: null },
      email: { type: String, default: null },
    },

    // Event details
    eventType: {
      type: String,
      default: null,
    },
    eventDate: {
      type: Date,
      required: true,
    },
    guestRange: {
      min: { type: Number },
      max: { type: Number },
    },
    location: {
      type: String,
      default: null,
    },
    // Map link / deep-link backing the "See on map" action in the UI
    mapLink: {
      type: String,
      default: null,
    },
    // The vendor's BOOKED slot — "HH:MM" 24h, from the chosen time slot
    // (getPackageSlots/timeSlot), not the event's own actual timing. See
    // eventTiming below for that.
    startTime: {
      type: String,
      default: null,
    },
    endTime: {
      type: String,
      default: null,
    },
    // "When's the event?" (Contact page's EventTimingSection.tsx, added
    // 2026-09-22) — the ACTUAL start/end of the event itself, told to the
    // vendor so they can plan arrival/setup. Deliberately separate from
    // startTime/endTime above (the slot the vendor was BOOKED for) — see
    // CheckoutSession.js's own comment on why these can legitimately
    // differ. Carried over from CheckoutSession.eventTiming (one set for
    // the whole order) at booking-creation time — see bookingCreationService.js.
    eventTiming: {
      startTime: { type: String, default: null },
      endTime: { type: String, default: null },
    },

    // Carried over from CheckoutSession.alternateCoordinator/gstin at
    // booking-creation time — see that model's own comment for the full
    // context (added 2026-09-24, both were previously local-state-only on
    // the frontend and never reached the backend at all).
    alternateCoordinator: {
      name: { type: String, default: null },
      phone: { type: String, default: null },
    },
    gstin: {
      businessName: { type: String, default: null },
      number: { type: String, default: null },
    },

    packageSnapshot: {
      type: PackageSnapshotSchema,
      default: null,
    },

    // Booking metadata
    paymentType: {
      type: String,
      enum: PAYMENT_TYPES,
      required: true,
    },
    status: {
      type: String,
      enum: BOOKING_STATUSES,
      default: "NewBooking",
      index: true,
    },

    assignedEmId: {
      type: String,
      default: null,
      index: true,
    },
    assignedEmName: {
      type: String,
      default: null,
    },

    // Status transition trail — backs the message card on the details screen
    respondByAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    declinedAt: { type: Date, default: null },
    declineReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, enum: ["Vendor", "Customer"], default: null },
    cancellationReason: { type: String, default: null },
    // Stamped by the save hook below whenever the booking becomes Completed.
    completedAt: { type: Date, default: null },
    // First time the vendor opened the booking (NewBooking -> Viewed).
    viewedAt: { type: Date, default: null },

    // Unread tracking for the vendor's list: a booking is unread while the
    // customer has done something (created it, sent changes) since the
    // vendor last opened it. Kept apart from updatedAt, which the vendor's
    // own edits — and opening it — also bump.
    vendorSeenAt: { type: Date, default: null },
    lastCustomerActivityAt: { type: Date, default: Date.now },

    // Post-event issues and the deadline for raising them — see
    // ISSUE_WINDOW_HOURS. Recomputed whenever the event's date or slot moves.
    issues: [IssueSchema],
    issueWindowClosesAt: { type: Date, default: null },

    // Customer-requested additions/removals, and the vendor's decision on each
    changeRequests: [ChangeRequestSchema],

    // PDP "Customize items" workshop requests — see CustomizeRequestSchema's
    // own comment above for why this is separate from changeRequests.
    customizeRequests: [CustomizeRequestSchema],

    // The customer's answer to the vendor's decisions on their requests —
    // the "Review Proposal" screen. null status means the vendor's latest
    // decisions haven't been answered yet; updateBooking resets it whenever
    // the vendor decides a request, so every new round is reviewed afresh.
    // "ChangesRequested" is set when the customer sends follow-up requests
    // instead of accepting.
    proposalResponse: {
      status: { type: String, enum: [...PROPOSAL_RESPONSE_STATUSES, null], default: null },
      respondedAt: { type: Date, default: null },
    },
    // Bumped every time the vendor changes the proposal (decisions, pricing
    // or the payment plan). The customer's Accept Proposal carries the
    // version they were shown, so accepting a proposal the vendor has since
    // changed is refused instead of locking in terms nobody reviewed.
    proposalVersion: { type: Number, default: 0 },
    proposalSentAt: { type: Date, default: null },

    // PDP item-details colour picks — see ColourPreferenceSchema's own
    // comment above. Not a request; informational only for the vendor.
    colourPreferences: [ColourPreferenceSchema],

    // The add-ons actually selected on this booking's line at checkout,
    // carried through cart -> checkout line -> here — see
    // SelectedAddOnSchema's own comment above for why this was missing
    // entirely until now.
    selectedAddOns: { type: [SelectedAddOnSchema], default: [] },

    // The choose-N picks actually selected on this booking's line at
    // checkout, carried through cart -> checkout line -> here — see
    // SelectedItemSchema's own comment above for why this was missing
    // entirely until now (only the rolled-up pricing.itemsAdded total
    // survived).
    selectedItems: { type: [SelectedItemSchema], default: [] },

    pricing: {
      type: PricingSchema,
      default: () => ({}),
    },

    // Payment milestones
    paymentMilestones: [PaymentMilestoneSchema],

    // Derived from the pricing breakdown on every pricing-affecting change
    totalAmount: {
      type: Number,
      default: 0,
    },
    totalReceived: {
      type: Number,
      default: 0,
    },

    notes: {
      type: String,
      default: null,
    },

    // The customer's note about the EVENT itself, distinct from `notes`
    // (their note to this vendor, carried from the cart's specialRequest).
    // Added 2026-09-22 because the vendor's booking details screen shows the
    // two in different places — "Event Note" on the event details card,
    // "Customer Note" inside the package card. Nothing writes it yet: no
    // cart/checkout field maps to it, so it stays null until a customer-side
    // flow produces one, and the vendor's screen hides the box while it is.
    eventNote: {
      type: String,
      default: null,
    },

    // "Notes for vendor" image attachments — see CartItem.js's own comment
    // on noteAttachments for the full context (this is where that line's
    // attachments end up once a real Booking is created from it).
    noteAttachments: { type: [String], default: [] },

    // Customer convenience fee (platform fee, NOT a vendor charge) frozen
    // from the checkout quote at booking-creation time — added 2026-09-10.
    // A real amount the customer paid, so it's stored, not recomputed on
    // read (the vendor's own attributes / the fee tables could change
    // later). null when the quote couldn't produce one. See
    // src/services/convenienceFeeService.js for the calculation.
    convenienceFee: { type: Number, default: null },
    convenienceFeeBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },

    // ─── Event day (see the "Event day" section above) ───
    // Each step is stamped when the vendor completes it; null means not yet.
    // Vendor arrived at the venue. Only possible on the event day
    // (isEventDay); every later step requires it.
    checkedInAt: { type: Date, default: null },
    // Proof-of-setup photo URLs (uploaded client-side first), at most
    // MAX_SETUP_PHOTOS. Submitting them is what marks setup done.
    setupPhotos: { type: [String], default: [] },
    setupCompletedAt: { type: Date, default: null },
    // The vendor's latest ask for the balance — re-asking refreshes it.
    // Only a stamp: no SMS/push system exists, the app shares the ask itself.
    paymentRequestedAt: { type: Date, default: null },
    // The vendor chose "Collect later" when asked about the balance before
    // setup, so the app stops prompting for it.
    paymentDeferredAt: { type: Date, default: null },
    // Venue cleared. Allowed only after setup and once the event has started.
    teardownCompletedAt: { type: Date, default: null },
    // On-ground contact for the day — see GroundStaffSchema. null when the
    // vendor hasn't assigned one (or removed them).
    groundStaff: { type: GroundStaffSchema, default: null },
    // Changes the customer asks for on the event day — see DayRequestSchema.
    dayRequests: { type: [DayRequestSchema], default: [] },

    // Vendor-private note from the "Calendar Note" section
    calendarNote: {
      type: String,
      default: null,
    },
    // Set when the vendor's account is purged. The booking is the customer's
    // record too, so it is retained and anonymised rather than deleted.
    vendorDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Best-effort auto-link: if a booking is saved without a customerId but has
// a customer.phone, try to match it to an existing Customer account so
// vendor-created bookings (walk-ins, enquiry-first, vendor manually typing
// in a phone number) still end up linked when that phone happens to belong
// to a registered customer — without vendorController/bookingController
// (not touched by this change) needing any awareness of Customer accounts
// at all. Never overwrites an already-set customerId, never fails the save
// if no match is found or the lookup errors — this is purely additive.
BookingSchema.pre("save", async function autoLinkCustomer() {
  if (this.customerId || !this.customer?.phone) return;
  try {
    const normalized = normalizePhone(this.customer.phone);
    if (!normalized) return;
    // Looked up through the registry rather than imported: Customer is not
    // otherwise needed here, and a static import risks a model import cycle.
    // Customer routes scope bookings by the account's Mongo _id (see
    // bookingLookupQuery), so that is what gets stored — not the public id.
    const match = await mongoose.model("Customer").findOne({ phone: normalized }).select("_id").lean();
    if (match) this.customerId = String(match._id);
  } catch (err) {
    console.warn("[Booking.autoLinkCustomer] lookup failed, continuing without a link:", err.message);
  }
});

BookingSchema.pre("save", function stampLifecycle() {
  if (this.isModified("status") && this.status === "Completed" && !this.completedAt) {
    this.completedAt = new Date();
  }
  if (
    this.isNew ||
    this.isModified("eventDate") ||
    this.isModified("startTime") ||
    this.isModified("endTime") ||
    !this.issueWindowClosesAt
  ) {
    const end = eventEndOf(this);
    this.issueWindowClosesAt = end
      ? new Date(end.getTime() + ISSUE_WINDOW_HOURS * 60 * 60 * 1000)
      : null;
  }
});

// Compound indexes
BookingSchema.index({ vendorId: 1, status: 1 });
BookingSchema.index({ vendorId: 1, eventDate: 1 });
// Supports the customer-facing "my bookings" dashboard (active/past/cancelled
// tabs, sorted/filtered by status or event date) once that endpoint exists.
BookingSchema.index({ customerId: 1, status: 1 });
BookingSchema.index({ customerId: 1, eventDate: 1 });
// Resolves a ground-contact link (GET /api/ground/:code). Partial so the
// many bookings without a ground contact don't collide on a missing code.
BookingSchema.index(
  { "groundStaff.code": 1 },
  { unique: true, partialFilterExpression: { "groundStaff.code": { $type: "string" } } }
);

export default mongoose.model("Booking", BookingSchema);
