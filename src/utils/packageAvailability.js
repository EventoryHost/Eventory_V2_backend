import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import { utcDayRange } from "./dateRange.js";
import { resolveVendorRefId } from "./resolveVendor.js";

/**
 * Availability is best-effort, built from three independent signals: the
 * vendor's own availabilityCalendar entries, the package's declared weekly
 * working days/time slots, and a live cross-check against actual (non-
 * cancelled) Bookings for that vendor/date — none of these alone is
 * authoritative, so the result exposes each signal rather than collapsing
 * them into a single misleadingly-certain yes/no. Final availability is
 * still only confirmed at actual booking time (Phase 4).
 *
 * Originally built for the PDP (Phase 1 Step 8); extracted here so Cart's
 * add-to-cart/GET revalidation (Phase 3 Step 13) can reuse the exact same
 * logic instead of a second, potentially-drifting copy.
 *
 * `pkg` needs: step1_eventAndCrew.capacity, availabilityCalendar,
 * availabilitySettings, bookingCapacity, vendorId (ObjectId or populated
 * doc with ._id).
 */
export async function computeAvailability(pkg, { date, guests, time }) {
  const availability = {};

  if (guests !== undefined) {
    const cap = pkg.step1_eventAndCrew?.capacity || {};
    availability.guests = guests;
    availability.withinCapacity =
      (cap.minGuests == null || guests >= cap.minGuests) && (cap.maxGuests == null || guests <= cap.maxGuests);
  }

  if (date) {
    const { start, end } = utcDayRange(date);

    availability.date = start.toISOString().slice(0, 10);

    const calendarEntry = (pkg.availabilityCalendar || []).find((e) => {
      const d = new Date(e.date);
      return d >= start && d < end;
    });
    availability.calendarStatus = calendarEntry?.status || "Unknown"; // Unknown = vendor hasn't marked this day either way

    const weeklyAvailability = pkg.availabilitySettings?.weeklyAvailability || [];
    const weekday = start.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    availability.matchesWeeklyAvailability = weeklyAvailability.length ? weeklyAvailability.includes(weekday) : null;

    const dailyCapacity = pkg.bookingCapacity?.dailyCapacity ?? null;

    // REAL BUG FOUND 2026-08-21 (frontend-reported "Cast to ObjectId
    // failed ... at path vendorId for model Booking" on add-to-cart): this
    // used to pass pkg.vendorId straight through — fine when the caller
    // had already resolved it (PDP's getPackageDetail does), but a hard
    // 500 whenever it hadn't, since Package.vendorId is stored as the
    // Vendor's business-id string for almost every real package (see
    // src/utils/resolveVendor.js's own write-up) and Booking.vendorId is a
    // strict ObjectId field. Resolved with the SAME fallback here instead
    // of trusting every call site to pre-resolve it — this function is
    // shared by the PDP and Cart's add/get/revalidation paths, so fixing
    // it once here is the actually-robust fix, not a per-caller patch.
    let vendorObjectId = pkg.vendorId?._id || pkg.vendorId;
    if (!mongoose.Types.ObjectId.isValid(vendorObjectId)) {
      vendorObjectId = await resolveVendorRefId(vendorObjectId);
    }

    const activeBookingsOnDate = vendorObjectId
      ? await Booking.countDocuments({
          vendorId: vendorObjectId,
          eventDate: { $gte: start, $lt: end },
          status: { $nin: ["Cancelled", "Declined"] },
        })
      : 0;
    availability.activeBookingsOnDate = activeBookingsOnDate;
    availability.dailyCapacity = dailyCapacity;
    availability.capacityAvailable = dailyCapacity == null ? null : activeBookingsOnDate < dailyCapacity;
  }

  if (time) {
    availability.time = time;
    if (pkg.availabilitySettings?.workMode === "TIME_SLOTS") {
      availability.matchesDeclaredTimeSlot = (pkg.availabilitySettings.timeSlots || []).some((slot) =>
        timeWithinSlot(time, slot.startTime, slot.endTime)
      );
    } else {
      // FULL_DAY package (or workMode unset) — a specific time doesn't
      // restrict availability, so this isn't a meaningful yes/no here.
      availability.matchesDeclaredTimeSlot = null;
    }
  }

  // Collapse the individual signals into one overall flag ONLY when every
  // signal that was actually computed agrees — an explicit "false" from
  // any of them (over capacity, Blocked/Booked, wrong weekday, full on
  // bookings) means overall is false; if nothing came back false but some
  // signals are still null/Unknown, overall stays null rather than a false
  // "yes".
  const checks = [
    availability.withinCapacity,
    availability.calendarStatus ? availability.calendarStatus !== "Blocked" && availability.calendarStatus !== "Booked" : undefined,
    availability.matchesWeeklyAvailability,
    availability.capacityAvailable,
    availability.matchesDeclaredTimeSlot,
  ].filter((v) => v !== undefined);
  availability.overall = checks.length === 0 ? null : checks.every((v) => v === true) ? true : checks.some((v) => v === false) ? false : null;

  return availability;
}

function timeWithinSlot(requestedTime, startTime, endTime) {
  const t = parseTimeToMinutes(requestedTime);
  const s = parseTimeToMinutes(startTime);
  const e = parseTimeToMinutes(endTime);
  if (t == null || s == null || e == null) return false;
  return t >= s && t <= e;
}

// Handles both "HH:MM" 24h (what the customer sends) and "h:mm AM/PM" (how
// vendors' timeSlots are stored per the Package.js field comment).
function parseTimeToMinutes(str) {
  if (typeof str !== "string") return null;
  const ampm = str.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10) % 12;
    if (ampm[3].toUpperCase() === "PM") h += 12;
    return h * 60 + parseInt(ampm[2], 10);
  }
  const h24 = str.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (h24) return parseInt(h24[1], 10) * 60 + parseInt(h24[2], 10);
  return null;
}

export default computeAvailability;
