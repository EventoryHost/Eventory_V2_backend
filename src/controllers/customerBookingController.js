import mongoose from "mongoose";
import Vendor from "../models/Vendor.js";
import Booking, { PRE_ACCEPTANCE_STATUSES, TERMINAL_STATUSES } from "../models/Booking.js";
import Package from "../models/Package.js";
import { PUBLIC_VENDOR_FIELDS } from "../utils/publicFields.js";
import { getOrCreateInvoiceForBooking, renderInvoicePdf } from "../services/invoiceService.js";
import { withPricingBreakdown } from "../utils/pricingBreakdown.js";

/**
 * "My Bookings" dashboard — Phase 5 Step 20. Pure read-only projection over
 * the existing vendor-authored Booking model, scoped to the logged-in
 * customer's own customerId (real, per Phase 4 Step 19 — no phone-matching
 * needed for anything created through this flow). No vendor-side code
 * touched.
 *
 * *** KNOWN LIMITATION, tied to the still-open PART 5 Flag #4: *** the
 * final BRD's dashboard card shows a "vendor count" per booking, implying
 * one card can represent a multi-vendor ORDER. Booking.js has no field
 * correlating multiple Bookings created from the same checkout (no
 * groupId/checkoutSessionId — Phase 4 Step 19 didn't add one, deliberately,
 * pending that flag's resolution). This endpoint therefore lists ONE ROW
 * PER BOOKING (i.e. per vendor), not per order — the honest reflection of
 * what this data model can currently express, not a fabricated grouping.
 */

// Which Booking.status values fall under each dashboard tab. REWRITTEN
// 2026-08-27 — Booking.js's status enum changed vendor-side (prod merge):
// Pending/Accepted no longer exist, replaced by NewBooking/Viewed/
// InDiscussion/Confirmed. Built off the vendor's OWN exported groupings
// (PRE_ACCEPTANCE_STATUSES, TERMINAL_STATUSES) rather than re-guessing the
// new values by hand, so this stays correct automatically if that enum
// changes again. "Declined" stays bucketed under "cancelled" (same
// assumption as before this rewrite — the final BRD names three tabs
// without enumerating every status; a declined booking isn't "active" or
// "past-and-fulfilled" either) — TERMINAL_STATUSES already groups
// Declined/Cancelled/Completed together, so "past" (Completed only) is
// carved out explicitly and the rest of TERMINAL_STATUSES becomes
// "cancelled". "Confirmed" (post-acceptance, pre-completion) is added onto
// PRE_ACCEPTANCE_STATUSES for "active" — an ongoing, non-terminal booking.
const STATUS_BY_TAB = {
  active: [...PRE_ACCEPTANCE_STATUSES, "Confirmed"],
  past: ["Completed"],
  cancelled: TERMINAL_STATUSES.filter((s) => s !== "Completed"),
};

const BOOKING_LIST_FIELDS =
  "bookingId vendorId packageId eventType eventDate location packageSnapshot paymentType status " +
  "totalAmount totalReceived createdAt";

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Shared by getBookingDetail (Step 21) and cancelBooking (Step 23) — fetched
// LIVE from the package's CURRENT policy fields, not a locked snapshot (see
// the "FLAGGED" note on this in getBookingDetail below for why).
async function getLiveCancellationPolicy(packageId) {
  const pkg = await Package.findById(packageId)
    .select("step3_policiesAndCharges.cancellationPolicy step3_policiesAndCharges.lastMinutePolicy step3_policiesAndCharges.generalPolicies")
    .lean();
  return {
    cancellationPolicy: pkg?.step3_policiesAndCharges?.cancellationPolicy || null,
    lastMinutePolicy: pkg?.step3_policiesAndCharges?.lastMinutePolicy || null,
    generalPolicies: pkg?.step3_policiesAndCharges?.generalPolicies || [],
    note: pkg
      ? "Live policy from the vendor's current package settings — not a locked snapshot from when this booking was made."
      : "The original package could not be found — no policy available.",
  };
}

// Same dual-lookup convention used throughout this file/the vendor's own
// getBookingById — accepts either the human-readable bookingId ("EVT...")
// or the MongoDB _id.
function bookingLookupQuery(bookingIdParam, customerId) {
  const query = { customerId };
  if (bookingIdParam.startsWith("EVT")) {
    query.bookingId = bookingIdParam;
  } else if (mongoose.Types.ObjectId.isValid(bookingIdParam)) {
    query._id = bookingIdParam;
  } else {
    return null;
  }
  return query;
}

/**
 * @desc List the logged-in customer's bookings for one tab, with search,
 * sort, and pagination — plus counts for all three tabs together so the
 * frontend can render tab badges without three separate calls.
 */
export const getBookings = async (req, res) => {
  try {
    const { tab, q, sort, page, limit } = req.query;
    const customerId = req.customer._id;

    const query = { customerId, status: { $in: STATUS_BY_TAB[tab] } };

    if (q) {
      const rx = { $regex: escapeRegex(q), $options: "i" };
      const matchingVendorIds = await Vendor.find({ businessName: rx }).select("_id");
      query.$or = [{ bookingId: rx }, { eventType: rx }, { vendorId: { $in: matchingVendorIds.map((v) => v._id) } }];
    }

    const sortMap = {
      newest: { createdAt: -1 },
      eventDate_asc: { eventDate: 1 },
      eventDate_desc: { eventDate: -1 },
      amount_desc: { totalAmount: -1 },
    };

    const [bookings, total, counts] = await Promise.all([
      Booking.find(query)
        .select(BOOKING_LIST_FIELDS)
        .populate({ path: "vendorId", select: PUBLIC_VENDOR_FIELDS })
        .sort(sortMap[sort] || sortMap.newest)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Booking.countDocuments(query),
      // Counts ignore the search filter on purpose — tab badges reflect
      // the customer's WHOLE booking list, not the current search result.
      Booking.aggregate([
        { $match: { customerId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const countByStatus = Object.fromEntries(counts.map((c) => [c._id, c.count]));
    const tabCounts = Object.fromEntries(
      Object.entries(STATUS_BY_TAB).map(([tabName, statuses]) => [tabName, statuses.reduce((sum, s) => sum + (countByStatus[s] || 0), 0)])
    );

    const enriched = bookings.map((b) => ({
      ...b,
      amountDue: Math.max(0, (b.totalAmount || 0) - (b.totalReceived || 0)),
    }));

    return res.status(200).json({
      status: "SUCCESS",
      count: enriched.length,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      counts: tabCounts,
      bookings: enriched,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch bookings", error: error.message });
  }
};

/**
 * @desc Expanded booking detail — Phase 5 Step 21. Ownership-scoped (a
 * booking that exists but belongs to another customer 404s, same as
 * everywhere else in this codebase — never leaks existence). Accepts
 * either the human-readable bookingId ("EVT...") or the MongoDB _id, same
 * dual-lookup convention as the vendor's own getBookingById
 * (bookingController.js).
 */
export const getBookingDetail = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const query = bookingLookupQuery(bookingId, req.customer._id);
    if (!query) return res.status(400).json({ status: "FAILED", message: "Invalid bookingId" });

    const booking = await Booking.findOne(query).populate({ path: "vendorId", select: PUBLIC_VENDOR_FIELDS }).lean();
    if (!booking) return res.status(404).json({ status: "FAILED", message: "Booking not found" });

    // Price breakdown — REWRITTEN 2026-08-27: Booking.js's ChargeSchema/
    // charges[] is gone vendor-side (prod merge), replaced by a `pricing`
    // object (cumulative additions/deductions + a tax rate). Reuses the
    // vendor's own utils/pricingBreakdown.js (withPricingBreakdown) rather
    // than re-deriving the math here, then reshapes it into the SAME
    // response fields this endpoint already returned (charges[]/subtotal/
    // taxAmount/discountAmount/...) so nothing downstream of this response
    // needs to change. A synthesized charges[] display array is built from
    // the breakdown's rows purely for that shape compatibility — it is
    // never stored, just rendered here.
    const { pricingBreakdown } = withPricingBreakdown(booking);
    const discountRow = pricingBreakdown.deductions.find((d) => d.key === "discountAllowed");
    const charges = [
      { label: booking.packageSnapshot?.name || "Package", amount: pricingBreakdown.originalPackagePrice, type: "Base" },
      ...pricingBreakdown.additions.map((a) => ({ label: a.label, amount: a.amount, type: "Fee" })),
      ...pricingBreakdown.deductions.filter((d) => d.key !== "discountAllowed").map((d) => ({ label: d.label, amount: d.amount, type: "Fee" })),
      { label: pricingBreakdown.tax.label, amount: pricingBreakdown.tax.amount, type: "Tax" },
    ];
    const priceBreakdown = {
      charges,
      subtotal: pricingBreakdown.subtotal,
      taxAmount: pricingBreakdown.tax.amount,
      discountAmount: discountRow ? Math.abs(discountRow.amount) : 0,
      totalAmount: booking.totalAmount,
      totalReceived: booking.totalReceived,
      amountDue: Math.max(0, (booking.totalAmount || 0) - (booking.totalReceived || 0)),
    };

    // Payment timeline — Booking.paymentMilestones already carries
    // status/receivedDate per milestone (Step 19); just ordered
    // chronologically for display (nulls — a non-numeric vendor dueDays
    // label, see Step 14 — sort last rather than first).
    const paymentTimeline = [...(booking.paymentMilestones || [])].sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });

    // Cancellation policy — fetched LIVE from the current Package, not a
    // locked snapshot (Booking.packageSnapshot doesn't capture policy
    // fields — only Step 19's original scope of name/price/image/
    // vendorType/variantType). FLAGGED: if the vendor edits their policy
    // after this booking was made, this shows the CURRENT policy, not
    // necessarily what applied when the customer actually booked. Not
    // retrofitted into Step 19 without confirming that's wanted — a real,
    // known limitation, not silently glossed over.
    const cancellationPolicy = await getLiveCancellationPolicy(booking.packageId);

    // EM contact — genuinely blocked, not guessed at. See info.txt PART 5
    // Flag #2: no EM/Admin model or em_owner-style field exists anywhere
    // in this codebase (Booking.js has no such field), and whether an
    // EM/Admin portal already exists elsewhere is still an open question.
    const emContact = {
      available: false,
      note: "No EM/Admin system exists in this codebase yet (see info.txt PART 5 Flag #2) — nothing real to surface here rather than a fabricated contact.",
    };

    return res.status(200).json({
      status: "SUCCESS",
      booking,
      priceBreakdown,
      paymentTimeline,
      cancellationPolicy,
      emContact,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch booking detail", error: error.message });
  }
};

/**
 * @desc Phase 5 Step 23 — cancel-booking endpoint, scoped to what's
 * actually decided/possible today (see info.txt for the full writeup of
 * what was explicitly deferred and why, confirmed with the user before
 * building this):
 *
 * - Refund ESTIMATE only, not a policy-computed amount: the only stored
 *   cancellation policy (Package.step3_policiesAndCharges.cancellationPolicy,
 *   models/schemas/policySchema.js) is a vendor-picked template/uploaded
 *   document/written text — files[]/writtenText/templateId, no structured
 *   percentage-by-tier field — so there is no safe way to compute a real
 *   refund number off it without inventing a parsing rule nobody specified.
 *   The estimate returned is simply totalReceived (everything paid so
 *   far), shown alongside the raw policy object and an explicit disclaimer
 *   that the real amount is subject to that policy, not derived from it.
 * - NO real refund is executed here — no Cashfree refund API call. This
 *   only marks the Booking Cancelled and reports what would be owed back;
 *   actually returning money needs a confirmed policy AND a process to
 *   apply it, neither of which exists yet (also ties into PART 5 Flag #2 —
 *   no EM/Admin/finance system this backend could hand the refund off to).
 * - NO vendor/admin notification: no email/SMS/notification system exists
 *   anywhere in this codebase to notify anyone through. Logged server-side
 *   only (console.warn) so it's visible in logs, not silently dropped, but
 *   not a real notification.
 */
export const cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const query = bookingLookupQuery(bookingId, req.customer._id);
    if (!query) return res.status(400).json({ status: "FAILED", message: "Invalid bookingId" });

    const booking = await Booking.findOne(query);
    if (!booking) return res.status(404).json({ status: "FAILED", message: "Booking not found" });

    // TERMINAL_STATUSES imported from Booking.js — reused rather than
    // hardcoded so this stays correct if that enum changes again (it
    // already did once, 2026-08-27 prod merge: Pending/Accepted/Declined/
    // Cancelled/Completed -> the current NewBooking/Viewed/InDiscussion/
    // Confirmed/Declined/Cancelled/Completed).
    if (TERMINAL_STATUSES.includes(booking.status)) {
      return res.status(409).json({
        status: "FAILED",
        message: `This booking is already ${booking.status.toLowerCase()} — it cannot be cancelled`,
      });
    }

    const cancellationPolicy = await getLiveCancellationPolicy(booking.packageId);
    const refundEstimate = {
      amount: booking.totalReceived || 0,
      note:
        "This is the full amount paid so far, NOT a policy-computed refund — the stored cancellation policy is a vendor-set document/template/written text, not structured rules this system can apply automatically. The actual refund amount is subject to the policy shown below and is not processed automatically by this endpoint.",
    };

    booking.status = "Cancelled";
    // cancelledAt/cancelledBy/cancellationReason are new fields on the
    // rewritten Booking.js (2026-08-27 prod merge) — populated now that
    // they exist; harmless no-ops on an older schema, genuinely useful on
    // this one (backs the vendor-side status-transition trail/message card).
    booking.cancelledAt = new Date();
    booking.cancelledBy = "Customer";
    await booking.save();

    // No notification system exists in this codebase yet (no email/SMS,
    // no EM/Admin portal) — logged so it's visible, not silently dropped.
    console.warn(
      `[cancelBooking] Booking ${booking.bookingId} (vendor ${booking.vendorId}) cancelled by customer ${req.customer._id}. ` +
        `Refund estimate: ${refundEstimate.amount}. No vendor/admin notification sent — no notification system exists yet.`
    );

    return res.status(200).json({
      status: "SUCCESS",
      message: "Booking cancelled",
      bookingId: booking.bookingId,
      bookingStatus: booking.status,
      refundEstimate,
      cancellationPolicy,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to cancel booking", error: error.message });
  }
};

/**
 * @desc Phase 5 Step 24 — invoice PDF download for a booking. ONE INVOICE
 * PER BOOKING (per vendor), confirmed with the user first — see Invoice.js
 * for why (open BRD question #6 on invoice consolidation, and no
 * cross-Booking groupId exists yet to build a consolidated one on top of).
 * Requires at least some payment received (totalReceived > 0) — an
 * invoice for money never actually paid isn't a real invoice, just a
 * pending quote (which the checkout session's own priceBreakdown already
 * covers). Idempotent: the FIRST call for a booking creates and freezes
 * the Invoice snapshot; every later call re-renders the SAME stored
 * snapshot to PDF rather than creating a new one or reflecting since-made
 * payments — see invoiceService.js's own comment on why re-issuing isn't
 * automatic.
 */
export const getInvoicePdf = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const query = bookingLookupQuery(bookingId, req.customer._id);
    if (!query) return res.status(400).json({ status: "FAILED", message: "Invalid bookingId" });

    const booking = await Booking.findOne(query);
    if (!booking) return res.status(404).json({ status: "FAILED", message: "Booking not found" });

    if (!booking.totalReceived || booking.totalReceived <= 0) {
      return res.status(400).json({ status: "FAILED", message: "No payment has been received for this booking yet — nothing to invoice" });
    }

    const vendor = await Vendor.findById(booking.vendorId).select("businessName city").lean();
    const invoice = await getOrCreateInvoiceForBooking(booking, vendor);
    const pdfBuffer = await renderInvoicePdf(invoice, booking);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to generate invoice", error: error.message });
  }
};
