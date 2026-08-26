import Booking from "../models/Booking.js";
import Package from "../models/Package.js";
import { generateISTId } from "../utils/idGenerator.js";
import { utcDayRange } from "../utils/dateRange.js";
import { round2 } from "../utils/money.js";

/**
 * Turns a paid CheckoutSession into real Booking documents — Phase 4 Step
 * 19, the final step of the checkout/payment phase. One Booking per
 * checkout LINE (each line is already one vendor/package, matching
 * Booking.js's own one-vendor-per-document shape — no restructuring of
 * that vendor-authored model needed).
 *
 * Called from customerPaymentController.js in exactly two places: the
 * webhook handler and the GET status poll's live-recheck fallback, both
 * guarded by Payment.bookingCreated so a webhook retry (or a poll landing
 * right after the webhook already fired) can never create the same
 * booking twice — same idempotent-by-design pattern as the rest of this
 * payment flow. Also called (with a $0 "Free" payment) from the checkout
 * controller's confirm-free endpoint for the "(or no-upfront flow)" case
 * this step's own title calls out.
 *
 * "generateId.js" prefix note: bookingId uses generateISTId("EVT") —
 * REUSING the vendor-side bookingController.js's own convention
 * (src/utils/idGenerator.js) rather than inventing a new prefix, since
 * Booking.bookingId is a shared field vendor code also reads/matches on
 * (e.g. the "EVT"-prefixed lookup branch in getBookingById).
 */

// Booking.paymentMilestones[].type is a STRICT 4-value enum (Token,
// Advanced1, Advanced2, FinalClearance) — but the vendor's own
// Package.paymentMilestones.milestones[].title is free text with NO
// constraint tying it to that enum, and no cap on how many a vendor can
// configure. This is a genuine PRE-EXISTING mismatch between two
// vendor-authored schemas (Package.js vs Booking.js), not something
// introduced or fixable here (changing Booking.js's enum is a vendor-code
// change, off-limits without asking). Best-effort, honestly capped
// mapping: the milestone actually paid via this Token order becomes
// "Token"; the rest are assigned Advanced1/Advanced2/FinalClearance IN
// ORDER. If a vendor configured more than 4 total milestones, only the
// first 4 are tracked in Booking.paymentMilestones — flagged in info.txt,
// not silently dropped without a trace (a warning is logged).
function mapMilestonesToBookingSchema(quoteMilestones, tokenAmountPaid, paidAt) {
  const ENUM_SLOTS = ["Token", "Advanced1", "Advanced2", "FinalClearance"];
  if (quoteMilestones.length > ENUM_SLOTS.length) {
    console.warn(
      `[bookingCreationService] Package has ${quoteMilestones.length} payment milestones configured, but Booking.paymentMilestones only supports ${ENUM_SLOTS.length} (Token/Advanced1/Advanced2/FinalClearance) — only the first ${ENUM_SLOTS.length} are being tracked on this Booking.`
    );
  }

  // The milestone whose amount matches what was actually paid is the one
  // that becomes "Token" — usually the first, but matched by amount rather
  // than assumed-first in case a vendor ordered their milestones differently.
  const tokenIndex = quoteMilestones.findIndex((m) => Math.abs((m.amount || 0) - tokenAmountPaid) < 0.01);
  const ordered = tokenIndex > 0 ? [quoteMilestones[tokenIndex], ...quoteMilestones.filter((_, i) => i !== tokenIndex)] : quoteMilestones;

  return ordered.slice(0, ENUM_SLOTS.length).map((m, i) => ({
    type: ENUM_SLOTS[i],
    amount: m.amount ?? 0,
    dueDate: m.dueDate || null,
    status: i === 0 ? "Received" : "Pending",
    receivedDate: i === 0 ? paidAt : null,
  }));
}

// "Reserve slots" (this step's own wording) — adds/updates a "Booked"
// entry on the package's OWN availabilityCalendar array. This is NOT a
// vendor-code change: availabilityCalendar already exists on Package.js
// specifically to hold both vendor-entered Blocked entries AND
// system-written Booked entries side by side (see Package.js's own status
// enum: ["Available","Blocked","Booked"] — "Booked" has no other writer
// anywhere in this codebase until now, since nothing created real Bookings
// before this step). Best-effort: updates an existing same-day entry if
// one exists, otherwise pushes a new one; never downgrades an existing
// "Blocked" entry (a vendor's manual block takes precedence).
async function reserveSlot(packageId, eventDate) {
  if (!eventDate) return;
  const pkg = await Package.findById(packageId).select("availabilityCalendar");
  if (!pkg) return;

  const { start, end } = utcDayRange(eventDate);
  const existing = (pkg.availabilityCalendar || []).find((e) => {
    const d = new Date(e.date);
    return d >= start && d < end;
  });

  if (existing) {
    if (existing.status !== "Blocked") existing.status = "Booked";
  } else {
    pkg.availabilityCalendar.push({ date: start, status: "Booked" });
  }
  await pkg.save();
}

/**
 * @desc Creates one Booking per line in a paid CheckoutSession. Idempotent
 * at the CALLER's responsibility (guarded by Payment.bookingCreated) —
 * this function itself does not re-check, so it must only ever be invoked
 * once per Payment.
 */
export async function createBookingsFromCheckoutSession(session, payment) {
  const quoteLines = session.lockedQuote?.lines || [];
  const createdBookingIds = [];

  for (const line of session.lines) {
    const quoteLine = quoteLines.find((q) => String(q.lineId) === String(line._id));
    if (!quoteLine || quoteLine.available === false) {
      console.warn(`[bookingCreationService] Skipping line ${line._id} — not present or unavailable in the locked quote.`);
      continue;
    }

    const isFree = quoteLine.token?.paymentType === "Free";
    const tokenAmountForLine = isFree ? 0 : quoteLine.token?.tokenAmount || 0;

    const charges = [
      { label: quoteLine.currentPrice != null ? line.packageSnapshot?.name || "Package" : "Package", amount: quoteLine.packagePriceTotal || 0, type: "Base" },
      ...(line.selectedAddOns || []).map((a) => ({ label: a.name, amount: round2(a.price * a.quantity), type: "Fee" })),
      ...(line.selectedItems || []).filter((s) => s.isChargeable).map((s) => ({ label: s.itemName, amount: s.price || 0, type: "Fee" })),
      // GST as its OWN charge line — Booking.ChargeSchema's type enum
      // already includes "Tax" (vendor-authored, just unused until now).
      // Found while building Step 21's price-breakdown endpoint: without
      // this, charges never summed to totalAmount whenever GST applied
      // (totalAmount = lineTotalInclGst, but charges only covered the
      // pre-tax Base+Fee amounts) — added here, at the source, rather than
      // papering over it in the read endpoint. Only added when GST is
      // EXCLUSIVE (added on top) — when gstInclusive is true, the tax is
      // already embedded in the Base charge's amount, so adding a separate
      // line would double-count it and break the reconciliation the other
      // way.
      ...(!quoteLine.gstInclusive && quoteLine.gstAmount ? [{ label: `GST (${quoteLine.gstRatePercent}%)`, amount: quoteLine.gstAmount, type: "Tax" }] : []),
    ];

    const milestones = mapMilestonesToBookingSchema(quoteLine.milestones || [], tokenAmountForLine, payment.paidAt || new Date());

    const booking = await Booking.create({
      bookingId: generateISTId("EVT"),
      vendorId: line.vendorId,
      packageId: line.packageId,
      customerId: session.customerId, // REAL customerId, direct — no phone-matching auto-link needed, this step's own wording
      customer: {
        name: session.contactDetails?.name || "Customer",
        phone: session.contactDetails?.phone || null,
        email: session.contactDetails?.email || null,
      },
      eventType: line.eventDetails?.eventType || null,
      eventDate: line.eventDetails?.date,
      guestRange: { min: line.eventDetails?.guestCount || null, max: line.eventDetails?.guestCount || null },
      location: line.eventDetails?.location || null,
      packageSnapshot: {
        name: line.packageSnapshot?.name,
        price: line.packageSnapshot?.price,
        image: line.packageSnapshot?.image,
        vendorType: line.packageSnapshot?.vendorType,
        variantType: line.packageSnapshot?.variantType,
      },
      paymentType: isFree ? "FreeBooking" : "AdvancePaid",
      status: "Pending", // awaiting vendor acknowledgement — never auto-Accepted here
      paymentMilestones: milestones,
      charges,
      totalAmount: quoteLine.lineTotalInclGst || 0,
      totalReceived: tokenAmountForLine,
      notes: line.specialRequest || null,
    });

    createdBookingIds.push(booking._id);

    // Best-effort — a slot-reservation failure must not roll back a
    // successful Booking (the payment already went through).
    try {
      await reserveSlot(line.packageId, line.eventDetails?.date);
    } catch (err) {
      console.error(`[bookingCreationService] Failed to reserve slot for package ${line.packageId}:`, err.message);
    }
  }

  payment.bookingCreated = true;
  await payment.save();

  return createdBookingIds;
}

export default createBookingsFromCheckoutSession;
