import Booking from "../models/Booking.js";
import Package from "../models/Package.js";
import { generateISTId } from "../utils/idGenerator.js";
import { utcDayRange } from "../utils/dateRange.js";

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
 * this step's own title calls out, and (with assumeFullyPaid: true) from
 * confirmOfflineCheckout for payment handled entirely outside this app.
 *
 * "generateId.js" prefix note: bookingId uses generateISTId("EVT") —
 * REUSING the vendor-side bookingController.js's own convention
 * (src/utils/idGenerator.js) rather than inventing a new prefix, since
 * Booking.bookingId is a shared field vendor code also reads/matches on
 * (e.g. the "EVT"-prefixed lookup branch in getBookingById).
 */

// Booking.paymentMilestones[] (PaymentMilestoneSchema in Booking.js) takes
// {title, percentage, amount, dueDate, status, receivedDate} — title is
// required free text (the vendor's own milestone name, e.g. "Token",
// "Advance 2"), there is no "type" field and no 4-item cap. An earlier
// version of this function assumed a strict 4-value Token/Advanced1/
// Advanced2/FinalClearance "type" enum that does not exist on the current
// schema (Booking.create() would have thrown on the missing required
// `title`) — fixed here to pass the milestone's own real title through,
// uncapped, matching what quoteLine.milestones (cartPricingService.js)
// already carries.
function mapMilestonesToBookingSchema(quoteMilestones, tokenAmountPaid, paidAt, markAllReceived = false) {
  // The milestone whose amount matches what was actually paid is the one
  // marked Received first — usually the first configured, but matched by
  // amount rather than assumed-first in case a vendor ordered theirs
  // differently.
  const tokenIndex = quoteMilestones.findIndex((m) => Math.abs((m.amount || 0) - tokenAmountPaid) < 0.01);
  const ordered = tokenIndex > 0 ? [quoteMilestones[tokenIndex], ...quoteMilestones.filter((_, i) => i !== tokenIndex)] : quoteMilestones;

  return ordered.map((m, i) => ({
    title: m.title || `Milestone ${i + 1}`,
    percentage: m.percentage ?? null,
    amount: m.amount ?? 0,
    dueDate: m.dueDate || null,
    // markAllReceived: the "assume payment was handled off-platform" path
    // (see createBookingsFromCheckoutSession's assumeFullyPaid param) — every
    // milestone is already settled, not just the first.
    status: markAllReceived || i === 0 ? "Received" : "Pending",
    receivedDate: markAllReceived || i === 0 ? paidAt : null,
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
export async function createBookingsFromCheckoutSession(session, payment, { assumeFullyPaid = false } = {}) {
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
    // assumeFullyPaid: the payment itself happened off-platform (not
    // through this app's Cashfree integration) and is being taken on trust
    // as fully settled — see confirmOfflineCheckout in
    // customerPaymentController.js. Every line is recorded as FullPaid with
    // the whole amount received, not just its token, until real off-platform
    // payment tracking exists.
    const totalReceivedForLine = assumeFullyPaid ? quoteLine.lineTotalInclGst || 0 : tokenAmountForLine;

    const milestones = mapMilestonesToBookingSchema(
      quoteLine.milestones || [],
      totalReceivedForLine,
      payment.paidAt || new Date(),
      assumeFullyPaid
    );

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
      paymentType: assumeFullyPaid ? "FullPaid" : isFree ? "FreeBooking" : "AdvancePaid",
      status: "NewBooking", // awaiting vendor acknowledgement — never auto-Confirmed here; matches Booking.status's own enum/default
      paymentMilestones: milestones,
      totalAmount: quoteLine.lineTotalInclGst || 0,
      totalReceived: totalReceivedForLine,
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
