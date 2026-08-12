import mongoose from "mongoose";
import Vendor from "../models/Vendor.js";
import Booking from "../models/Booking.js";
import Package from "../models/Package.js";
import { PUBLIC_VENDOR_FIELDS } from "../utils/publicFields.js";

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

// Which Booking.status values fall under each dashboard tab. "Declined"
// (vendor rejected before ever proceeding) is bucketed under "cancelled" —
// not explicitly specified by the final BRD, which only names three tabs
// without enumerating every status; this is the most defensible read
// (a declined booking isn't "active" or "past-and-fulfilled" either),
// flagged here as an assumption rather than picked silently.
const STATUS_BY_TAB = {
  active: ["Pending", "Accepted"],
  past: ["Completed"],
  cancelled: ["Cancelled", "Declined"],
};

const BOOKING_LIST_FIELDS =
  "bookingId vendorId packageId eventType eventDate location packageSnapshot paymentType status " +
  "totalAmount totalReceived createdAt";

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    const query = { customerId: req.customer._id };
    if (bookingId.startsWith("EVT")) {
      query.bookingId = bookingId;
    } else if (mongoose.Types.ObjectId.isValid(bookingId)) {
      query._id = bookingId;
    } else {
      return res.status(400).json({ status: "FAILED", message: "Invalid bookingId" });
    }

    const booking = await Booking.findOne(query).populate({ path: "vendorId", select: PUBLIC_VENDOR_FIELDS }).lean();
    if (!booking) return res.status(404).json({ status: "FAILED", message: "Booking not found" });

    // Price breakdown — built entirely from what's actually stored on the
    // booking (Step 19's charges[], now including a real "Tax" line — see
    // the fix note in bookingCreationService.js). subtotal/taxAmount are
    // SUMMED from the real charge rows, not recomputed/guessed, so this
    // always reconciles with whatever was actually charged.
    const charges = booking.charges || [];
    const subtotal = charges.filter((c) => c.type === "Base" || c.type === "Fee").reduce((sum, c) => sum + c.amount, 0);
    const taxAmount = charges.filter((c) => c.type === "Tax").reduce((sum, c) => sum + c.amount, 0);
    const discountAmount = charges.filter((c) => c.type === "Discount").reduce((sum, c) => sum + c.amount, 0);
    const priceBreakdown = {
      charges,
      subtotal,
      taxAmount,
      discountAmount,
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
    const pkg = await Package.findById(booking.packageId)
      .select("step3_policiesAndCharges.cancellationPolicy step3_policiesAndCharges.lastMinutePolicy step3_policiesAndCharges.generalPolicies")
      .lean();
    const cancellationPolicy = {
      cancellationPolicy: pkg?.step3_policiesAndCharges?.cancellationPolicy || null,
      lastMinutePolicy: pkg?.step3_policiesAndCharges?.lastMinutePolicy || null,
      generalPolicies: pkg?.step3_policiesAndCharges?.generalPolicies || [],
      note: pkg
        ? "Live policy from the vendor's current package settings — not a locked snapshot from when this booking was made."
        : "The original package could not be found — no policy available.",
    };

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
