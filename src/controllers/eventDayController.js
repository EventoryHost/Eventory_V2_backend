import mongoose from "mongoose";
import Booking, { eventStartOf, isEventDay, isFullyPaid } from "../models/Booking.js";
import { withPricingBreakdown } from "../utils/pricingBreakdown.js";
import { GROUND_CODE_PATTERN, generateGroundCode } from "../utils/groundLink.js";
import {
  validateDayRequestUpdate,
  validateGroundContact,
  validateSetupPhotos,
} from "../validators/eventDayValidators.js";
import { failed, findBooking, invalid, notFound } from "./bookingController.js";

/**
 * The vendor's event-day flow on a Confirmed booking — check in, prove the
 * setup, ask for the balance, clear the venue — plus the on-ground contact
 * and the vendor's answers to the customer's day requests. See the "Event
 * day" section of models/Booking.js for the fields each step stamps.
 *
 * Every vendor action answers like completeBooking: 200 with the updated
 * booking, 400 for a bad body or a booking that isn't Confirmed, 409 for a
 * step taken out of order.
 */

// ─── Helpers ────────────────────────────────────────────────

const rejected = (res, code, message) =>
  res.status(code).json({ status: "FAILED", message });

/**
 * Loads the booking and applies the guard every event-day action shares (the
 * booking is Confirmed). Returns the booking, or null once it has answered
 * the request itself.
 */
const loadConfirmedBooking = async (req, res) => {
  const { bookingId } = req.params;
  // findBooking would throw a CastError (a 500) on a malformed _id.
  if (!bookingId.startsWith("EVT") && !mongoose.isValidObjectId(bookingId)) {
    notFound(res, "Booking not found");
    return null;
  }
  const booking = await findBooking(bookingId);
  if (!booking) {
    notFound(res, "Booking not found");
    return null;
  }
  if (booking.status !== "Confirmed") {
    rejected(
      res,
      400,
      `Event-day actions are only available on a confirmed booking (this one is ${booking.status}).`
    );
    return null;
  }
  return booking;
};

const CHECK_IN_FIRST = "Check in first.";

const saveAndRespond = async (res, booking, message) => {
  await booking.save();
  return res.status(200).json({
    status: "SUCCESS",
    message,
    booking: withPricingBreakdown(booking),
  });
};

// ─── Vendor steps ───────────────────────────────────────────

/**
 * @desc    The vendor has arrived at the venue
 * @route   POST /api/bookings/:bookingId/event-day/check-in
 */
export const checkIn = async (req, res) => {
  try {
    const booking = await loadConfirmedBooking(req, res);
    if (!booking) return;

    const now = new Date();
    if (booking.checkedInAt) return rejected(res, 409, "Already checked in.");
    if (!isEventDay(booking, now)) {
      return rejected(res, 409, "Check-in opens on the event day.");
    }

    booking.checkedInAt = now;
    return await saveAndRespond(res, booking, "Checked in");
  } catch (error) {
    return failed(res, "Failed to check in", error);
  }
};

/**
 * @desc    Submit proof-of-setup photos, which marks setup done
 * @route   POST /api/bookings/:bookingId/event-day/setup
 * @body    { photos: [url] } — 1 to MAX_SETUP_PHOTOS uploaded http(s) URLs
 *
 * Submitting again replaces the photos and re-stamps setupCompletedAt.
 */
export const completeSetup = async (req, res) => {
  try {
    const validation = validateSetupPhotos(req.body);
    if (!validation.valid) return invalid(res, validation.errors);

    const booking = await loadConfirmedBooking(req, res);
    if (!booking) return;
    if (!booking.checkedInAt) return rejected(res, 409, CHECK_IN_FIRST);

    booking.setupPhotos = validation.value.photos;
    booking.setupCompletedAt = new Date();
    return await saveAndRespond(res, booking, "Setup completed");
  } catch (error) {
    return failed(res, "Failed to complete setup", error);
  }
};

/**
 * @desc    Ask the customer for the balance
 * @route   POST /api/bookings/:bookingId/event-day/payment-request
 *
 * Only stamps the booking — no SMS/push system exists, so the app shares
 * the ask itself. Asking again refreshes paymentRequestedAt.
 */
export const requestPayment = async (req, res) => {
  try {
    const booking = await loadConfirmedBooking(req, res);
    if (!booking) return;
    if (!booking.checkedInAt) return rejected(res, 409, CHECK_IN_FIRST);
    if (isFullyPaid(booking)) {
      return rejected(res, 409, "This booking is already fully paid.");
    }

    booking.paymentRequestedAt = new Date();
    return await saveAndRespond(res, booking, "Payment requested");
  } catch (error) {
    return failed(res, "Failed to request payment", error);
  }
};

/**
 * @desc    "Collect later" — the vendor puts off asking for the balance
 * @route   POST /api/bookings/:bookingId/event-day/payment-defer
 */
export const deferPayment = async (req, res) => {
  try {
    const booking = await loadConfirmedBooking(req, res);
    if (!booking) return;
    if (!booking.checkedInAt) return rejected(res, 409, CHECK_IN_FIRST);

    booking.paymentDeferredAt = new Date();
    return await saveAndRespond(res, booking, "Payment collection deferred");
  } catch (error) {
    return failed(res, "Failed to defer payment", error);
  }
};

/**
 * @desc    The venue has been cleared
 * @route   POST /api/bookings/:bookingId/event-day/teardown
 *
 * Needs setup done, and can't come before the event has started (the slot's
 * start, or the event day's IST midnight when no slot was booked).
 */
export const completeTeardown = async (req, res) => {
  try {
    const booking = await loadConfirmedBooking(req, res);
    if (!booking) return;
    if (!booking.checkedInAt) return rejected(res, 409, CHECK_IN_FIRST);
    if (!booking.setupCompletedAt) return rejected(res, 409, "Complete setup first.");

    const now = new Date();
    const start = eventStartOf(booking);
    if (start && now < start) {
      return rejected(res, 409, "Teardown is available once the event has started.");
    }

    booking.teardownCompletedAt = now;
    return await saveAndRespond(res, booking, "Teardown completed");
  } catch (error) {
    return failed(res, "Failed to complete teardown", error);
  }
};

// ─── Ground contact ─────────────────────────────────────────

/**
 * @desc    Assign (or replace) the on-ground contact
 * @route   PUT /api/bookings/:bookingId/event-day/ground-contact
 * @body    { name, phone }
 *
 * Always mints a fresh code, so replacing the contact retires the old link.
 */
export const setGroundContact = async (req, res) => {
  try {
    const validation = validateGroundContact(req.body);
    if (!validation.valid) return invalid(res, validation.errors);

    const booking = await loadConfirmedBooking(req, res);
    if (!booking) return;

    booking.groundStaff = {
      ...validation.value,
      code: generateGroundCode(),
      assignedAt: new Date(),
    };
    return await saveAndRespond(res, booking, "Ground contact assigned");
  } catch (error) {
    return failed(res, "Failed to assign ground contact", error);
  }
};

/**
 * @desc    Remove the on-ground contact; their link stops working
 * @route   DELETE /api/bookings/:bookingId/event-day/ground-contact
 */
export const removeGroundContact = async (req, res) => {
  try {
    const booking = await loadConfirmedBooking(req, res);
    if (!booking) return;

    booking.groundStaff = null;
    return await saveAndRespond(res, booking, "Ground contact removed");
  } catch (error) {
    return failed(res, "Failed to remove ground contact", error);
  }
};

// ─── Day requests ───────────────────────────────────────────

/**
 * @desc    Answer one of the customer's day requests
 * @route   POST /api/bookings/:bookingId/event-day/day-requests/:requestId/update
 * @body    { message?, photos?: [url] } — at least one
 *
 * Sending another update replaces the previous one.
 */
export const updateDayRequest = async (req, res) => {
  try {
    const validation = validateDayRequestUpdate(req.body);
    if (!validation.valid) return invalid(res, validation.errors);

    const booking = await loadConfirmedBooking(req, res);
    if (!booking) return;

    const { requestId } = req.params;
    const request = mongoose.isValidObjectId(requestId)
      ? booking.dayRequests.id(requestId)
      : null;
    if (!request) return notFound(res, "Day request not found");

    request.update = { ...validation.value, sentAt: new Date() };
    request.status = "Updated";
    return await saveAndRespond(res, booking, "Update sent");
  } catch (error) {
    return failed(res, "Failed to send update", error);
  }
};

// ─── Public ground-contact page ─────────────────────────────

// Everything the ground page may show. Deliberately excludes the customer's
// phone/email, every pricing and payment field, the vendor, and the booking's
// own ids: the vendor /api/bookings routes have no auth, so a bookingId on a
// public page would open the full booking.
const GROUND_VIEW_FIELDS =
  "-_id customer.name eventType eventDate startTime endTime location mapLink status " +
  "groundStaff.name checkedInAt setupCompletedAt teardownCompletedAt setupPhotos dayRequests";

/**
 * @desc    Read-only event-day view for the on-ground contact's link
 * @route   GET /api/ground/:code
 * @access  Public — the unguessable code is the only key
 */
export const getGroundView = async (req, res) => {
  try {
    const { code } = req.params;
    if (!GROUND_CODE_PATTERN.test(code)) return notFound(res, "Link not found");

    const booking = await Booking.findOne({ "groundStaff.code": code })
      .select(GROUND_VIEW_FIELDS)
      .lean();
    if (!booking) return notFound(res, "Link not found");

    // Built field by field rather than spreading the row, so nothing the
    // projection lets through by accident reaches a public response.
    return res.status(200).json({
      status: "SUCCESS",
      ground: {
        customerFirstName:
          String(booking.customer?.name ?? "").trim().split(/\s+/)[0] || null,
        eventType: booking.eventType ?? null,
        eventDate: booking.eventDate,
        startTime: booking.startTime ?? null,
        endTime: booking.endTime ?? null,
        location: booking.location ?? null,
        mapLink: booking.mapLink ?? null,
        status: booking.status,
        groundStaffName: booking.groundStaff?.name ?? null,
        checkedInAt: booking.checkedInAt ?? null,
        setupCompletedAt: booking.setupCompletedAt ?? null,
        teardownCompletedAt: booking.teardownCompletedAt ?? null,
        setupPhotos: booking.setupPhotos ?? [],
        dayRequests: (booking.dayRequests ?? []).map((request) => ({
          _id: request._id,
          text: request.text,
          addedAt: request.addedAt,
          status: request.status,
          update: request.update
            ? {
                message: request.update.message ?? null,
                photos: request.update.photos ?? [],
                sentAt: request.update.sentAt,
              }
            : null,
        })),
      },
    });
  } catch (error) {
    return failed(res, "Failed to load event", error);
  }
};
