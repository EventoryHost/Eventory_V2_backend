import mongoose from "mongoose";
import Booking, { TERMINAL_STATUSES } from "../models/Booking.js";
import Vendor from "../models/Vendor.js"; // For reassignment validation
import Package from "../models/Package.js";
import Customer from "../models/Customer.js";
import Payment from "../models/Payment.js";
import Invoice from "../models/Invoice.js";
import { resolveVendorForPackage, resolveVendorRefId } from "../utils/resolveVendor.js";
import { applyPricingBreakdown, withPricingBreakdown } from "../utils/pricingBreakdown.js";
import { round2 } from "../utils/money.js";
import {
  detectConflict,
  syncPackageBooked,
  revertPackageAvailability,
} from "./bookingController.js";

const SLA_HOURS = 4;
const getSlaThreshold = () => new Date(Date.now() - SLA_HOURS * 60 * 60 * 1000);

// ─── V2 booking helpers (list / detail / full edit) ─────────

// What the admin screens show about a booking's vendor. businessName and
// phone are fine here — this is the internal admin surface, not a
// customer-facing read (see publicFields.js for that whitelist).
const ADMIN_VENDOR_FIELDS = "_id id businessName city phone vendorType isVerified";
const ADMIN_PACKAGE_FIELDS = "_id step1_eventAndCrew.packageName packageStatus variantType vendorType";
const ADMIN_CUSTOMER_FIELDS = "_id id name phone email";

// Strict 24-hex check. mongoose's own isValid() also accepts ANY 12-character
// string, which would send a short public id into an _id query.
const isObjectIdString = (value) =>
  typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);

/**
 * Booking lookup filter for either the human-readable bookingId (EVT...) or
 * the MongoDB _id. null for anything else, so a malformed id is a 404 rather
 * than a CastError 500.
 */
const bookingLookup = (bookingIdParam) => {
  if (bookingIdParam.startsWith("EVT")) return { bookingId: bookingIdParam };
  if (isObjectIdString(bookingIdParam)) return { _id: bookingIdParam };
  return null;
};

const bookingNotFound = (res) =>
  res.status(404).json({ success: false, message: "Booking not found" });

// Express's query parser turns a repeated key into an array — only a plain
// string is ever used as a filter value, so nothing but a string reaches Mongo.
const queryString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Resolves many Booking.vendorId values to their Vendor documents in two
 * queries. Bookings store the vendor's public "VEN..." id, so .populate()
 * (which casts to ObjectId) can't be used — it throws a CastError. Older
 * documents may still hold the Mongo _id instead (see resolveVendor.js), so
 * anything a public-id lookup didn't resolve is retried as an _id.
 * Returns a Map keyed by the raw stored value.
 */
const resolveVendorsByRef = async (rawIds) => {
  const ids = [...new Set(rawIds.filter(Boolean).map(String))];
  const vendorsByRef = new Map();
  if (!ids.length) return vendorsByRef;

  const byPublicId = await Vendor.find({ id: { $in: ids } }).select(ADMIN_VENDOR_FIELDS).lean();
  for (const vendor of byPublicId) vendorsByRef.set(vendor.id, vendor);

  const unresolved = ids.filter((id) => !vendorsByRef.has(id) && isObjectIdString(id));
  if (unresolved.length) {
    const byObjectId = await Vendor.find({ _id: { $in: unresolved } }).select(ADMIN_VENDOR_FIELDS).lean();
    for (const vendor of byObjectId) vendorsByRef.set(String(vendor._id), vendor);
  }
  return vendorsByRef;
};

const toVendorSummary = (vendor) =>
  vendor
    ? {
        _id: vendor._id,
        id: vendor.id ?? null,
        businessName: vendor.businessName ?? null,
        city: vendor.city ?? null,
        phone: vendor.phone ?? null,
        vendorType: vendor.vendorType ?? null,
        isVerified: Boolean(vendor.isVerified),
      }
    : null;

// Package has no top-level name — it lives on step 1 of the package form.
const toPackageSummary = (pkg) =>
  pkg
    ? {
        _id: pkg._id,
        name: pkg.step1_eventAndCrew?.packageName ?? null,
        packageStatus: pkg.packageStatus ?? null,
        variantType: pkg.variantType ?? null,
        vendorType: pkg.vendorType ?? null,
      }
    : null;

/** Adds `vendor` (summary or null) to each lean booking; vendorId stays raw. */
const attachVendors = async (bookings) => {
  const vendorsByRef = await resolveVendorsByRef(bookings.map((b) => b.vendorId));
  return bookings.map((booking) => ({
    ...booking,
    vendor: toVendorSummary(vendorsByRef.get(String(booking.vendorId))),
  }));
};

/**
 * The full admin view of one booking: the booking with its pricing
 * breakdown, plus everything it references resolved alongside it. Used by
 * both GET and PUT /:bookingId so the edit screen can simply replace its
 * state with the PUT response.
 */
const buildBookingDetail = async (booking) => {
  const detail = withPricingBreakdown(booking);

  // Payment.bookingId / Invoice.bookingId hold String(booking._id) (see
  // customerPaymentController.js and invoiceService.js); the human-readable
  // bookingId is matched too in case anything stored that instead. A
  // checkout-time Token payment has no bookingId at all — it lists the
  // booking(s) it created in createdBookingIds.
  const bookingRefs = [String(detail._id), detail.bookingId].filter(Boolean);

  const customerId = detail.customerId ? String(detail.customerId) : null;
  const customerQuery = customerId
    ? isObjectIdString(customerId)
      ? { $or: [{ id: customerId }, { _id: customerId }] }
      : { id: customerId }
    : null;

  const packageId = detail.packageId ? String(detail.packageId) : null;

  const [vendorsByRef, pkg, customerAccount, payments, invoice] = await Promise.all([
    resolveVendorsByRef([detail.vendorId]),
    isObjectIdString(packageId)
      ? Package.findById(packageId).select(ADMIN_PACKAGE_FIELDS).lean()
      : null,
    customerQuery
      ? Customer.findOne(customerQuery).select(ADMIN_CUSTOMER_FIELDS).lean()
      : null,
    Payment.find({
      $or: [
        { bookingId: { $in: bookingRefs } },
        { createdBookingIds: { $in: bookingRefs } },
      ],
    })
      .sort({ createdAt: -1 })
      .lean(),
    Invoice.findOne({ bookingId: { $in: bookingRefs } }).lean(),
  ]);

  return {
    ...detail,
    vendor: toVendorSummary(vendorsByRef.get(String(detail.vendorId))),
    package: toPackageSummary(pkg),
    customerAccount: customerAccount
      ? {
          _id: customerAccount._id,
          id: customerAccount.id ?? null,
          name: customerAccount.name ?? null,
          phone: customerAccount.phone ?? null,
          email: customerAccount.email ?? null,
        }
      : null,
    payments,
    invoice: invoice || null,
  };
};

// GET /api/admin/bookings/exception-queue
export const getExceptionQueue = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const threshold = getSlaThreshold();

    const query = {
      status: "Pending",
      createdAt: { $lt: threshold },
    };

    const bookings = await Booking.find(query)
      .populate("vendorId", "businessName city phone isVerified vendorType")
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Calculate SLA breach minutes for each
    const now = new Date();
    const withSlaData = bookings.map(b => {
      const bObj = b.toObject();
      const breachedMs = now - (new Date(bObj.createdAt).getTime() + (SLA_HOURS * 60 * 60 * 1000));
      bObj.slaBreachedMinutes = Math.floor(breachedMs / 60000);
      return bObj;
    });

    const total = await Booking.countDocuments(query);

    res.status(200).json({
      success: true,
      data: withSlaData,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/bookings/exception-queue/count
export const getExceptionQueueCount = async (req, res) => {
  try {
    const count = await Booking.countDocuments({
      status: "Pending",
      createdAt: { $lt: getSlaThreshold() },
    });
    res.status(200).json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/bookings/pending
export const getAllPending = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const bookings = await Booking.find({ status: "Pending" })
      .populate("vendorId", "businessName city phone isVerified vendorType")
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments({ status: "Pending" });
    
    // Add SLA timer info
    const now = new Date();
    const withSlaData = bookings.map(b => {
      const bObj = b.toObject();
      const slaDeadline = new Date(bObj.createdAt).getTime() + (SLA_HOURS * 60 * 60 * 1000);
      const diffMs = now.getTime() - slaDeadline;
      
      bObj.isSlaBreached = diffMs > 0;
      bObj.slaDiffMinutes = Math.floor(Math.abs(diffMs) / 60000); // Minutes until breach (or since breach)
      
      return bObj;
    });

    res.status(200).json({
      success: true,
      data: withSlaData,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/bookings/:bookingId  (EVT... bookingId or Mongo _id)
// No .populate(): vendorId holds the public "VEN..." id, which fails the
// ObjectId cast populate does — buildBookingDetail resolves it instead.
export const getBookingDetails = async (req, res) => {
  try {
    const filter = bookingLookup(req.params.bookingId);
    const booking = filter && (await Booking.findOne(filter).lean());
    if (!booking) return bookingNotFound(res);

    res.status(200).json({ success: true, data: await buildBookingDetail(booking) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/bookings/:bookingId/reassign
export const reassignBooking = async (req, res) => {
  try {
    const { newVendorId, reason } = req.body;
    
    // Validate new vendor exists
    const vendorQuery = mongoose.Types.ObjectId.isValid(newVendorId)
      ? { $or: [{ _id: newVendorId }, { id: newVendorId }] }
      : { id: newVendorId };
    const newVendor = await Vendor.findOne(vendorQuery);
    if (!newVendor) {
      return res.status(404).json({ success: false, message: "New vendor not found" });
    }

    const booking = await Booking.findByIdAndUpdate(
      req.params.bookingId,
      { 
        vendorId: newVendorId,
        // Reset status if it was declined/cancelled etc? 
        // For now just change vendor, keep status pending if it was pending
      },
      { new: true }
    );
    
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    
    res.status(200).json({ success: true, data: booking, reason });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/bookings/:bookingId/force-accept
export const forceAccept = async (req, res) => {
  try {
    const booking = await Booking.findByIdAndUpdate(
      req.params.bookingId,
      { status: "Accepted" },
      { new: true }
    );
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    res.status(200).json({ success: true, data: booking });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/bookings/stats
export const getStats = async (req, res) => {
  try {
    const threshold = getSlaThreshold();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [
      totalPending,
      slaBreachedCount,
      todaysBookingsCount,
      totalAccepted,
      totalCount
    ] = await Promise.all([
      Booking.countDocuments({ status: "Pending" }),
      Booking.countDocuments({ status: "Pending", createdAt: { $lt: threshold } }),
      Booking.countDocuments({ eventDate: { $gte: todayStart, $lte: todayEnd } }),
      Booking.countDocuments({ status: "Accepted" }),
      Booking.countDocuments({})
    ]);

    const ackRate = totalCount > 0 ? (totalAccepted / totalCount) * 100 : 0;

    res.status(200).json({
      success: true,
      data: {
        totalPending,
        slaBreachedCount,
        todaysBookingsCount,
        totalAccepted,
        totalCount,
        ackRate: ackRate.toFixed(1)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const LIST_SORT_FIELDS = ["createdAt", "eventDate"];

/**
 * Every Booking.vendorId value that can refer to the vendor(s) `raw` names.
 * Always accepts the vendor's public id or its Mongo _id, and matches
 * bookings stored under either form (see resolveVendor.js on why both
 * exist). With `fuzzy`, also any vendor whose businessName or public id
 * contains `raw` (case-insensitive). An unmatched input leaves just `raw`
 * itself, which matches no booking.
 */
const vendorRefsFor = async (raw, { fuzzy = false } = {}) => {
  const refs = new Set([raw]);
  const addVendor = (vendor) => {
    if (vendor.id) refs.add(vendor.id);
    refs.add(String(vendor._id));
  };

  const exact = await resolveVendorForPackage(raw, "_id id");
  if (exact) addVendor(exact);

  if (fuzzy) {
    const rx = { $regex: escapeRegex(raw.slice(0, 100)), $options: "i" };
    const matches = await Vendor.find({ $or: [{ businessName: rx }, { id: rx }] })
      .select("_id id")
      .limit(200)
      .lean();
    matches.forEach(addVendor);
  }
  return [...refs];
};

// GET /api/admin/bookings/all
// ?page&limit&status&paymentType&vendorId&vendor&search&dateFrom&dateTo&sortBy=createdAt|eventDate&sortOrder=asc|desc
// vendorId = exact vendor id; vendor = free text matched against vendor name or id
export const getAllBookings = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const status = queryString(req.query.status);
    const paymentType = queryString(req.query.paymentType);
    const vendorId = queryString(req.query.vendorId);
    const vendorText = queryString(req.query.vendor);
    const search = queryString(req.query.search);
    const dateFrom = queryString(req.query.dateFrom);
    const dateTo = queryString(req.query.dateTo);

    const query = {};
    if (status) query.status = status;
    if (paymentType) query.paymentType = paymentType;

    // Both given → a booking must match both, so intersect the ref sets
    if (vendorId || vendorText) {
      let refs = vendorId ? await vendorRefsFor(vendorId) : null;
      if (vendorText) {
        const textRefs = await vendorRefsFor(vendorText, { fuzzy: true });
        refs = refs ? refs.filter((r) => textRefs.includes(r)) : textRefs;
      }
      query.vendorId = { $in: refs };
    }

    if (search) {
      const rx = { $regex: escapeRegex(search.slice(0, 100)), $options: "i" };
      query.$or = [
        { bookingId: rx },
        { "customer.name": rx },
        { "customer.phone": rx },
        { "customer.email": rx },
      ];
    }

    // Inclusive on both ends: dateFrom from the start of its (UTC) day,
    // dateTo to the end of its day — the same day boundaries detectConflict
    // uses for eventDate.
    if (dateFrom || dateTo) {
      query.eventDate = {};
      if (dateFrom) {
        const from = new Date(dateFrom);
        if (Number.isNaN(from.getTime())) {
          return res.status(400).json({ success: false, message: "dateFrom must be a valid date" });
        }
        from.setUTCHours(0, 0, 0, 0);
        query.eventDate.$gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        if (Number.isNaN(to.getTime())) {
          return res.status(400).json({ success: false, message: "dateTo must be a valid date" });
        }
        to.setUTCHours(23, 59, 59, 999);
        query.eventDate.$lte = to;
      }
    }

    const sortBy = LIST_SORT_FIELDS.includes(req.query.sortBy) ? req.query.sortBy : "createdAt";
    const sortDirection = req.query.sortOrder === "asc" ? 1 : -1;

    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .sort({ [sortBy]: sortDirection, _id: sortDirection })
        .skip(skip)
        .limit(limit)
        .lean(),
      Booking.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: await attachVendors(bookings),
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/bookings/today
export const getTodaysBookings = async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const bookings = await Booking.find({
      eventDate: { $gte: todayStart, $lte: todayEnd }
    }).populate("vendorId", "businessName city");

    res.status(200).json({ success: true, data: bookings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/bookings/:bookingId/assign-em
// Body: { emId, emName }
export const assignEmToBooking = async (req, res) => {
  try {
    const { emId, emName } = req.body;
    const isObjectId = mongoose.isValidObjectId(req.params.bookingId);
    const filter = isObjectId
      ? { $or: [{ bookingId: req.params.bookingId }, { _id: req.params.bookingId }] }
      : { bookingId: req.params.bookingId };

    const booking = await Booking.findOneAndUpdate(
      filter,
      { assignedEmId: emId || null, assignedEmName: emName || null },
      { new: true }
    );
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

    res.status(200).json({ success: true, data: booking });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── PUT /api/admin/bookings/:bookingId — full admin edit ───

// Booking fields a body key is written straight onto (after the Zod schema
// in adminBookingValidators.js has shaped it). Everything else in the body
// has its own handling below.
const DIRECT_FIELDS = [
  "customerId",
  "eventType",
  "eventDate",
  "startTime",
  "endTime",
  "location",
  "mapLink",
  "status",
  "respondByAt",
  "confirmedAt",
  "declinedAt",
  "cancelledAt",
  "declineReason",
  "cancellationReason",
  "cancelledBy",
  "paymentType",
  "convenienceFee",
  "convenienceFeeBreakdown",
  "selectedAddOns",
  "notes",
  "eventNote",
  "calendarNote",
  "noteAttachments",
  "assignedEmId",
  "assignedEmName",
  "vendorDeleted",
];

// Nested (non-subdocument) paths merged key by key, so sending
// { customer: { phone } } leaves customer.name alone.
const MERGED_FIELDS = ["customer", "eventTiming", "guestRange"];

// The trail timestamp a status change stamps when the admin didn't send one.
const STATUS_TIMESTAMPS = {
  Confirmed: "confirmedAt",
  Declined: "declinedAt",
  Cancelled: "cancelledAt",
};

const definedEntries = (obj) =>
  Object.entries(obj).filter(([, value]) => value !== undefined);

/**
 * Full replace of an _id-bearing subdocument array: the body's array becomes
 * the stored one (entries left out are removed, order is the body's). An
 * entry whose _id matches a stored subdocument starts from that
 * subdocument, so a key the body omits keeps its stored value instead of
 * resetting to the schema default (e.g. a change request's requestedAt).
 * `finalize(next, previous, entry)` fills derived fields.
 */
const replaceSubdocs = (current, incoming, finalize) =>
  incoming.map((entry) => {
    const existing = entry._id && current ? current.id(entry._id) : null;
    const previous = existing ? existing.toObject() : null;
    const next = { ...(previous || {}), ...Object.fromEntries(definedEntries(entry)) };
    return finalize ? finalize(next, previous, entry) : next;
  });

const sameTime = (a, b) => new Date(a).getTime() === new Date(b).getTime();

const saveValidationFailed = (res, error) =>
  res.status(400).json({
    success: false,
    message: "Validation failed",
    errors:
      error instanceof mongoose.Error.ValidationError
        ? Object.values(error.errors).map((e) => ({ field: e.path, message: e.message }))
        : [{ field: error.path, message: error.message }],
  });

/**
 * Keeps the package's availabilityCalendar in step with the booking's
 * Confirmed state, using the same helpers the vendor accept/cancel flows
 * use. Runs after the booking is saved. Returns a message per step that
 * failed (empty when all went through).
 */
const syncPackageCalendar = async (before, booking) => {
  const wasConfirmed = before.status === "Confirmed";
  const isConfirmed = booking.status === "Confirmed";
  const slotMoved =
    String(before.packageId) !== String(booking.packageId) ||
    !sameTime(before.eventDate, booking.eventDate);

  // Package.findById would throw a CastError on a non-ObjectId packageId.
  const revert = () =>
    isObjectIdString(String(before.packageId))
      ? revertPackageAvailability(before.packageId, before.eventDate)
      : null;
  const book = () =>
    isObjectIdString(String(booking.packageId))
      ? syncPackageBooked(booking.packageId, booking.eventDate)
      : null;

  const steps = [];
  if (wasConfirmed && !isConfirmed) {
    steps.push(["release the old date", revert]);
  } else if (!wasConfirmed && isConfirmed) {
    steps.push(["book the new date", book]);
  } else if (wasConfirmed && isConfirmed && slotMoved) {
    steps.push(["release the old date", revert], ["book the new date", book]);
  }

  // One after the other (both may save the same package), and each is
  // attempted even if an earlier one failed — a failed release must not
  // leave the new date open for customers to book.
  const failures = [];
  for (const [label, step] of steps) {
    try {
      await step();
    } catch (error) {
      console.error(`[adminBookingController.updateBooking] package calendar: could not ${label}:`, error);
      failures.push(`could not ${label} (${error.message})`);
    }
  }
  return failures;
};

/**
 * @desc    Admin edit with full control over a booking's data
 * @route   PUT /api/admin/bookings/:bookingId   (EVT... bookingId or Mongo _id)
 * @body    see adminUpdateBookingSchema — every key optional, only keys sent are applied
 *
 * Unlike the vendor's updateBooking, nothing here is gated on status: the
 * admin can move a booking to any status, including out of a terminal one.
 * Guards kept: the vendor/package must exist, a vendor date conflict needs
 * an explicit allowConflict, and the model's own validators run on save.
 */
export const updateBooking = async (req, res) => {
  try {
    const filter = bookingLookup(req.params.bookingId);
    const booking = filter && (await Booking.findOne(filter));
    if (!booking) return bookingNotFound(res);

    const body = req.body;
    const before = {
      status: booking.status,
      vendorId: booking.vendorId,
      packageId: booking.packageId,
      eventDate: booking.eventDate ? new Date(booking.eventDate) : null,
    };

    // Resending the stored vendorId/packageId is a no-op, not a re-check: a
    // booking can outlive its vendor (purgeVendor keeps bookings) or its
    // package variant (hard deletes), and that must not block the rest of
    // the edit.
    if (body.vendorId !== undefined && body.vendorId !== String(booking.vendorId ?? "")) {
      const vendorRef = await resolveVendorRefId(body.vendorId);
      if (!vendorRef) {
        return res.status(404).json({ success: false, message: "Vendor not found" });
      }
      booking.vendorId = String(vendorRef);
    }

    if (body.packageId !== undefined && body.packageId !== String(booking.packageId ?? "")) {
      const pkg = isObjectIdString(body.packageId)
        ? await Package.findById(body.packageId).select("_id").lean()
        : null;
      if (!pkg) {
        return res.status(404).json({ success: false, message: "Package not found" });
      }
      booking.packageId = String(pkg._id);
    }

    for (const field of DIRECT_FIELDS) {
      if (body[field] !== undefined) booking.set(field, body[field]);
    }

    for (const parent of MERGED_FIELDS) {
      if (!body[parent]) continue;
      for (const [key, value] of definedEntries(body[parent])) {
        booking.set(`${parent}.${key}`, value);
      }
    }

    // The Zod refine only sees the body; a partial guestRange is merged into
    // the stored one, so the combined range is checked here.
    if (body.guestRange) {
      const { min, max } = booking.guestRange || {};
      if (min != null && max != null && min > max) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: [
            {
              field: body.guestRange.min !== undefined ? "guestRange.min" : "guestRange.max",
              message: "guestRange.min cannot be greater than guestRange.max",
            },
          ],
        });
      }
    }

    if (body.pricing && !booking.pricing) booking.pricing = {};

    // A booking stored without pricing.taxRatePct hydrates it to the schema
    // default (0), which drops the packageSnapshot GST fallback the lean GET
    // prices with — pin the rate GET showed, so this edit (whatever it
    // touches) doesn't re-price the booking without tax.
    if (booking.pricing?.$isDefault("taxRatePct") && booking.packageSnapshot?.gstRatePercent != null) {
      booking.pricing.taxRatePct = booking.packageSnapshot.gstRatePercent;
    }

    if (body.pricing) {
      const pricingBefore = JSON.stringify(booking.pricing);
      for (const [key, value] of definedEntries(body.pricing)) {
        booking.set(`pricing.${key}`, value);
      }
      // Same fallbacks as the vendor's updateBooking — a cleared label goes
      // back to the default rather than rendering an empty breakdown row.
      if (body.pricing.discountLabel !== undefined) {
        booking.pricing.discountLabel = body.pricing.discountLabel || "Discount Allowed";
      }
      if (body.pricing.taxLabel !== undefined) {
        booking.pricing.taxLabel = body.pricing.taxLabel || "GST";
      }
      // Stamped only when a value actually moved, so resending the stored
      // pricing doesn't read as the booking having been re-priced.
      if (JSON.stringify(booking.pricing) !== pricingBefore) {
        booking.pricing.updatedAt = new Date();
      }
    }

    if (Array.isArray(body.paymentMilestones)) {
      booking.paymentMilestones = replaceSubdocs(
        booking.paymentMilestones,
        body.paymentMilestones,
        (next, previous, entry) => {
          // Stamp a milestone that becomes Received; clear the date on one
          // moved off Received, as a full replace would.
          if (entry.receivedDate === undefined) {
            if (next.status !== "Received") next.receivedDate = null;
            else if (!next.receivedDate) next.receivedDate = new Date();
          }
          return next;
        }
      );
    }

    if (Array.isArray(body.changeRequests)) {
      booking.changeRequests = replaceSubdocs(
        booking.changeRequests,
        body.changeRequests,
        (next, previous, entry) => {
          // A decision the admin makes here is stamped like the vendor's own.
          const decided =
            entry.status !== undefined && entry.status !== (previous?.status ?? "Pending");
          if (decided && entry.respondedAt === undefined) {
            next.respondedAt = entry.status === "Pending" ? null : new Date();
          }
          return next;
        }
      );
    }

    if (Array.isArray(body.customizeRequests)) {
      booking.customizeRequests = replaceSubdocs(booking.customizeRequests, body.customizeRequests);
    }

    if (booking.status !== before.status) {
      const stampField = STATUS_TIMESTAMPS[booking.status];
      if (stampField && body[stampField] === undefined && !booking[stampField]) {
        booking[stampField] = new Date();
      }
    }

    // Checked BEFORE saving. A date/vendor move can land on a taken day, and
    // so can reviving a Declined/Cancelled/Completed booking. A booking that
    // ends up terminal can't conflict with anything, so it skips the check.
    const vendorChanged = String(booking.vendorId) !== String(before.vendorId);
    const dateChanged = !sameTime(booking.eventDate, before.eventDate);
    const revived =
      TERMINAL_STATUSES.includes(before.status) && !TERMINAL_STATUSES.includes(booking.status);
    if (
      (vendorChanged || dateChanged || revived) &&
      !TERMINAL_STATUSES.includes(booking.status) &&
      body.allowConflict !== true
    ) {
      const conflict = await detectConflict(booking.vendorId, booking.eventDate, booking._id);
      if (conflict) {
        return res.status(409).json({
          success: false,
          conflict: true,
          message: "Vendor already has a booking or calendar block on this date",
        });
      }
    }

    // totalReceived: an explicit value wins. Otherwise it is re-derived from
    // the Received milestones, but only when the milestones were part of
    // this edit — a checkout booking's token can be counted in
    // totalReceived without a matching Received milestone (see
    // bookingCreationService.js's mapMilestonesToBookingSchema), and an
    // unrelated edit must not silently zero it. Any totalReceived in the
    // body is an override, so a client sends it only when the admin set it.
    if (body.totalReceived !== undefined) {
      booking.totalReceived = body.totalReceived;
    } else if (Array.isArray(body.paymentMilestones)) {
      booking.totalReceived = round2(
        booking.paymentMilestones
          .filter((m) => m.status === "Received")
          .reduce((sum, m) => sum + (m.amount || 0), 0)
      );
    }

    applyPricingBreakdown(booking);

    try {
      await booking.save();
    } catch (error) {
      if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
        return saveValidationFailed(res, error);
      }
      throw error;
    }

    // The booking is saved at this point, so a calendar sync failure is
    // reported alongside the saved booking rather than as a failed edit.
    const calendarFailures = await syncPackageCalendar(before, booking);
    const warning = calendarFailures.length
      ? `Booking saved, but the package calendar could not be updated: ${calendarFailures.join("; ")}`
      : undefined;

    res.status(200).json({
      success: true,
      data: await buildBookingDetail(booking),
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
