import Booking from "../models/Booking.js";
import Package from "../models/Package.js";
import { generateISTId } from "../utils/idGenerator.js";
import { utcDayRange } from "../utils/dateRange.js";
import { round2 } from "../utils/money.js";
import { applyPricingBreakdown } from "../utils/pricingBreakdown.js";

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

// REWRITTEN 2026-08-27 — Booking.js was rewritten vendor-side (prod merge):
// paymentMilestones[] no longer has a `type` field at all (the old strict
// 4-value Token/Advanced1/Advanced2/FinalClearance enum is GONE), replaced
// by a free-text `title` — the exact same free-text field
// Package.paymentMilestones.milestones[].title already used. This actually
// REMOVES the old mismatch (no enum to squeeze free text into anymore) and
// the old 4-milestone cap along with it — every configured milestone is now
// tracked, not just the first 4.
function mapMilestonesToBookingSchema(quoteMilestones, tokenAmountPaid, paidAt, assumeFullyPaid = false) {
  // assumeFullyPaid (2026-08-27, off-platform payment confirmation — see
  // confirmOfflineCheckout) — every milestone is trusted as already
  // collected, not just the token: there's no real Cashfree order tracking
  // partial receipt per milestone for an off-platform booking, so the
  // honest thing is "we're told this is fully paid" rather than
  // fabricating which specific milestone the money maps to.
  if (assumeFullyPaid) {
    return quoteMilestones.map((m, i) => ({
      title: m.title || `Milestone ${i + 1}`,
      percentage: m.percentage ?? null,
      amount: m.amount ?? 0,
      dueDate: m.dueDate || null,
      status: "Received",
      receivedDate: paidAt,
    }));
  }

  // The milestone whose amount matches what was actually paid (the Token)
  // is marked Received now; the rest start Pending. Matched by amount
  // rather than assumed-first, same reasoning as before this rewrite.
  const tokenIndex = quoteMilestones.findIndex((m) => Math.abs((m.amount || 0) - tokenAmountPaid) < 0.01);

  return quoteMilestones.map((m, i) => ({
    title: m.title || `Milestone ${i + 1}`,
    percentage: m.percentage ?? null,
    amount: m.amount ?? 0,
    dueDate: m.dueDate || null,
    status: i === tokenIndex ? "Received" : "Pending",
    receivedDate: i === tokenIndex ? paidAt : null,
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
 *
 * @param {{assumeFullyPaid?: boolean}} [options] - assumeFullyPaid
 * (2026-08-27, off-platform payment confirmation): in-app Cashfree
 * collection is gone for this flow — confirmOfflineCheckout trusts the
 * WHOLE session as paid in full off-platform, not just a token amount.
 * Every line's paymentType becomes "FullPaid" (not "AdvancePaid"/
 * "FreeBooking"), totalReceived is set to the FULL line amount (not just a
 * token), and every milestone is marked Received — see
 * mapMilestonesToBookingSchema's own comment on why.
 */
export async function createBookingsFromCheckoutSession(session, payment, options = {}) {
  const { assumeFullyPaid = false } = options;
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
    const totalReceivedForLine = assumeFullyPaid ? quoteLine.lineTotalInclGst || 0 : tokenAmountForLine;

    // REWRITTEN 2026-08-27 — Booking.js's ChargeSchema/charges[] is GONE
    // (vendor-side prod rewrite), replaced by a `pricing` object (cumulative
    // additions/deductions + a tax rate, see utils/pricingBreakdown.js's own
    // doc comment: "the vendor prices a negotiation in bulk... not a price
    // per requested item"). Populated from the SAME quote numbers the old
    // charges[] used, just reshaped to fit — addonsTotal/chargeableItemsTotal
    // become itemsAdded/addonsAdded, tax is a RATE now (taxRatePct) rather
    // than a precomputed amount, computed fresh from this by
    // applyPricingBreakdown below (the vendor team's own utility — reused
    // rather than reimplemented, since it already defines exactly how this
    // object is meant to turn into a total).
    const milestones = mapMilestonesToBookingSchema(quoteLine.milestones || [], tokenAmountForLine, payment.paidAt || new Date(), assumeFullyPaid);

    const booking = new Booking({
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
        gstRatePercent: quoteLine.gstRatePercent ?? null,
        gstInclusive: !!quoteLine.gstInclusive,
      },
      paymentType: assumeFullyPaid ? "FullPaid" : isFree ? "FreeBooking" : "AdvancePaid",
      status: "NewBooking", // awaiting vendor acknowledgement — the new schema's own default/first status, never auto-Confirmed here
      paymentMilestones: milestones,
      pricing: {
        basePrice: quoteLine.packagePriceTotal || 0,
        itemsAdded: round2((line.selectedItems || []).filter((s) => s.isChargeable).reduce((sum, s) => sum + (s.price || 0), 0)) || 0,
        addonsAdded: round2((line.selectedAddOns || []).reduce((sum, a) => sum + a.price * a.quantity, 0)) || 0,
        taxRatePct: quoteLine.gstRatePercent ?? 0,
        taxLabel: "GST",
        updatedAt: new Date(),
      },
      totalReceived: totalReceivedForLine,
      // PDP "Customize items" workshop requests, carried through from the
      // checkout line (which carried them from the cart item) — see
      // Booking.js's CustomizeRequestSchema comment for the full chain.
      customizeRequests: line.customizeRequests || [],
      notes: line.specialRequest || null,
    });
    // Vendor's own utility (utils/pricingBreakdown.js) — runs first so the
    // "Pricing Breakdown" card's own fields (subtotal/tax/etc.) are
    // populated the same way vendor-side reads them. BUT: that utility
    // always treats tax as EXCLUSIVE (adds it on top of subtotal) — it has
    // no gstInclusive branch. When a package's GST is actually inclusive,
    // trusting its totalAmount would double-count tax already folded into
    // the price, and — critically — would stop matching what Cashfree
    // actually charged (quoteLine.lineTotalInclGst, computed correctly by
    // this codebase's own inclusive-aware pricing engine). totalAmount is
    // therefore always overwritten with the REAL charged amount afterward —
    // this also protects the "milestones must sum to what's actually
    // charged" invariant already fixed once before (see Step 19's info.txt
    // writeup on why milestones and the token amount must agree in rupees).
    applyPricingBreakdown(booking);
    booking.totalAmount = quoteLine.lineTotalInclGst || 0;
    await booking.save();

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
  // Added 2026-08-27 (real Cashfree redirect integration) — see Payment.js's
  // own comment on createdBookingIds for why every path that creates
  // bookings sets this, not just the real-Cashfree one.
  payment.createdBookingIds = createdBookingIds;
  await payment.save();

  return createdBookingIds;
}

export default createBookingsFromCheckoutSession;
