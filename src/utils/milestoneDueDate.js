/**
 * Works out a payment milestone's real due date.
 *
 * TWO SOURCES, in precedence order:
 *   1. The STRUCTURED fields dueOffsetFrom/dueOffsetDays (Package.js). These
 *      are unambiguous, so when present they win and no text is parsed.
 *   2. The legacy free-text `dueDays`, parsed heuristically below.
 *
 * The structured fields were added 2026-09-25 to remove the guesswork; the
 * text parser stays because every package saved before then — and any vendor
 * UI not yet updated — carries only `dueDays`.
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
 * Resolves the STRUCTURED timing fields (Package.js's dueOffsetFrom /
 * dueOffsetDays). These are unambiguous, so when a milestone carries them
 * they win outright and no text parsing happens.
 *
 * Returns undefined (not null) when the milestone has no structured timing,
 * to distinguish "not specified this way" from "specified, but unresolvable"
 * — only the former should fall back to the free-text parser.
 */
function fromStructured(eventDate, milestone, bookingDate) {
  const from = milestone?.dueOffsetFrom;
  if (!from) return undefined;

  if (from === "OnBooking") return bookingDate ? new Date(bookingDate) : null;
  if (!eventDate) return null;
  if (from === "OnEvent") return new Date(eventDate);

  const days = Number(milestone.dueOffsetDays);
  if (!Number.isFinite(days)) return null;
  if (from === "BeforeEvent") return addDays(eventDate, -Math.abs(days));
  if (from === "AfterEvent") return addDays(eventDate, Math.abs(days));

  return null;
}

/**
 * @param {Date|string} eventDate  the booking's event date
 * @param {string|object} dueDaysRawOrMilestone  either the vendor's
 *   free-text dueDays, or the whole milestone object (preferred — that is
 *   what lets the structured dueOffsetFrom/dueOffsetDays fields be used).
 * @param {Date|string} [bookingDate]  used by the "at booking" shape;
 *   defaults to now, which is correct at booking-creation time (the only
 *   place this runs) and harmless for a re-quote.
 * @returns {Date|null} null when nothing resolvable was specified
 */
export function computeMilestoneDueDate(eventDate, dueDaysRawOrMilestone, bookingDate = new Date()) {
  // Accepts either shape so existing callers passing a bare dueDays string
  // keep working unchanged.
  const isMilestoneObject =
    dueDaysRawOrMilestone !== null &&
    typeof dueDaysRawOrMilestone === "object";

  if (isMilestoneObject) {
    const structured = fromStructured(eventDate, dueDaysRawOrMilestone, bookingDate);
    if (structured !== undefined) return structured;
  }

  const dueDaysRaw = isMilestoneObject ? dueDaysRawOrMilestone.dueDays : dueDaysRawOrMilestone;
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
