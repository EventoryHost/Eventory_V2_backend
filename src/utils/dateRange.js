/**
 * Day-boundary calc for a date-only value. A date arriving from zod's
 * z.coerce.date() (an ISO date-only string like "2026-08-10") parses to UTC
 * midnight. Bounding the day with .setHours()/.setDate() (LOCAL time)
 * instead of the UTC variants shifts that instant by the server's timezone
 * offset before reading it back — on a server running IST (UTC+5:30),
 * "2026-08-10" silently became "2026-08-09" (caught by direct testing
 * during Phase 1 Step 8, not from a spec). Every day-range boundary
 * anywhere in the customer-side code must go through this helper instead of
 * ad hoc setHours/setDate.
 */
export function utcDayRange(date) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export default utcDayRange;
