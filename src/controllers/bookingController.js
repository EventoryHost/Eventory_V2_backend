import Booking, {
  PRE_ACCEPTANCE_STATUSES,
  TERMINAL_STATUSES,
  eventDayStarted,
  isFullyPaid,
} from "../models/Booking.js";
import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";
import CalendarBlock from "../models/CalendarBlock.js";
import { generateISTId } from "../utils/idGenerator.js";
import { snapshotDeliverables } from "../utils/packageDeliverables.js";
import { packageCoverImage } from "../utils/packageCoverImage.js";
import { getEffectivePackagePrice } from "../utils/packagePrice.js";
import { releaseSlotIfUnused } from "../utils/releaseSlot.js";
import { raiseBookingIssue } from "../services/bookingIssueService.js";
import {
  applyPricingBreakdown,
  withPricingBreakdown,
} from "../utils/pricingBreakdown.js";
import {
  DEFAULT_ADDITIONAL_CHARGES_LABEL,
  additionalChargesDelta,
  mergeAdditionalChargesIntoFinal,
} from "../utils/additionalCharges.js";
import {
  validateCreateBooking,
  validateChangeRequests,
  validateBookingUpdate,
  validatePaymentMilestonesUpdate,
} from "../validators/bookingValidators.js";

// ─── Constants ──────────────────────────────────────────────

/** Default vendor response window when the caller does not supply one. */
const RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────
// findBooking and the response helpers are exported for the other vendor
// booking controllers (eventDayController.js), so every /api/bookings route
// looks bookings up and answers failures the same way.

/**
 * Look a booking up by either its human-readable bookingId (EVT...) or its
 * MongoDB _id.
 */
export const findBooking = async (bookingId) =>
  bookingId.startsWith("EVT")
    ? Booking.findOne({ bookingId })
    : Booking.findById(bookingId);

export const notFound = (res, message) =>
  res.status(404).json({ status: "FAILED", message });

export const invalid = (res, errors) =>
  res
    .status(400)
    .json({ status: "FAILED", message: "Validation failed", errors });

export const failed = (res, message, error) => {
  console.error(`${message}:`, error);
  return res.status(500).json({ status: "ERROR", message, error: error.message });
};

/**
 * Check if a date has conflicts for the vendor (other bookings or calendar blocks).
 * Returns true if conflicting.
 */
export const detectConflict = async (vendorId, eventDate, excludeBookingId = null) => {
  const dateStart = new Date(eventDate);
  dateStart.setUTCHours(0, 0, 0, 0);
  const dateEnd = new Date(eventDate);
  dateEnd.setUTCHours(23, 59, 59, 999);

  const bookingQuery = {
    vendorId,
    eventDate: { $gte: dateStart, $lte: dateEnd },
    status: { $in: ["NewBooking", "Confirmed"] },
  };
  if (excludeBookingId) {
    bookingQuery._id = { $ne: excludeBookingId };
  }
  const otherBooking = await Booking.findOne(bookingQuery);

  const calendarBlock = await CalendarBlock.findOne({
    vendorId,
    isActive: true,
    startDate: { $lte: dateEnd },
    endDate: { $gte: dateStart },
  });

  return !!(otherBooking || calendarBlock);
};

/**
 * Sync package availability to "Booked" for the event date.
 */
export const syncPackageBooked = async (packageId, eventDate) => {
  const pkg = await Package.findById(packageId);
  if (!pkg) return;

  const dateStr = new Date(eventDate).toISOString().split("T")[0];
  const existing = pkg.availabilityCalendar.find((entry) => {
    return new Date(entry.date).toISOString().split("T")[0] === dateStr;
  });

  if (existing) {
    existing.status = "Booked";
  } else {
    pkg.availabilityCalendar.push({ date: eventDate, status: "Booked" });
  }
  await pkg.save();
};

/**
 * Revert package availability to "Available" for the event date.
 *
 * MERGE RESOLUTION 2026-09-25: this used to hold its own copy of the
 * release logic. That copy was extracted into utils/releaseSlot.js so the
 * customer cancel path could share it rather than drift; adminBooking-
 * Controller.js (added on dev in parallel) still imports this name, so the
 * export is kept and now simply delegates. One implementation, two callers
 * — re-inlining the old body would restore exactly the duplication the
 * extraction removed.
 *
 * Note this is strictly safer than the body it replaces: releaseSlotIfUnused
 * refuses to downgrade a vendor's manual "Blocked" entry, and won't free a
 * date some other live booking still occupies. The old version did neither.
 */
export const revertPackageAvailability = async (packageId, eventDate) =>
  releaseSlotIfUnused(packageId, eventDate);

/**
 * `totalReceived` is the sum of the milestones marked Received. Keeping the
 * derivation in one place stops the figure drifting from the plan it describes.
 */
/**
 * A booking inherits the package's payment plan. The package stores each
 * instalment as a share, so the amounts are resolved against this booking's
 * own total rather than the package's list price.
 */
const milestonesFromPackage = (pkg, total) => {
  const planned = pkg.paymentMilestones?.milestones ?? [];
  if (!planned.length) return [];

  const amounts = planned.map((m) =>
    Math.round((total * (m.percentage || 0)) / 100)
  );
  const drift = Math.round(total) - amounts.reduce((sum, a) => sum + a, 0);
  if (amounts.length) amounts[amounts.length - 1] += drift;

  return planned.map((m, i) => ({
    title: m.title,
    percentage: m.percentage,
    amount: amounts[i],
    dueDate: null,
    status: "Pending",
  }));
};

const receivedMilestonesTotal = (booking) =>
  booking.paymentMilestones
    .filter((m) => m.status === "Received")
    .reduce((sum, m) => sum + (m.amount || 0), 0);

/**
 * Money already taken that no Received milestone accounts for — usually the
 * checkout token, which is only matched to a milestone when the two amounts
 * are equal (services/bookingCreationService.js). Read it BEFORE changing the
 * plan and hand it to syncTotalReceived, or re-deriving the total from the
 * milestones alone silently drops a payment the customer made.
 */
const unattributedReceived = (booking) =>
  Math.max(0, (booking.totalReceived || 0) - receivedMilestonesTotal(booking));

/**
 * What the customer's schedule carries on top of the vendor's total: the
 * checkout convenience fee and its round-up to the next ₹100, which the quote
 * folds into the last milestone (services/cartPricingService.js) so the plan
 * adds up to what the customer actually pays. Read it BEFORE changing the
 * plan; a vendor re-planning in their own terms (milestones = totalAmount)
 * gets it added back, so Eventory's fee is never silently dropped.
 *
 * Only bookings that came through checkout carry a fee. The observed gap is
 * capped near that fee, so an older plan that simply drifted is not treated
 * as one.
 */
const scheduleExtra = (booking, unattributed) => {
  if (booking.convenienceFee == null) return 0;
  const scheduled = booking.paymentMilestones.reduce((sum, m) => sum + (m.amount || 0), 0);
  const gap = Math.round((scheduled + unattributed - (booking.totalAmount || 0)) * 100) / 100;
  return Math.min(Math.max(0, gap), (booking.convenienceFee || 0) + 100);
};

const syncTotalReceived = (booking, unattributed = 0) => {
  booking.totalReceived = receivedMilestonesTotal(booking) + unattributed;
};

const allRequests = (booking) => [
  ...(booking.changeRequests || []),
  ...(booking.customizeRequests || []),
];

const pendingRequestCount = (booking) =>
  allRequests(booking).filter((request) => request.status === "Pending").length;

/**
 * Why the vendor cannot confirm this booking themselves, or null when they
 * can. Once the customer has asked for anything, the vendor's decisions are a
 * proposal and the CUSTOMER confirms it (Accept Proposal on the customer
 * site, customerBookingController.acceptProposal) — the vendor's own accept
 * is only for a booking taken exactly as the package was sold.
 */
const vendorConfirmBlock = (booking) => {
  const pending = pendingRequestCount(booking);
  if (pending > 0) {
    return {
      code: "REQUESTS_PENDING",
      message: `Accept or reject every request first (${pending} still pending).`,
    };
  }
  if (allRequests(booking).length > 0 && booking.proposalResponse?.status !== "Accepted") {
    return {
      code: "CUSTOMER_MUST_ACCEPT",
      message: "The customer asked for changes, so they confirm this booking by accepting your proposal.",
    };
  }
  return null;
};

// ─── Controllers ────────────────────────────────────────────

/**
 * @desc    Create a new booking
 * @route   POST /api/bookings/vendor/:vendorId
 */
export const createBooking = async (req, res) => {
  try {
    const { vendorId } = req.params;

    const validation = validateCreateBooking(req.body);
    if (!validation.valid) return invalid(res, validation.errors);

    if (!(await Vendor.exists({ id: vendorId }))) {
      return notFound(res, "Vendor not found");
    }

    const pkg = await Package.findById(req.body.packageId);
    if (!pkg) return notFound(res, "Package not found");

    const conflictDetected = await detectConflict(vendorId, req.body.eventDate);

    const booking = new Booking({
      bookingId: generateISTId("EVT"),
      vendorId,
      packageId: pkg._id,
      customer: {
        name: req.body.customer.name.trim(),
        phone: req.body.customer.phone || null,
        email: req.body.customer.email || null,
      },
      eventType: req.body.eventType || null,
      eventDate: new Date(req.body.eventDate),
      guestRange: req.body.guestRange
        ? {
            min: req.body.guestRange.min,
            max: req.body.guestRange.max,
          }
        : undefined,
      location: req.body.location || null,
      mapLink: req.body.mapLink || null,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      packageSnapshot: {
        name: pkg.step1_eventAndCrew?.packageName || "Untitled Package",
        // getEffectivePackagePrice, not a plain read — see that util's
        // comment: packagePricing.price is never set for Caterer/Decorator
        // packages, which would otherwise snapshot a manually-created
        // booking's price as ₹0.
        price: getEffectivePackagePrice(pkg),
        image: packageCoverImage(pkg),
        vendorType: pkg.vendorType || null,
        variantType: pkg.variantType || "Premium",
        gstRatePercent: pkg.step3_policiesAndCharges?.gstRatePercent ?? null,
        gstInclusive: pkg.step3_policiesAndCharges?.gstInclusive ?? false,
        deliverables: snapshotDeliverables(pkg),
      },
      paymentType: req.body.paymentType,
      status: "NewBooking",
      // The vendor typed this booking in, so there is nothing unread in it.
      vendorSeenAt: new Date(),
      respondByAt: req.body.respondByAt
        ? new Date(req.body.respondByAt)
        : new Date(Date.now() + RESPONSE_WINDOW_MS),
      pricing: {
        basePrice: req.body.basePrice ?? null,
        // 0 when neither the request nor the package specifies a GST rate —
        // GST is never assumed (see PricingSchema.taxRatePct's own comment).
        taxRatePct:
          req.body.taxRatePct ??
          pkg.step3_policiesAndCharges?.gstRatePercent ??
          0,
      },
      totalReceived: 0,
      notes: req.body.notes || null,
      calendarNote: req.body.calendarNote || null,
    });

    const breakdown = applyPricingBreakdown(booking);
    booking.paymentMilestones = req.body.paymentMilestones?.length
      ? req.body.paymentMilestones
      : milestonesFromPackage(pkg, breakdown.finalAmount);
    syncTotalReceived(booking);
    await booking.save();

    return res.status(201).json({
      status: "SUCCESS",
      message: "Booking created",
      booking: withPricingBreakdown(booking),
      conflictDetected,
    });
  } catch (error) {
    return failed(res, "Failed to create booking", error);
  }
};

/**
 * @desc    Get vendor bookings (filtered, paginated)
 * @route   GET /api/bookings/vendor/:vendorId?status=Pending&paymentType=FreeBooking&page=1&limit=20
 */
export const getVendorBookings = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const {
      status,
      paymentType,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = req.query;

    const query = { vendorId };
    if (status) query.status = status;
    if (paymentType) query.paymentType = paymentType;
    if (startDate || endDate) {
      query.eventDate = {};
      if (startDate) query.eventDate.$gte = new Date(startDate);
      if (endDate) query.eventDate.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .sort({ eventDate: 1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Booking.countDocuments(query),
    ]);

    const results = [];
    for (const booking of bookings) {
      results.push({
        ...withPricingBreakdown(booking),
        conflictDetected: await detectConflict(
          vendorId,
          booking.eventDate,
          booking._id
        ),
      });
    }

    return res.status(200).json({
      status: "SUCCESS",
      count: results.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      bookings: results,
    });
  } catch (error) {
    return failed(res, "Failed to fetch vendor bookings", error);
  }
};

/**
 * @desc    Get a single booking by ID
 * @route   GET /api/bookings/:bookingId
 */
export const getBookingById = async (req, res) => {
  try {
    const booking = await findBooking(req.params.bookingId);
    if (!booking) return notFound(res, "Booking not found");

    const conflictDetected = await detectConflict(
      booking.vendorId,
      booking.eventDate,
      booking._id
    );

    return res.status(200).json({
      status: "SUCCESS",
      booking: withPricingBreakdown(booking),
      conflictDetected,
    });
  } catch (error) {
    return failed(res, "Failed to fetch booking", error);
  }
};

/**
 * @desc    Accept a booking
 * @route   PUT /api/bookings/:bookingId/accept
 */
export const acceptBooking = async (req, res) => {
  try {
    const booking = await findBooking(req.params.bookingId);
    if (!booking) return notFound(res, "Booking not found");

    if (!PRE_ACCEPTANCE_STATUSES.includes(booking.status)) {
      return res.status(400).json({
        status: "FAILED",
        message: `Cannot accept a booking with status "${booking.status}".`,
      });
    }

    const block = vendorConfirmBlock(booking);
    if (block) {
      return res.status(409).json({ status: "FAILED", ...block });
    }

    booking.status = "Confirmed";
    booking.confirmedAt = booking.confirmedAt || new Date();
    await booking.save();

    await syncPackageBooked(booking.packageId, booking.eventDate);

    return res.status(200).json({
      status: "SUCCESS",
      message: "Booking accepted",
      booking: withPricingBreakdown(booking),
    });
  } catch (error) {
    return failed(res, "Failed to accept booking", error);
  }
};

/**
 * @desc    Decline a booking
 * @route   PUT /api/bookings/:bookingId/decline
 */
export const declineBooking = async (req, res) => {
  try {
    const booking = await findBooking(req.params.bookingId);
    if (!booking) return notFound(res, "Booking not found");

    if (!PRE_ACCEPTANCE_STATUSES.includes(booking.status)) {
      return res.status(400).json({
        status: "FAILED",
        message: `Cannot decline a booking with status "${booking.status}".`,
      });
    }

    booking.status = "Declined";
    booking.declinedAt = new Date();
    booking.declineReason = req.body?.reason?.trim() || null;
    await booking.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Booking declined",
      booking: withPricingBreakdown(booking),
    });
  } catch (error) {
    return failed(res, "Failed to decline booking", error);
  }
};

/**
 * @desc    Cancel a booking
 * @route   PUT /api/bookings/:bookingId/cancel
 */
export const cancelBooking = async (req, res) => {
  try {
    const booking = await findBooking(req.params.bookingId);
    if (!booking) return notFound(res, "Booking not found");

    if (TERMINAL_STATUSES.includes(booking.status)) {
      return res.status(400).json({
        status: "FAILED",
        message: `Cannot cancel booking with status "${booking.status}".`,
      });
    }

    booking.status = "Cancelled";
    booking.cancelledAt = new Date();
    booking.cancelledBy =
      req.body?.cancelledBy === "Customer" ? "Customer" : "Vendor";
    booking.cancellationReason = req.body?.reason?.trim() || null;
    await booking.save();

    // Unconditional as of 2026-09-25 — this used to be gated on
    // `previousStatus === "Confirmed"`, on the assumption that only an
    // accepted booking could ever hold a calendar entry. Releasing is
    // idempotent and now self-guards (it only downgrades an actual
    // "Booked" entry, and only once no other live booking still needs the
    // date), so gating it bought nothing and risked stranding a date as
    // permanently "Booked" whenever an entry existed for any other reason.
    await releaseSlotIfUnused(booking.packageId, booking.eventDate, { excludeBookingId: booking._id });

    return res.status(200).json({
      status: "SUCCESS",
      message: "Booking cancelled",
      booking: withPricingBreakdown(booking),
    });
  } catch (error) {
    return failed(res, "Failed to cancel booking", error);
  }
};

/**
 * @desc    Submit the customer's requested package changes
 * @route   POST /api/bookings/:bookingId/change-requests
 * @body    { changes: [{ changeType, itemKind?, category, item, qty? }] }
 *
 * Each change points at a deliverable in the package snapshot by path, so a
 * request always refers to what the customer was actually sold. Requests land
 * as Pending and carry no weight in the pricing until the vendor accepts them.
 */
export const requestPackageChanges = async (req, res) => {
  try {
    const validation = validateChangeRequests(req.body);
    if (!validation.valid) return invalid(res, validation.errors);

    const booking = await findBooking(req.params.bookingId);
    if (!booking) return notFound(res, "Booking not found");

    if (TERMINAL_STATUSES.includes(booking.status)) {
      return res.status(400).json({
        status: "FAILED",
        message: `Cannot change a booking with status "${booking.status}".`,
      });
    }
    // Same rule as the customer's customize-requests: once the event day
    // has begun, reopening the booking would block every event-day step.
    if (eventDayStarted(booking)) {
      return res.status(409).json({
        status: "FAILED",
        code: "EVENT_DAY_STARTED",
        message: "The event day has started, so the package can't be changed now.",
      });
    }

    const requests = req.body.changes.map((change) => ({
      changeType: change.changeType,
      itemKind: change.itemKind ?? "Item",
      category: change.category.trim(),
      item: change.item.trim(),
      qty: change.qty ?? 1,
      status: "Pending",
      requestedAt: new Date(),
    }));

    booking.changeRequests.push(...requests);
    booking.lastCustomerActivityAt = new Date();
    // New requests reopen negotiation, a confirmed booking included: it goes
    // back to InDiscussion (keeping confirmedAt, and with it the date — see
    // slotOccupyingFilter) until the customer accepts the next proposal.
    booking.status = "InDiscussion";
    booking.proposalResponse = { status: "ChangesRequested", respondedAt: new Date() };
    await booking.save();

    return res.status(201).json({
      status: "SUCCESS",
      message: `${requests.length} change request(s) submitted`,
      booking: withPricingBreakdown(booking),
    });
  } catch (error) {
    return failed(res, "Failed to submit change requests", error);
  }
};

// Title of the milestone added when a repriced booking is already fully paid.
const REVISED_PRICE_LABEL = "Revised Price Balance";
// Same, for the convenience fee when every instalment is already paid.
const CONVENIENCE_FEE_LABEL = "Convenience Fee";

const PRICING_FIELDS = [
  "basePrice",
  "itemsAdded",
  "substituteItemsAdded",
  "addonsAdded",
  "itemsRemoved",
  "addonsRemoved",
  "additionalCharges",
  "discountAmount",
  "taxRatePct",
];

/**
 * @desc    Apply the vendor's edits to a booking
 * @route   PUT /api/bookings/:bookingId
 * @body    { changeRequests?: [{ id, status?, qty?, vendorNote? }], customizeRequests?: [{ id, status?, vendorNote? }], pricing?, paymentMilestones?: [{ id?, title, amount, ... }], calendarNote? }
 *
 * Everything the vendor changes on the details screen is saved in one call, so
 * a half-applied edit is not reachable: decisions and the price they were
 * agreed at land together or not at all.
 */
export const updateBooking = async (req, res) => {
  try {
    const validation = validateBookingUpdate(req.body);
    if (!validation.valid) return invalid(res, validation.errors);

    const booking = await findBooking(req.params.bookingId);
    if (!booking) return notFound(res, "Booking not found");

    if (TERMINAL_STATUSES.includes(booking.status)) {
      return res.status(400).json({
        status: "FAILED",
        message: `Cannot change a booking with status "${booking.status}".`,
      });
    }

    const {
      changeRequests,
      customizeRequests,
      pricing,
      paymentMilestones,
      calendarNote,
      confirm,
    } = req.body;

    // `confirm` is kept for older clients, but the vendor can only confirm a
    // booking taken as sold — once the customer asked for changes, they
    // confirm by accepting the proposal (see vendorConfirmBlock).
    if (confirm && !PRE_ACCEPTANCE_STATUSES.includes(booking.status)) {
      return res.status(400).json({
        status: "FAILED",
        message: `Cannot confirm a booking with status "${booking.status}".`,
      });
    }

    // Did this save change what the customer is being offered? Only then is
    // it a new proposal round (see proposalVersion below).
    let proposalChanged = false;

    const applyDecision = (request, decision) => {
      if (decision.status !== undefined && decision.status !== request.status) {
        request.status = decision.status;
        request.respondedAt = new Date();
        proposalChanged = true;
      }
      // A note only explains a rejection; it goes with the decision.
      const note =
        request.status === "Rejected"
          ? (decision.vendorNote !== undefined ? decision.vendorNote : request.vendorNote)
          : null;
      const trimmed = typeof note === "string" ? note.trim() || null : null;
      if ((request.vendorNote ?? null) !== trimmed) {
        request.vendorNote = trimmed;
        proposalChanged = true;
      }
    };

    if (Array.isArray(changeRequests)) {
      for (const decision of changeRequests) {
        const request = booking.changeRequests.id(decision.id);
        if (!request) {
          return notFound(res, `Change request "${decision.id}" not found`);
        }
        if (decision.qty !== undefined && decision.qty !== request.qty) {
          request.qty = decision.qty;
          proposalChanged = true;
        }
        applyDecision(request, decision);
      }
    }

    // The vendor's decision on each PDP "Customize items" request. Only the
    // status (and the vendor's note) moves — the request body itself is the
    // customer's and stays as sent. Like changeRequests, deciding one does
    // not reprice anything on its own; the vendor carries the money on the
    // pricing rows below.
    if (Array.isArray(customizeRequests)) {
      for (const decision of customizeRequests) {
        const request = booking.customizeRequests.id(decision.id);
        if (!request) {
          return notFound(res, `Customize request "${decision.id}" not found`);
        }
        applyDecision(request, decision);
      }
    }

    // Read before the plan or the price moves — see unattributedReceived and
    // scheduleExtra.
    const unattributed = unattributedReceived(booking);
    const extra = scheduleExtra(booking, unattributed);
    const previousTotal = booking.totalAmount || 0;
    const previousAdditionalCharges = booking.pricing?.additionalCharges || 0;

    if (pricing) {
      for (const field of PRICING_FIELDS) {
        if (pricing[field] !== undefined) booking.pricing[field] = pricing[field];
      }
      if (pricing.discountLabel !== undefined) {
        booking.pricing.discountLabel =
          pricing.discountLabel?.trim() || "Discount Allowed";
      }
      if (pricing.additionalChargesLabel !== undefined) {
        booking.pricing.additionalChargesLabel =
          pricing.additionalChargesLabel?.trim() || DEFAULT_ADDITIONAL_CHARGES_LABEL;
      }
      booking.pricing.updatedAt = new Date();
    }

    if (Array.isArray(paymentMilestones)) {
      const received = booking.paymentMilestones.filter(
        (m) => m.status === "Received"
      );
      const receivedTitles = received.map((m) => m.title.toLowerCase());
      // Unpaid milestones the client sends back by id keep that id: a
      // customer may be part-way through paying one (a Cashfree order
      // carries the milestone id), and minting a new id would leave that
      // payment with nothing to credit.
      const unpaidById = new Map(
        booking.paymentMilestones
          .filter((m) => m.status !== "Received")
          .map((m) => [String(m._id), m])
      );

      booking.paymentMilestones = [
        ...received.map((m) => m.toObject()),
        ...paymentMilestones
          .filter((m) => !receivedTitles.includes(m.title.trim().toLowerCase()))
          .map((m) => {
            const previous = m.id ? unpaidById.get(String(m.id)) : null;
            return {
              ...(previous ? { _id: previous._id } : {}),
              title: m.title.trim(),
              percentage: m.percentage ?? null,
              amount: m.amount,
              dueDate: m.dueDate ? new Date(m.dueDate) : null,
              status: m.status === "PaymentDue" ? "PaymentDue" : "Pending",
            };
          }),
      ];
      proposalChanged = true;
    }

    if (calendarNote !== undefined) {
      booking.calendarNote = calendarNote || null;
    }

    applyPricingBreakdown(booking);
    const totalDelta = Math.round(((booking.totalAmount || 0) - previousTotal) * 100) / 100;
    if (pricing && totalDelta !== 0) proposalChanged = true;

    // A price change without a new plan: keep the plan adding up to the
    // total by moving the difference onto the final unpaid milestone.
    // Additional charges were always collected that way
    // (utils/additionalCharges.js); every other row now is too, so a booking
    // can no longer read "fully paid" while short of its total.
    // Only when this save sent pricing: a save that only touches, say, the
    // calendar note must never move money around.
    if (pricing && !Array.isArray(paymentMilestones) && booking.paymentMilestones.length) {
      const chargesDelta = additionalChargesDelta(booking, previousAdditionalCharges);
      mergeAdditionalChargesIntoFinal(
        booking,
        totalDelta,
        chargesDelta === totalDelta ? booking.pricing?.additionalChargesLabel : REVISED_PRICE_LABEL
      );
    }

    if (Array.isArray(paymentMilestones)) {
      syncTotalReceived(booking, unattributed);
    }

    // The schedule must account for the whole (possibly just repriced)
    // total. Each instalment is rounded to the rupee, so allow a rupee of
    // drift per milestone.
    // Skipped when the booking carries no price to measure against (a legacy
    // record without a package price would otherwise block every save).
    if (
      Array.isArray(paymentMilestones) &&
      booking.paymentMilestones.length &&
      booking.totalAmount > 0
    ) {
      let scheduled =
        booking.paymentMilestones.reduce((sum, m) => sum + (m.amount || 0), 0) +
        unattributed;
      const tolerance = booking.paymentMilestones.length;
      // A plan made in the vendor's terms (adding up to their total) gets
      // the customer's convenience fee put back on its final instalment.
      if (extra > 0 && Math.abs(scheduled - (booking.totalAmount || 0)) <= tolerance) {
        mergeAdditionalChargesIntoFinal(booking, extra, CONVENIENCE_FEE_LABEL);
        scheduled += extra;
      }
      const drift = Math.abs(scheduled - ((booking.totalAmount || 0) + extra));
      if (drift > tolerance) {
        return invalid(res, [
          unattributed > 0
            ? `payment milestones plus the ${Math.round(unattributed)} already paid add up to ${Math.round(scheduled - extra)} but the booking total is ${Math.round(booking.totalAmount || 0)}`
            : `payment milestones add up to ${Math.round(scheduled - extra)} but the booking total is ${Math.round(booking.totalAmount || 0)}`,
        ]);
      }
    }

    // A changed proposal is a new round. Before acceptance the customer's
    // earlier answer (accepted, or sent more changes) was to the previous
    // round, so clear it and let their Review Proposal screen ask again. A
    // confirmed booking stays confirmed — its version still moves, so an
    // Accept carrying the old version is refused.
    if (proposalChanged) {
      booking.proposalVersion = (booking.proposalVersion || 0) + 1;
      booking.proposalSentAt = new Date();
      if (PRE_ACCEPTANCE_STATUSES.includes(booking.status)) {
        booking.proposalResponse = { status: null, respondedAt: null };
        // Answering the customer's requests starts the negotiation: a booking
        // that arrived with requests reads "New Booking" only until the
        // vendor's first proposal. One without requests has nothing to
        // negotiate — the vendor just accepts it — so it stays as it is.
        if (allRequests(booking).length > 0) booking.status = "InDiscussion";
      }
    }

    if (confirm) {
      const block = vendorConfirmBlock(booking);
      if (block) {
        return res.status(409).json({ status: "FAILED", ...block });
      }

      booking.status = "Confirmed";
      booking.confirmedAt = booking.confirmedAt || new Date();
    }

    await booking.save();

    if (confirm) await syncPackageBooked(booking.packageId, booking.eventDate);

    return res.status(200).json({
      status: "SUCCESS",
      message: confirm ? "Booking confirmed" : "Booking updated",
      booking: withPricingBreakdown(booking),
    });
  } catch (error) {
    return failed(res, "Failed to update booking", error);
  }
};

/**
 * @desc    Mark a confirmed, fully paid booking as completed
 * @route   PUT /api/bookings/:bookingId/complete
 *
 * The vendor closes the booking once the final payment is in. Completed is
 * terminal: the customer sees it under their past bookings and can review
 * it. completedAt is stamped by the Booking save hook.
 */
export const completeBooking = async (req, res) => {
  try {
    const booking = await findBooking(req.params.bookingId);
    if (!booking) return notFound(res, "Booking not found");

    if (booking.status !== "Confirmed") {
      return res.status(400).json({
        status: "FAILED",
        message: `Only a confirmed booking can be completed (this one is ${booking.status}).`,
      });
    }
    const pending = pendingRequestCount(booking);
    if (pending > 0) {
      return res.status(409).json({
        status: "FAILED",
        code: "REQUESTS_PENDING",
        message: `Answer the customer's requests before completing the booking (${pending} still pending).`,
      });
    }
    if (!isFullyPaid(booking)) {
      return res.status(409).json({
        status: "FAILED",
        message: "The booking can be completed once the final payment is received.",
      });
    }

    booking.status = "Completed";
    await booking.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Booking completed",
      booking: withPricingBreakdown(booking),
    });
  } catch (error) {
    return failed(res, "Failed to complete booking", error);
  }
};

/**
 * @desc    Record that the vendor has opened a booking
 * @route   PUT /api/bookings/:bookingId/seen
 *
 * Clears the booking's unread state on the vendor's list, and the first time
 * moves a NewBooking to Viewed.
 */
export const markBookingSeen = async (req, res) => {
  try {
    const booking = await findBooking(req.params.bookingId);
    if (!booking) return notFound(res, "Booking not found");

    const now = new Date();
    booking.vendorSeenAt = now;
    if (booking.status === "NewBooking") {
      booking.status = "Viewed";
      booking.viewedAt = now;
    }
    await booking.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Booking marked as seen",
      booking: withPricingBreakdown(booking),
    });
  } catch (error) {
    return failed(res, "Failed to mark booking as seen", error);
  }
};

/**
 * @desc    Raise an issue about a booking's event, as the vendor
 * @route   POST /api/bookings/:bookingId/issues
 * @body    { category, description }
 */
export const raiseVendorBookingIssue = async (req, res) => {
  try {
    const booking = await findBooking(req.params.bookingId);
    if (!booking) return notFound(res, "Booking not found");

    const result = raiseBookingIssue(booking, req.body ?? {}, "Vendor");
    if (result.error) {
      return res.status(result.code).json({ status: "FAILED", message: result.error });
    }
    await booking.save();

    return res.status(201).json({
      status: "SUCCESS",
      message: "Issue raised",
      issue: result.issue,
      booking: withPricingBreakdown(booking),
    });
  } catch (error) {
    return failed(res, "Failed to raise issue", error);
  }
};

const PERCENT_TOLERANCE = 0.5;

/**
 * @desc    Re-plan the instalments still owed on a booking
 * @route   PUT /api/bookings/:bookingId/payment-milestones
 * @body    { milestones: [{ id?, title, percentage, dueDate }] }
 *
 * Received milestones are money already in hand, so they are kept exactly as
 * stored whatever the request says. The rest are replaced by the request, and
 * their amounts are resolved here rather than trusted from the client: the
 * outstanding balance is split across them in proportion to their shares, so
 * the plan always adds up to the booking total to the rupee.
 */
export const updatePaymentMilestones = async (req, res) => {
  try {
    const validation = validatePaymentMilestonesUpdate(req.body);
    if (!validation.valid) return invalid(res, validation.errors);

    const booking = await findBooking(req.params.bookingId);
    if (!booking) return notFound(res, "Booking not found");

    if (TERMINAL_STATUSES.includes(booking.status)) {
      return res.status(400).json({
        status: "FAILED",
        message: `Cannot change a booking with status "${booking.status}".`,
      });
    }

    const received = booking.paymentMilestones.filter(
      (m) => m.status === "Received"
    );
    const receivedIds = new Set(received.map((m) => String(m._id)));
    const receivedTitles = new Set(received.map((m) => m.title.toLowerCase()));

    const pending = req.body.milestones.filter(
      (m) =>
        !receivedIds.has(String(m.id)) &&
        !receivedTitles.has(m.title.trim().toLowerCase())
    );
    if (!pending.length) {
      return invalid(res, [
        "milestones must include at least one milestone that is not yet received",
      ]);
    }

    const pendingShare = pending.reduce((sum, m) => sum + m.percentage, 0);
    if (pendingShare <= 0) {
      return invalid(res, [
        "the outstanding milestones must carry a share of the total",
      ]);
    }
    if (received.every((m) => typeof m.percentage === "number")) {
      const receivedShare = received.reduce((sum, m) => sum + m.percentage, 0);
      const totalShare = receivedShare + pendingShare;
      if (Math.abs(totalShare - 100) > PERCENT_TOLERANCE) {
        return invalid(res, [
          `milestone percentages must add up to 100 (got ${Math.round(totalShare * 100) / 100})`,
        ]);
      }
    }

    // Payments no milestone accounts for (the checkout token) are already in
    // — see unattributedReceived. The customer's convenience fee stays on
    // the plan — see scheduleExtra.
    const unattributed = unattributedReceived(booking);
    const extra = scheduleExtra(booking, unattributed);
    const receivedAmount = received.reduce((sum, m) => sum + (m.amount || 0), 0);
    const outstanding = Math.max(
      0,
      Math.round((booking.totalAmount || 0) + extra - receivedAmount - unattributed)
    );
    const amounts = pending.map((m) =>
      Math.round((outstanding * m.percentage) / pendingShare)
    );
    amounts[amounts.length - 1] +=
      outstanding - amounts.reduce((sum, a) => sum + a, 0);

    const existing = new Map(
      booking.paymentMilestones.map((m) => [String(m._id), m])
    );
    booking.paymentMilestones = [
      ...received.map((m) => m.toObject()),
      ...pending.map((m, i) => {
        const previous = existing.get(String(m.id));
        return {
          ...(previous ? { _id: previous._id } : {}),
          title: m.title.trim(),
          percentage: m.percentage,
          amount: amounts[i],
          dueDate: new Date(m.dueDate),
          status: "Pending",
        };
      }),
    ];

    syncTotalReceived(booking, unattributed);
    booking.proposalVersion = (booking.proposalVersion || 0) + 1;
    booking.proposalSentAt = new Date();
    await booking.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Payment milestones updated",
      booking: withPricingBreakdown(booking),
    });
  } catch (error) {
    return failed(res, "Failed to update payment milestones", error);
  }
};
