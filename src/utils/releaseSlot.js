import Package from "../models/Package.js";
import Booking, { SLOT_OCCUPYING_STATUSES } from "../models/Booking.js";
import { utcDayRange } from "./dateRange.js";

/**
 * Releases a package's "Booked" availabilityCalendar entry for one date
 * when a booking that was holding it goes away (cancelled/declined).
 *
 * Extracted from bookingController.js's own revertPackageAvailability
 * (2026-09-25) so the CUSTOMER cancel path can run the exact same logic
 * instead of a second, drifting copy — the customer-side cancelBooking
 * previously released nothing at all, so a customer-cancelled booking left
 * its date marked "Booked" forever: the vendor's calendar kept showing it
 * blocked and every future customer was refused that date.
 *
 * Two rules this keeps from the original:
 *   - Only ever downgrades a "Booked" entry. A vendor's manual "Blocked"
 *     is their own decision and must survive a booking being cancelled —
 *     the same precedence reserveSlot respects when it writes.
 *   - No-ops when there's no entry for that day.
 *
 * And one rule it adds: the date is only actually freed if NO other live
 * booking still needs it. Two bookings on one date (a vendor whose
 * dailyCapacity allows it, or a second package on the same day) both mark
 * the date Booked; cancelling one of them must not hand the date back
 * while the other is still standing. The original never checked this
 * because it only ran on the vendor path, where it was rarer — sharing it
 * with the customer path makes the race real.
 */
export async function releaseSlotIfUnused(packageId, eventDate, { excludeBookingId } = {}) {
  if (!packageId || !eventDate) return;

  const { start, end } = utcDayRange(eventDate);

  // Any OTHER booking still genuinely occupying this package/date? Uses the
  // same SLOT_OCCUPYING_STATUSES definition as computeAvailability, so the
  // two can never disagree about whether a date is taken. In particular a
  // pending, not-yet-accepted request must NOT keep the entry alive here:
  // it isn't holding the slot in the first place (2026-09-25), and treating
  // it as a holder would strand the "Booked" entry forever.
  const stillOccupied = await Booking.countDocuments({
    packageId: String(packageId),
    eventDate: { $gte: start, $lt: end },
    status: { $in: SLOT_OCCUPYING_STATUSES },
    ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}),
  });
  if (stillOccupied > 0) return;

  const pkg = await Package.findById(packageId).select("availabilityCalendar");
  if (!pkg) return;

  const existing = (pkg.availabilityCalendar || []).find((entry) => {
    const d = new Date(entry.date);
    return d >= start && d < end;
  });

  // Never touch a vendor's manual "Blocked" — only a system-written
  // "Booked" is ours to release.
  if (existing && existing.status === "Booked") {
    existing.status = "Available";
    await pkg.save();
  }
}

export default releaseSlotIfUnused;
