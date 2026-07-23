// Pure time-range helpers for calendar block splitting (partial unblock).
// Extracted so they can be unit-tested without a database.

export const MINUTES_IN_DAY = 24 * 60;

/**
 * Parse a "hh:mm AM/PM" time string into minutes since midnight [0, 1440).
 * Returns null when the string is missing or malformed.
 */
export const parseTimeToMinutes = (timeStr) => {
  if (!timeStr || typeof timeStr !== "string") return null;
  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  const period = m[3].toUpperCase();
  if (period === "AM") {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }
  return hour * 60 + minute;
};

/**
 * Format minutes since midnight back into a "hh:mm AM/PM" string. A value of
 * 1440 (end of day) is clamped to 23:59 so it renders as "11:59 PM", matching
 * the app's full-day convention (12:00 AM – 11:59 PM).
 */
export const minutesToTime = (mins) => {
  let m = mins;
  if (m >= MINUTES_IN_DAY) m = MINUTES_IN_DAY - 1;
  if (m < 0) m = 0;
  const hour24 = Math.floor(m / 60);
  const minute = m % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(
    2,
    "0"
  )} ${period}`;
};

/**
 * A block's blocked minute-range on a given day. Holiday blocks with null
 * times cover the full day [0, 1440). Otherwise the stored [startTime, endTime]
 * is used. Falls back to full-day when the stored range is unusable.
 */
export const blockCoverageMinutes = (block) => {
  const s = parseTimeToMinutes(block.startTime);
  const e = parseTimeToMinutes(block.endTime);
  if (s === null || e === null) return { start: 0, end: MINUTES_IN_DAY };
  if (e <= s) return { start: 0, end: MINUTES_IN_DAY };
  return { start: s, end: e };
};

/**
 * Subtract the unblocked range [uStart, uEnd) from the covered range
 * [cStart, cEnd), returning the 0, 1, or 2 minute-ranges that remain blocked.
 */
export const subtractRange = (cStart, cEnd, uStart, uEnd) => {
  const clampedU = {
    start: Math.max(uStart, cStart),
    end: Math.min(uEnd, cEnd),
  };
  // No overlap → nothing is unblocked, the whole coverage remains.
  if (clampedU.start >= clampedU.end) return [{ start: cStart, end: cEnd }];
  const remaining = [];
  if (clampedU.start > cStart)
    remaining.push({ start: cStart, end: clampedU.start });
  if (clampedU.end < cEnd) remaining.push({ start: clampedU.end, end: cEnd });
  return remaining;
};
