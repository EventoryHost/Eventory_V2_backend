import Booking, {
  PRE_ACCEPTANCE_STATUSES,
  TERMINAL_STATUSES,
} from "../models/Booking.js";
import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";
import CalendarBlock from "../models/CalendarBlock.js";
import { generateISTId } from "../utils/idGenerator.js";
import { snapshotDeliverables } from "../utils/packageDeliverables.js";
import { getEffectivePackagePrice } from "../utils/packagePrice.js";
import {
  applyPricingBreakdown,
  withPricingBreakdown,
} from "../utils/pricingBreakdown.js";
import {
  validateCreateBooking,
  validateChangeRequests,
  validateBookingUpdate,
} from "../validators/bookingValidators.js";

// ─── Constants ──────────────────────────────────────────────

/** Default vendor response window when the caller does not supply one. */
const RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────

/**
 * Look a booking up by either its human-readable bookingId (EVT...) or its
 * MongoDB _id.
 */
const findBooking = async (bookingId) =>
  bookingId.startsWith("EVT")
    ? Booking.findOne({ bookingId })
    : Booking.findById(bookingId);

const notFound = (res, message) =>
  res.status(404).json({ status: "FAILED", message });

const invalid = (res, errors) =>
  res
    .status(400)
    .json({ status: "FAILED", message: "Validation failed", errors });

const failed = (res, message, error) => {
  console.error(`${message}:`, error);
  return res.status(500).json({ status: "ERROR", message, error: error.message });
};

/**
 * Check if a date has conflicts for the vendor (other bookings or calendar blocks).
 * Returns true if conflicting.
 */
const detectConflict = async (vendorId, eventDate, excludeBookingId = null) => {
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
const syncPackageBooked = async (packageId, eventDate) => {
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
 */
const revertPackageAvailability = async (packageId, eventDate) => {
  const pkg = await Package.findById(packageId);
  if (!pkg) return;

  const dateStr = new Date(eventDate).toISOString().split("T")[0];
  const existing = pkg.availabilityCalendar.find((entry) => {
    return new Date(entry.date).toISOString().split("T")[0] === dateStr;
  });

  if (existing) {
    existing.status = "Available";
    await pkg.save();
  }
};

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

const syncTotalReceived = (booking) => {
  booking.totalReceived = booking.paymentMilestones
    .filter((m) => m.status === "Received")
    .reduce((sum, m) => sum + (m.amount || 0), 0);
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
        image: pkg.step4_sampleMedia?.media?.[0]?.url || null,
        vendorType: pkg.vendorType || null,
        variantType: pkg.variantType || "Premium",
        gstRatePercent: pkg.step3_policiesAndCharges?.gstRatePercent ?? null,
        gstInclusive: pkg.step3_policiesAndCharges?.gstInclusive ?? false,
        deliverables: snapshotDeliverables(pkg),
      },
      paymentType: req.body.paymentType,
      status: "NewBooking",
      respondByAt: req.body.respondByAt
        ? new Date(req.body.respondByAt)
        : new Date(Date.now() + RESPONSE_WINDOW_MS),
      pricing: {
        basePrice: req.body.basePrice ?? null,
        taxRatePct:
          req.body.taxRatePct ??
          pkg.step3_policiesAndCharges?.gstRatePercent ??
          undefined,
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

    booking.status = "Confirmed";
    booking.confirmedAt = new Date();
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

    if (booking.status === "Cancelled" || booking.status === "Completed") {
      return res.status(400).json({
        status: "FAILED",
        message: `Cannot cancel booking with status "${booking.status}".`,
      });
    }

    const previousStatus = booking.status;
    booking.status = "Cancelled";
    booking.cancelledAt = new Date();
    booking.cancelledBy =
      req.body?.cancelledBy === "Customer" ? "Customer" : "Vendor";
    booking.cancellationReason = req.body?.reason?.trim() || null;
    await booking.save();

    if (previousStatus === "Confirmed") {
      await revertPackageAvailability(booking.packageId, booking.eventDate);
    }

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
    if (PRE_ACCEPTANCE_STATUSES.includes(booking.status)) {
      booking.status = "InDiscussion";
    }
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

const PRICING_FIELDS = [
  "basePrice",
  "itemsAdded",
  "addonsAdded",
  "itemsRemoved",
  "addonsRemoved",
  "discountAmount",
  "taxRatePct",
];

/**
 * @desc    Apply the vendor's edits to a booking
 * @route   PUT /api/bookings/:bookingId
 * @body    { changeRequests?: [{ id, status?, qty? }], pricing?, paymentMilestones?, calendarNote? }
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

    const { changeRequests, pricing, paymentMilestones, calendarNote } = req.body;

    if (Array.isArray(changeRequests)) {
      for (const decision of changeRequests) {
        const request = booking.changeRequests.id(decision.id);
        if (!request) {
          return notFound(res, `Change request "${decision.id}" not found`);
        }
        if (decision.qty !== undefined) request.qty = decision.qty;
        if (decision.status !== undefined) {
          request.status = decision.status;
          request.respondedAt = new Date();
        }
      }
    }

    if (pricing) {
      for (const field of PRICING_FIELDS) {
        if (pricing[field] !== undefined) booking.pricing[field] = pricing[field];
      }
      if (pricing.discountLabel !== undefined) {
        booking.pricing.discountLabel =
          pricing.discountLabel?.trim() || "Discount Allowed";
      }
      booking.pricing.updatedAt = new Date();
    }

    if (Array.isArray(paymentMilestones)) {
      const received = booking.paymentMilestones.filter(
        (m) => m.status === "Received"
      );
      const receivedTitles = received.map((m) => m.title.toLowerCase());

      booking.paymentMilestones = [
        ...received.map((m) => m.toObject()),
        ...paymentMilestones
          .filter((m) => !receivedTitles.includes(m.title.trim().toLowerCase()))
          .map((m) => ({
            title: m.title.trim(),
            percentage: m.percentage ?? null,
            amount: m.amount,
            dueDate: m.dueDate ? new Date(m.dueDate) : null,
            status: m.status === "PaymentDue" ? "PaymentDue" : "Pending",
          })),
      ];
    }

    if (calendarNote !== undefined) {
      booking.calendarNote = calendarNote || null;
    }

    syncTotalReceived(booking);
    applyPricingBreakdown(booking);
    await booking.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Booking updated",
      booking: withPricingBreakdown(booking),
    });
  } catch (error) {
    return failed(res, "Failed to update booking", error);
  }
};
