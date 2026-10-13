import { ISSUE_CATEGORIES } from "../models/Booking.js";

// Issues are about an event that was actually going ahead, so they can be
// raised once a booking is confirmed and until its window closes after the
// event. A booking that never got there has no event to raise them about.
const ISSUE_ELIGIBLE_STATUSES = ["Confirmed", "Completed"];

/**
 * Appends an issue to a booking, or explains why it can't. The caller saves.
 *
 * @returns {{ error?: string, code?: number, issue?: object }}
 */
export const raiseBookingIssue = (booking, { category, description }, raisedBy, now = new Date()) => {
  if (!ISSUE_CATEGORIES.includes(category)) {
    return { code: 400, error: `category must be one of: ${ISSUE_CATEGORIES.join(", ")}` };
  }
  const text = typeof description === "string" ? description.trim() : "";
  if (!text) return { code: 400, error: "description is required" };
  if (text.length > 2000) return { code: 400, error: "description must be 2000 characters or fewer" };

  if (!ISSUE_ELIGIBLE_STATUSES.includes(booking.status)) {
    return {
      code: 409,
      error: `Issues can only be raised on a confirmed or completed booking (this one is ${booking.status}).`,
    };
  }
  if (booking.issueWindowClosesAt && now > booking.issueWindowClosesAt) {
    return { code: 409, error: "The window to raise issues for this event has closed." };
  }

  booking.issues.push({ category, description: text, raisedBy, raisedAt: now });
  return { issue: booking.issues[booking.issues.length - 1] };
};
