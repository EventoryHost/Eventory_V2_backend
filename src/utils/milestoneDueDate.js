/**
 * Turns a vendor's free-text milestone `dueDays` into a real due date.
 *
 * Package.paymentMilestones.milestones[].dueDays is `type: String` with no
 * validation and no UI constraint anywhere in this codebase, so vendors type
 * a phrase rather than a number. The previous parser accepted ONLY a bare
 * integer ("7"), requiring String(parseInt(x)) === x.trim() — which every
 * real value fails, so Booking.paymentMilestones[].dueDate came out null for
 * every booking ever created.
 *
 * Every distinct dueDays value in the database at the time of writing
 * (2026-09-25, 139 milestones across 12 distinct phrasings):
 *
 *     "On the event day"          63     -> event date
 *     "Due on the event date"     19     -> event date
 *     "2 days before the event"   17     -> event date - 2
 *     "15 days before the event"  12     -> event date - 15
 *     "At the time of booking"     8     -> booking date
 *     "On booking"                 7     -> booking date
 *     "1 day after the event"      5     -> event date + 1
 *     "5 days before the event"    3     -> event date - 5
 *     "10 days before the event"   2     -> event date - 10
 *     "25 days before the event"   1     -> event date - 25
 *     "20 days before the event"   1     -> event date - 20
 *     "30 days before the event"   1     -> event date - 30
 *
 * These fall into four shapes, which is what this parses: N-before,
 * N-after, on-the-event, and at-booking. Matching is on the SHAPE (a number
 * plus a before/after direction, or a bare on-event/on-booking phrase), not
 * on those twelve literal strings, so a vendor writing "3 days prior to the
 * event" or "7 days post event" is understood too.
 *
 * Deliberately still returns null when the text carries no resolvable
 * timing ("As agreed", "50% upfront"). A null dueDate is a known, handled
 * state downstream — customerBookingController's payment timeline sorts
 * nulls last, and the raw label travels alongside as dueDaysRaw — so
 * returning null is honest, whereas guessing a date would silently tell a
 * customer money is owed on a day the vendor never specified.
 */

// "on booking" / "at the time of booking" / "upon booking" — due immediately,
// which is the booking's own creation date rather than anything event-relative.
const AT_BOOKING = /\b(?:on|at|upon)\b[^.]*\bbooking\b/i;

// "on the event day" / "due on the event date" / "day of the event" — due on
// the event date itself. Checked AFTER the N-day patterns so "1 day after the
// event" is not swallowed by the bare on-event case.
const ON_EVENT = /\b(?:on|day\s+of)\b[^.]*\bevent\b/i;

// "<N> day(s) before/prior to the event" (also "ahead of").
const DAYS_BEFORE = /(\d+)\s*days?\s*(?:before|prior\s*to|ahead\s*of|preceding)\b/i;

// "<N> day(s) after/post/following the event".
const DAYS_AFTER = /(\d+)\s*days?\s*(?:after|post|following)\b/i;

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/**
 * @param {Date|string} eventDate  the booking's event date
 * @param {string} dueDaysRaw      the vendor's free-text dueDays
 * @param {Date|string} [bookingDate]  used only by the "at booking" shape;
 *   defaults to now, which is correct at booking-creation time (the only
 *   place this runs) and harmless for a re-quote.
 * @returns {Date|null} null when the text specifies no resolvable timing
 */
export function computeMilestoneDueDate(eventDate, dueDaysRaw, bookingDate = new Date()) {
  if (!dueDaysRaw) return null;

  const text = String(dueDaysRaw).trim();
  if (!text) return null;

  // A bare integer ("7") kept working — this is what the old parser
  // accepted, and it stays understood as "N days before the event", which
  // is how the field was originally documented.
  if (/^\d+$/.test(text)) {
    return eventDate ? addDays(eventDate, -parseInt(text, 10)) : null;
  }

  // Booking-relative: needs no event date at all.
  if (AT_BOOKING.test(text)) {
    return bookingDate ? new Date(bookingDate) : null;
  }

  // Everything below is event-relative.
  if (!eventDate) return null;

  const before = text.match(DAYS_BEFORE);
  if (before) return addDays(eventDate, -parseInt(before[1], 10));

  const after = text.match(DAYS_AFTER);
  if (after) return addDays(eventDate, parseInt(after[1], 10));

  if (ON_EVENT.test(text)) return new Date(eventDate);

  // No resolvable timing — see the module comment on why this is null
  // rather than a guess.
  return null;
}

export default computeMilestoneDueDate;
