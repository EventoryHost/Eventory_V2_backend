import mongoose from "mongoose";
import { round2 } from "../../utils/money.js";

/**
 * Vendor behaviour counters (PRD §5.2), maintained from Booking status
 * transitions so every path that moves a booking — customer, vendor app,
 * admin — feeds the same raw facts:
 *
 *   created (Eventory checkout)        qualifiedLeads +1, vendorActionRequired +1
 *   pre-acceptance -> Confirmed        acceptedLeads +1, bookings +1, response
 *   pre-acceptance -> Declined         rejectedLeads +1, response
 *   -> Cancelled by Vendor             vendorCancelled +1, vendorAttributableFailure +1
 *   -> Cancelled by Customer           customerCancelled +1
 *   -> Completed                       completedBookings +1, totalGmv, trial progress
 *
 * Only Eventory bookings count (they carry a commercialSnapshot); a vendor's
 * own manual/offline booking is not Eventory demand.
 *
 * Registered on BookingSchema (models/Booking.js). Models are looked up via
 * mongoose.model() to avoid an import cycle with Booking/Vendor. A counter
 * failure is logged, never thrown — it must not undo the booking write.
 */

const PRE_ACCEPTANCE = ["NewBooking", "Viewed", "InDiscussion"];
const TRIAL_BOOKINGS_DEFAULT = 5;

const minutesBetween = (from, to) =>
  from && to ? Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 60000) : null;

function vendorFilter(vendorId) {
  const id = String(vendorId);
  return mongoose.Types.ObjectId.isValid(id) ? { $or: [{ _id: id }, { id }] } : { id };
}

async function isEventoryBooking(doc) {
  if (doc.commercialSnapshot != null) return true;
  return Boolean(
    await mongoose.model("Booking").exists({ _id: doc._id, commercialSnapshot: { $ne: null } })
  );
}

function transitionUpdate(doc, fromStatus) {
  const inc = {};
  const to = doc.status;

  if (to === "Confirmed" && PRE_ACCEPTANCE.includes(fromStatus)) {
    inc["commercial.counters.acceptedLeadsCount"] = 1;
    inc["commercial.counters.bookingsCount"] = 1;
    const mins = minutesBetween(doc.createdAt, doc.confirmedAt || new Date());
    if (mins != null) {
      inc["commercial.counters.responseCount"] = 1;
      inc["commercial.counters.responseTimeTotalMinutes"] = round2(mins);
    }
  } else if (to === "Declined" && PRE_ACCEPTANCE.includes(fromStatus)) {
    inc["commercial.counters.rejectedLeadsCount"] = 1;
    const mins = minutesBetween(doc.createdAt, doc.declinedAt || new Date());
    if (mins != null) {
      inc["commercial.counters.responseCount"] = 1;
      inc["commercial.counters.responseTimeTotalMinutes"] = round2(mins);
    }
  } else if (to === "Cancelled") {
    if (doc.cancelledBy === "Vendor") {
      inc["commercial.counters.vendorCancelledCount"] = 1;
      inc["commercial.counters.vendorAttributableFailureCount"] = 1;
    } else if (doc.cancelledBy === "Customer") {
      inc["commercial.counters.customerCancelledCount"] = 1;
    }
  } else if (to === "Completed") {
    inc["commercial.counters.completedBookingsCount"] = 1;
    inc["commercial.successfulBookingsCount"] = 1;
    const gmv = doc.commercialSnapshot?.vendorServiceValue ?? doc.pricing?.subtotal ?? 0;
    if (gmv) inc["commercial.counters.totalGmv"] = round2(gmv);
  }
  return inc;
}

async function applyCounters(doc, fromStatus, isNew) {
  if (!doc.vendorId) return;
  if (!(await isEventoryBooking(doc))) return;

  const inc = isNew
    ? { "commercial.counters.qualifiedLeadsCount": 1, "commercial.counters.vendorActionRequiredCount": 1 }
    : transitionUpdate(doc, fromStatus);
  if (!Object.keys(inc).length) return;

  const Vendor = mongoose.model("Vendor");
  const vendor = await Vendor.findOneAndUpdate(vendorFilter(doc.vendorId), { $inc: inc }, { new: true })
    .select("commercial.monetizationModel commercial.successfulBookingsCount")
    .lean();

  // §9.1: the trial ends after N successful bookings.
  if (inc["commercial.successfulBookingsCount"] && vendor?.commercial?.monetizationModel === "TRIAL") {
    const RuleSet = mongoose.models.CommercialRuleSet;
    const active = RuleSet
      ? await RuleSet.findOne({ status: "ACTIVE" }).select("rules.commission.trialBookings").lean()
      : null;
    const threshold = active?.rules?.commission?.trialBookings ?? TRIAL_BOOKINGS_DEFAULT;
    if ((vendor.commercial.successfulBookingsCount ?? 0) >= threshold) {
      await Vendor.updateOne({ _id: vendor._id }, { $set: { "commercial.monetizationModel": "COMMISSION" } });
    }
  }
}

export function registerBookingCounterHooks(schema) {
  schema.post("init", function rememberStatus() {
    this.$locals.statusAtLoad = this.status;
  });

  schema.pre("save", function markTransition() {
    this.$locals.counterIsNew = this.isNew;
    this.$locals.counterFrom = this.isNew ? null : this.$locals.statusAtLoad;
    this.$locals.counterChanged = this.isNew || this.isModified("status");
  });

  schema.post("save", async function updateCounters(doc) {
    if (!doc.$locals.counterChanged) return;
    const from = doc.$locals.counterFrom;
    if (!doc.$locals.counterIsNew && from === doc.status) return;
    try {
      await applyCounters(doc, from, doc.$locals.counterIsNew);
    } catch (err) {
      console.error(`[bookingCounters] vendor counters not updated for booking ${doc.bookingId}:`, err.message);
    }
    doc.$locals.statusAtLoad = doc.status;
  });
}
