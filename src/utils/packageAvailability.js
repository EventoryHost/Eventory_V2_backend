import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import { utcDayRange } from "./dateRange.js";
import { resolveVendorRefId } from "./resolveVendor.js";
import { getEffectivePackagePrice } from "./packagePrice.js";

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
export async function computeAvailability(pkg, { date, guests, time, timeSlot }) {
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

    // Slot-based booking (2026-09-21): a package is now booked per time slot,
    // so once the customer has picked one, capacity is "is THIS slot free",
    // not "is the whole day under dailyCapacity" — otherwise the first
    // booking of a day would block every other slot at cart/checkout.
    const slotRange = parseSlotValue(timeSlot);
    if (slotRange && vendorObjectId) {
      const sameDay = await Booking.find({
        vendorId: vendorObjectId,
        eventDate: { $gte: start, $lt: end },
        status: { $nin: ["Cancelled", "Declined"] },
      })
        .select("startTime endTime")
        .lean();
      const overlapping = sameDay.filter((b) => {
        const bs = parseTimeToMinutes(b.startTime);
        const be = parseTimeToMinutes(b.endTime);
        return bs != null && be != null && bs < slotRange.e && be > slotRange.s;
      }).length;
      availability.timeSlot = timeSlot;
      availability.capacityAvailable = overlapping < (pkg.bookingCapacity?.simultaneousBookings ?? 1);
    }
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

// "HH:MM - HH:MM" (the slots endpoint's `value`) -> minutes, or null.
export function parseSlotValue(str) {
  const m = String(str || "").match(/^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/);
  if (!m) return null;
  const sMin = parseTimeToMinutes(m[1]);
  const eMin = parseTimeToMinutes(m[2]);
  return sMin == null || eMin == null ? null : { s: sMin, e: eMin };
}

/**
 * Server-side check that a submitted timeSlot is one of the slots offered
 * for that package/date and still free. Used by add/update cart item.
 */
export async function validateTimeSlotSelection(pkg, date, timeSlot) {
  const offered = await computeSlotsForDate(pkg, date);
  if (!offered.dayAvailable) return { ok: false, message: "This date is not available for booking (" + offered.reason + ")" };
  const norm = (v) => { const r = parseSlotValue(v); return r ? r.s + "-" + r.e : String(v); };
  const match = offered.slots.find((sl) => norm(sl.value) === norm(timeSlot));
  if (!match) return { ok: false, message: "Selected time slot is not offered for this package on that date" };
  if (!match.available) return { ok: false, message: "Selected time slot is already booked" };
  return { ok: true };
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

// Eventory's default slotting for packages whose vendor did not declare
// time slots (product rule, 2026-09-21): the event day runs 6 AM - 9 PM and
// slot length scales with the package's price — <=10K: 3h, >10K..<=20K: 4h,
// >20K: 5h. Only whole-length slots are generated, so the 4h tier gets 3
// slots (6-10, 10-2, 2-6) and nothing after 6 PM; flip
// INCLUDE_PARTIAL_LAST_SLOT to also offer the shorter trailing 6-9 PM slot.
const DAY_START_MIN = 6 * 60;
const DAY_END_MIN = 21 * 60;
const INCLUDE_PARTIAL_LAST_SLOT = false;

export function slotLengthHoursForPrice(price) {
  if (price > 20000) return 5;
  if (price > 10000) return 4;
  return 3;
}

export function buildAutoSlots(price) {
  const lengthHours = slotLengthHoursForPrice(price || 0);
  const len = lengthHours * 60;
  const slots = [];
  for (let s = DAY_START_MIN; s < DAY_END_MIN; s += len) {
    const e = Math.min(s + len, DAY_END_MIN);
    if (e - s < len && !INCLUDE_PARTIAL_LAST_SLOT) break;
    slots.push({ s, e });
  }
  return { lengthHours, slots };
}

function minutesToLabel(mins) {
  const h24 = Math.floor(mins / 60);
  const m = String(mins % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m} ${h24 < 12 ? "AM" : "PM"}`;
}

function minutesToHHMM(mins) {
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Bookable slots for ONE date — backs GET /customer/packages/:packageId/slots
 * (the PDP's "Event timing" picker, added 2026-09-19).
 *
 * What the vendor side actually stores (Step2Availability.tsx ->
 * Package.availabilitySettings): package-LEVEL working days
 * (weeklyAvailability), an optional custom date window, a workMode
 * (FULL_DAY | TIME_SLOTS), and — for TIME_SLOTS — one list of
 * {startTime,endTime} that applies to EVERY working day. There is no
 * per-date slot list; the per-date part is availabilityCalendar
 * (Available/Blocked/Booked) plus live Bookings. So "the slots for the
 * selected date" = the package's slot list, minus whatever that date's
 * calendar/weekday/bookings rule out.
 *
 * Per-slot booked detection needs Booking.startTime/endTime; bookings
 * without them (all pre-2026-09-19 customer bookings — creation never set
 * them) cannot be attributed to a slot, so they are not held against any
 * individual slot here.
 */
export async function computeSlotsForDate(pkg, date) {
  const { start } = utcDayRange(date);
  const end = utcDayRange(date).end;
  const settings = pkg.availabilitySettings || {};
  const workMode = settings.workMode || "FULL_DAY";
  const result = { date: start.toISOString().slice(0, 10), workMode, dayAvailable: true, reason: null, slots: [] };

  const calendarEntry = (pkg.availabilityCalendar || []).find((e) => {
    const d = new Date(e.date);
    return d >= start && d < end;
  });
  if (calendarEntry?.status === "Blocked" || calendarEntry?.status === "Booked") {
    return { ...result, dayAvailable: false, reason: calendarEntry.status === "Blocked" ? "BLOCKED_BY_VENDOR" : "FULLY_BOOKED" };
  }

  const weekly = settings.weeklyAvailability || [];
  const weekday = start.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  if (weekly.length && !weekly.includes(weekday)) {
    return { ...result, dayAvailable: false, reason: "NOT_A_WORKING_DAY" };
  }

  const range = settings.customDateRange;
  if (settings.repeatType === "CUSTOM" && range?.startDate && range?.endDate) {
    if (start < utcDayRange(range.startDate).start || start > utcDayRange(range.endDate).start) {
      return { ...result, dayAvailable: false, reason: "OUTSIDE_AVAILABLE_RANGE" };
    }
  }

  let vendorObjectId = pkg.vendorId?._id || pkg.vendorId;
  if (!mongoose.Types.ObjectId.isValid(vendorObjectId)) {
    vendorObjectId = await resolveVendorRefId(vendorObjectId);
  }
  const bookings = vendorObjectId
    ? await Booking.find({
        vendorId: vendorObjectId,
        eventDate: { $gte: start, $lt: end },
        status: { $nin: ["Cancelled", "Declined"] },
      })
        .select("startTime endTime")
        .lean()
    : [];

  const simultaneous = pkg.bookingCapacity?.simultaneousBookings ?? 1;
  const booked = bookings
    .map((b) => ({ s: parseTimeToMinutes(b.startTime), e: parseTimeToMinutes(b.endTime) }))
    .filter((b) => b.s != null && b.e != null);

  // Vendor-declared slots win. When the vendor left the package on FULL_DAY
  // (or TIME_SLOTS with no usable slots), Eventory generates the day's slots
  // from the package price instead — see buildAutoSlots.
  let raw = [];
  if (workMode === "TIME_SLOTS") {
    raw = (settings.timeSlots || [])
      .map((slot) => ({ s: parseTimeToMinutes(slot.startTime), e: parseTimeToMinutes(slot.endTime), startTime: slot.startTime, endTime: slot.endTime }))
      .filter((slot) => slot.s != null && slot.e != null);
    result.slotSource = "VENDOR";
  }
  if (raw.length === 0) {
    const price = getEffectivePackagePrice(pkg);
    const auto = buildAutoSlots(price);
    raw = auto.slots;
    result.slotSource = "AUTO";
    result.slotLengthHours = auto.lengthHours;
    result.priceBasis = price;
  }

  result.slots = raw
    .map((slot) => {
      const startTime = slot.startTime || minutesToLabel(slot.s);
      const endTime = slot.endTime || minutesToLabel(slot.e);
      const overlapping = booked.filter((b) => b.s < slot.e && b.e > slot.s).length;
      return {
        startTime,
        endTime,
        label: `${startTime} - ${endTime}`,
        value: `${minutesToHHMM(slot.s)} - ${minutesToHHMM(slot.e)}`,
        available: overlapping < simultaneous,
        sortKey: slot.s,
      };
    })
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ sortKey, ...rest }) => rest);

  if (result.slots.length && result.slots.every((sl) => !sl.available)) {
    result.dayAvailable = false;
    result.reason = "ALL_SLOTS_BOOKED";
  }
  return result;
}

export default computeAvailability;
