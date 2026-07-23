import Booking from "../models/Booking.js";
import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";
import Transaction from "../models/Transaction.js";
import CalendarBlock from "../models/CalendarBlock.js";
import { generateISTId } from "../utils/idGenerator.js";
import {
  validateCreateBooking,
  validateMilestoneUpdate,
  validateCustomizePackage,
} from "../validators/bookingValidators.js";

// ─── Helpers ────────────────────────────────────────────────

/**
 * Resolve a human-readable vendor ID (e.g. "VEN...") to a MongoDB ObjectId.
 */
const resolveVendorId = async (vendorId) => {
  if (typeof vendorId === "string" && vendorId.startsWith("VEN")) {
    const vendorDoc = await Vendor.findOne({ id: vendorId }).select('_id');
    if (!vendorDoc) return null;
    return vendorDoc._id;
  }
  return vendorId;
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

  // Check for other accepted bookings on the same date
  const bookingQuery = {
    vendorId,
    eventDate: { $gte: dateStart, $lte: dateEnd },
    status: { $in: ["Pending", "Accepted"] },
  };
  if (excludeBookingId) {
    bookingQuery._id = { $ne: excludeBookingId };
  }
  const otherBooking = await Booking.findOne(bookingQuery);

  // Check for calendar blocks (OfflineBooking or Holiday)
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

// ─── Controllers ────────────────────────────────────────────

/**
 * @desc    Create a new booking
 * @route   POST /api/bookings/vendor/:vendorId
 */
export const createBooking = async (req, res) => {
  try {
    const { vendorId } = req.params;

    const validation = validateCreateBooking(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        status: "FAILED",
        message: "Validation failed",
        errors: validation.errors,
      });
    }

    const actualVendorId = await resolveVendorId(vendorId);
    if (!actualVendorId) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Vendor not found" });
    }

    // Fetch and snapshot the package
    const pkg = await Package.findById(req.body.packageId);
    if (!pkg) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Package not found" });
    }

    const conflictDetected = await detectConflict(
      actualVendorId,
      req.body.eventDate
    );

    const booking = new Booking({
      bookingId: generateISTId("EVT"),
      vendorId: actualVendorId,
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
        price: pkg.step3_policiesAndCharges?.packagePricing?.price || 0,
        image: pkg.step4_sampleMedia?.media?.[0]?.url || null,
        vendorType: pkg.vendorType || null,
        variantType: pkg.variantType || "Premium",
      },
      paymentType: req.body.paymentType,
      status: "Pending",
      paymentMilestones: req.body.paymentMilestones || [],
      charges: req.body.charges || [],
      totalAmount: req.body.totalAmount || pkg.step3_policiesAndCharges?.packagePricing?.price || 0,
      totalReceived: 0,
      notes: req.body.notes || null,
      calendarNote: req.body.calendarNote || null,
    });

    await booking.save();

    return res.status(201).json({
      status: "SUCCESS",
      message: "Booking created",
      booking,
      conflictDetected,
    });
  } catch (error) {
    console.error("Create Booking Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to create booking",
      error: error.message,
    });
  }
};

/**
 * @desc    Get vendor bookings (filtered, paginated)
 * @route   GET /api/bookings/vendor/:vendorId?status=Pending&page=1&limit=20
 */
export const getVendorBookings = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { status, startDate, endDate, page = 1, limit = 20 } = req.query;

    const actualVendorId = await resolveVendorId(vendorId);
    if (!actualVendorId) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Vendor not found" });
    }

    const query = { vendorId: actualVendorId };
    if (status) query.status = status;
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

    // Annotate each booking with conflict detection
    for (const booking of bookings) {
      booking.conflictDetected = await detectConflict(
        actualVendorId,
        booking.eventDate,
        booking._id
      );
    }

    return res.status(200).json({
      status: "SUCCESS",
      count: bookings.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      bookings,
    });
  } catch (error) {
    console.error("Get Vendor Bookings Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch vendor bookings",
      error: error.message,
    });
  }
};

/**
 * @desc    Get a single booking by ID
 * @route   GET /api/bookings/:bookingId
 */
export const getBookingById = async (req, res) => {
  try {
    const { bookingId } = req.params;

    // Support both MongoDB _id and human-readable bookingId
    let booking;
    if (bookingId.startsWith("EVT")) {
      booking = await Booking.findOne({ bookingId });
    } else {
      booking = await Booking.findById(bookingId);
    }

    if (!booking) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Booking not found" });
    }

    const conflictDetected = await detectConflict(
      booking.vendorId,
      booking.eventDate,
      booking._id
    );

    return res.status(200).json({
      status: "SUCCESS",
      booking,
      conflictDetected,
    });
  } catch (error) {
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch booking",
      error: error.message,
    });
  }
};

/**
 * @desc    Accept a booking
 * @route   PUT /api/bookings/:bookingId/accept
 */
export const acceptBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;

    let booking;
    if (bookingId.startsWith("EVT")) {
      booking = await Booking.findOne({ bookingId });
    } else {
      booking = await Booking.findById(bookingId);
    }

    if (!booking) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Booking not found" });
    }

    if (booking.status !== "Pending") {
      return res.status(400).json({
        status: "FAILED",
        message: `Cannot accept booking with status "${booking.status}". Only Pending bookings can be accepted.`,
      });
    }

    booking.status = "Accepted";
    await booking.save();

    // Sync package availability to "Booked"
    await syncPackageBooked(booking.packageId, booking.eventDate);

    return res.status(200).json({
      status: "SUCCESS",
      message: "Booking accepted",
      booking,
    });
  } catch (error) {
    console.error("Accept Booking Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to accept booking",
      error: error.message,
    });
  }
};

/**
 * @desc    Decline a booking
 * @route   PUT /api/bookings/:bookingId/decline
 */
export const declineBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;

    let booking;
    if (bookingId.startsWith("EVT")) {
      booking = await Booking.findOne({ bookingId });
    } else {
      booking = await Booking.findById(bookingId);
    }

    if (!booking) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Booking not found" });
    }

    if (booking.status !== "Pending") {
      return res.status(400).json({
        status: "FAILED",
        message: `Cannot decline booking with status "${booking.status}". Only Pending bookings can be declined.`,
      });
    }

    booking.status = "Declined";
    await booking.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Booking declined",
      booking,
    });
  } catch (error) {
    console.error("Decline Booking Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to decline booking",
      error: error.message,
    });
  }
};

/**
 * @desc    Cancel a booking
 * @route   PUT /api/bookings/:bookingId/cancel
 */
export const cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;

    let booking;
    if (bookingId.startsWith("EVT")) {
      booking = await Booking.findOne({ bookingId });
    } else {
      booking = await Booking.findById(bookingId);
    }

    if (!booking) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Booking not found" });
    }

    if (booking.status === "Cancelled" || booking.status === "Completed") {
      return res.status(400).json({
        status: "FAILED",
        message: `Cannot cancel booking with status "${booking.status}".`,
      });
    }

    const previousStatus = booking.status;
    booking.status = "Cancelled";
    await booking.save();

    // Revert package availability if it was accepted
    if (previousStatus === "Accepted") {
      await revertPackageAvailability(booking.packageId, booking.eventDate);
    }

    return res.status(200).json({
      status: "SUCCESS",
      message: "Booking cancelled",
      booking,
    });
  } catch (error) {
    console.error("Cancel Booking Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to cancel booking",
      error: error.message,
    });
  }
};

/**
 * @desc    Update a payment milestone status
 * @route   PUT /api/bookings/:bookingId/milestone
 * @body    { milestoneType: "Token", status: "Received" }
 */
export const updateMilestoneStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { milestoneType, status: newStatus } = req.body;

    const validation = validateMilestoneUpdate(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        status: "FAILED",
        message: "Validation failed",
        errors: validation.errors,
      });
    }

    let booking;
    if (bookingId.startsWith("EVT")) {
      booking = await Booking.findOne({ bookingId });
    } else {
      booking = await Booking.findById(bookingId);
    }

    if (!booking) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Booking not found" });
    }

    // Find the milestone
    const milestone = booking.paymentMilestones.find(
      (m) => m.type === milestoneType
    );
    if (!milestone) {
      return res.status(404).json({
        status: "FAILED",
        message: `Milestone "${milestoneType}" not found in this booking`,
      });
    }

    const previousStatus = milestone.status;
    milestone.status = newStatus;

    if (newStatus === "Received" && !milestone.receivedDate) {
      milestone.receivedDate = new Date();
    }

    // Recalculate totalReceived
    booking.totalReceived = booking.paymentMilestones
      .filter((m) => m.status === "Received")
      .reduce((sum, m) => sum + (m.amount || 0), 0);

    await booking.save();

    // Create/update Transaction record when marking as Received
    if (newStatus === "Received" && previousStatus !== "Received") {
      const transaction = new Transaction({
        transactionId: generateISTId("TXN"),
        vendorId: booking.vendorId,
        bookingId: booking._id,
        customerName: booking.customer.name,
        eventDate: booking.eventDate,
        milestoneType,
        amount: milestone.amount,
        status: "Received",
        receivedDate: milestone.receivedDate,
      });
      await transaction.save();
    }

    return res.status(200).json({
      status: "SUCCESS",
      message: `Milestone "${milestoneType}" updated to "${newStatus}"`,
      booking,
    });
  } catch (error) {
    console.error("Update Milestone Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to update milestone",
      error: error.message,
    });
  }
};

/**
 * @desc    Save/update the vendor's calendar note on a booking
 * @route   PUT /api/bookings/:bookingId/note
 * @body    { calendarNote: "Bring backup generator" }
 */
export const updateCalendarNote = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { calendarNote } = req.body;

    if (calendarNote === undefined) {
      return res.status(400).json({
        status: "FAILED",
        message: "calendarNote is required",
      });
    }

    let booking;
    if (bookingId.startsWith("EVT")) {
      booking = await Booking.findOne({ bookingId });
    } else {
      booking = await Booking.findById(bookingId);
    }

    if (!booking) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Booking not found" });
    }

    booking.calendarNote = calendarNote || null;
    await booking.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Calendar note saved",
      booking,
    });
  } catch (error) {
    console.error("Update Calendar Note Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to save calendar note",
      error: error.message,
    });
  }
};

/**
 * @desc    Customize the package for a specific booking (vendor-only, booking-scoped)
 * @route   PUT /api/bookings/:bookingId/customize
 * @body    { packageName?, basePrice?, billingUnit?, lineItems?:[{label,amount,qty?,type?}], notes? }
 *
 * Does NOT touch the original Package document. Writes only to booking.customizedPackage.
 * Also syncs booking.charges[] and booking.totalAmount from the lineItems so that the
 * "Payment Details" section in the app displays real data.
 */
export const customizeBookingPackage = async (req, res) => {
  try {
    const { bookingId } = req.params;

    let booking;
    if (bookingId.startsWith("EVT")) {
      booking = await Booking.findOne({ bookingId });
    } else {
      booking = await Booking.findById(bookingId);
    }

    if (!booking) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Booking not found" });
    }

    if (booking.status !== "Accepted") {
      return res.status(400).json({
        status: "FAILED",
        message: `Cannot customize a booking with status "${booking.status}". Only Accepted bookings can be customized.`,
      });
    }

    const validation = validateCustomizePackage(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        status: "FAILED",
        message: "Validation failed",
        errors: validation.errors,
      });
    }

    const lineItems = (req.body.lineItems || []).map((item) => ({
      label: item.label,
      amount: item.amount,
      qty: item.qty ?? 1,
      type: item.type ?? "Addon",
    }));

    const totalAmount = lineItems.reduce(
      (sum, item) => sum + item.amount * item.qty,
      0
    );

    booking.customizedPackage = {
      packageName: req.body.packageName ?? booking.customizedPackage?.packageName ?? null,
      basePrice: req.body.basePrice ?? booking.customizedPackage?.basePrice ?? null,
      billingUnit: req.body.billingUnit ?? booking.customizedPackage?.billingUnit ?? "Per Event",
      lineItems,
      totalAmount,
      notes: req.body.notes ?? null,
      customizedAt: new Date(),
    };

    // Sync charges[] so Payment Details widget gets real itemized data
    booking.charges = lineItems.map((item) => ({
      label: item.label,
      amount: item.amount * item.qty,
      type: item.type === "Addon" ? "Fee" : item.type,
    }));

    booking.totalAmount = totalAmount;

    await booking.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Package customized successfully",
      booking,
    });
  } catch (error) {
    console.error("Customize Booking Package Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to customize package",
      error: error.message,
    });
  }
};
