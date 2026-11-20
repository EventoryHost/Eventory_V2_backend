import Booking, { TERMINAL_STATUSES, eventEndOf, isFullyPaid, istDayRange, slotOccupyingFilter } from "../models/Booking.js";
import Payment from "../models/Payment.js";
import { whatsappConfig } from "../config/whatsapp.js";
import customerWhatsApp from "./customerWhatsAppEvents.js";
import { retryDueWhatsApp } from "./customerWhatsAppService.js";

/**
 * Time-based customer WhatsApp messages: payment reminders, the day-before
 * and event-day reminders, and resending retryable failures. These are jobs
 * of the existing notificationScheduler (one 5-minute in-process loop) —
 * not a second scheduler.
 *
 * Safe to repeat, restart and run on several instances: every message has
 * a dedupeKey with a unique index (WhatsAppNotification), so each instance
 * may find the same booking but only one row — one message — gets through.
 * Retries are claimed atomically.
 *
 * Dates are the event's IST calendar day (istDayRange), the convention for
 * every booking date in this codebase: bookings carry no timezone, and
 * Eventory serves India only. Reminders go out only inside
 * WHATSAPP_SCHEDULE_WINDOW_IST.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const IST_OFFSET_MS = 330 * 60 * 1000;

/** The IST hour (0–23) of [now]. */
export const istHour = (now) => new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();

export const inSendWindow = (now, window) => {
  const hour = istHour(now);
  return hour >= window.start && hour < window.end;
};

/** Holds its date: Confirmed, or reopened for changes after confirming. */
export const holdsDate = (booking) =>
  booking?.status === "Confirmed" || (booking?.status === "InDiscussion" && Boolean(booking?.confirmedAt));

/**
 * Which event reminder, if any, [booking] is due at [now]:
 * "eventReminder" on the IST day before the event, "eventDay" on the event
 * day until the event ends, otherwise null. Cancelled, declined, completed
 * and never-confirmed bookings get none.
 */
export function eventReminderKind(booking, now) {
  if (!holdsDate(booking)) return null;
  const day = istDayRange(booking.eventDate);
  if (!day) return null;
  const t = now.getTime();
  if (t >= day.start.getTime() - DAY && t < day.start.getTime()) return "eventReminder";
  const end = eventEndOf(booking);
  if (t >= day.start.getTime() && end && t < end.getTime()) return "eventDay";
  return null;
}

/** Whether a booking can still owe a payment we'd remind about. */
export function paymentReminderEligible(booking) {
  if (!booking || TERMINAL_STATUSES.includes(booking.status)) return false;
  if (!booking.confirmedAt) return false; // the vendor hasn't committed yet
  if (booking.refund) return false; // cancellation/refund under way
  return !isFullyPaid(booking);
}

/** Unpaid milestones falling due within [leadHours] of [now] (not overdue). */
export function milestonesDueSoon(booking, now, leadHours) {
  const t = now.getTime();
  return (booking.paymentMilestones || []).filter((m) => {
    if (m.status === "Received" || !m.dueDate || !(m.amount > 0)) return false;
    const due = new Date(m.dueDate).getTime();
    return due > t && due - t <= leadHours * HOUR;
  });
}

const CUSTOMER_FIELDS =
  "bookingId vendorId customerId status confirmedAt eventType packageSnapshot eventDate startTime endTime eventTiming " +
  "paymentMilestones totalAmount totalReceived refund";

export const mongoFinders = {
  paymentReminderCandidates: (now, leadHours) =>
    Booking.find({
      status: { $nin: TERMINAL_STATUSES },
      customerId: { $ne: null },
      confirmedAt: { $ne: null },
      refund: null,
      paymentMilestones: {
        $elemMatch: { status: { $ne: "Received" }, dueDate: { $gt: now, $lte: new Date(now.getTime() + leadHours * HOUR) } },
      },
    })
      .select(CUSTOMER_FIELDS)
      .lean(),
  eventReminderCandidates: (now) =>
    Booking.find({
      ...slotOccupyingFilter(),
      customerId: { $ne: null },
      // Wide enough for "tomorrow" and an overnight "today" in IST.
      eventDate: { $gte: new Date(now.getTime() - 2 * DAY), $lte: new Date(now.getTime() + 3 * DAY) },
    })
      .select(CUSTOMER_FIELDS)
      .lean(),
  // A PAID payment the booking hasn't been credited with yet still counts.
  milestonePaid: (booking, milestone) =>
    Payment.exists({ bookingId: booking._id, milestoneId: String(milestone._id), status: "PAID" }),
};

export function createCustomerWhatsAppJobs({
  events = customerWhatsApp,
  finders = mongoFinders,
  retryDue = retryDueWhatsApp,
  getConfig = whatsappConfig,
} = {}) {
  const sentCount = (results) => results.filter((r) => r?.status === "submitted" || r?.status === "dry_run").length;

  async function whatsappPaymentReminders(now) {
    const config = getConfig();
    if (!config.enabled || !inSendWindow(now, config.scheduleWindowIst)) return 0;
    const bookings = await finders.paymentReminderCandidates(now, config.paymentReminderLeadHours);
    const results = [];
    for (const booking of bookings) {
      if (!paymentReminderEligible(booking)) continue;
      for (const milestone of milestonesDueSoon(booking, now, config.paymentReminderLeadHours)) {
        if (await finders.milestonePaid(booking, milestone)) continue;
        results.push(await events.paymentReminder(booking, milestone));
      }
    }
    return sentCount(results);
  }

  async function whatsappEventReminders(now) {
    const config = getConfig();
    if (!config.enabled || !inSendWindow(now, config.scheduleWindowIst)) return 0;
    const bookings = await finders.eventReminderCandidates(now);
    const results = [];
    for (const booking of bookings) {
      const kind = eventReminderKind(booking, now);
      if (kind === "eventReminder") results.push(await events.eventReminder(booking));
      else if (kind === "eventDay") results.push(await events.eventDayReminder(booking));
    }
    return sentCount(results);
  }

  async function whatsappRetries() {
    return retryDue();
  }

  return { whatsappPaymentReminders, whatsappEventReminders, whatsappRetries };
}

export const customerWhatsAppJobs = createCustomerWhatsAppJobs();

export default customerWhatsAppJobs;
