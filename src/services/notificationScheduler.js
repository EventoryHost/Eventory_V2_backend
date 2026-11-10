import Booking, { eventEndOf, eventStartOf } from "../models/Booking.js";
import VendorNotification from "../models/VendorNotification.js";
import {
  contextFromDeal,
  dateLabel,
  notifyVendor,
  resolveVendorActions,
  timeLabel,
} from "./vendorNotificationService.js";

/**
 * Time-based vendor reminders: nothing happens at the moment they are due,
 * so a timer has to notice. Runs in-process every few minutes (the API is a
 * single pm2 process per environment — see .github/workflows/deploy.yml).
 *
 * Every pass is safe to repeat and to run from more than one process:
 *  - each reminder carries a dedupeKey that includes its deadline, and the
 *    inbox's unique (vendorId, dedupeKey) index lets only one row through —
 *    a restart or a second instance never sends it twice, while a moved
 *    deadline gets a fresh reminder;
 *  - each job also lists what is still outstanding, and clears "needs
 *    action" on reminders whose task got done, cancelled or expired, so the
 *    inbox never asks for something that no longer applies.
 *
 * Set NOTIFICATION_SCHEDULER=off to disable (e.g. a laptop pointed at the
 * shared dev database).
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const INTERVAL_MS = 5 * MINUTE;
const FIRST_RUN_DELAY_MS = 30 * 1000;

// How long before the deadline / event the reminder goes out.
const RESPONSE_CLOSING_LEAD = 2 * HOUR;
const SETUP_DUE_LEAD = 2 * HOUR;
const SETUP_OVERDUE_AFTER = 30 * MINUTE;
const REQUEST_PENDING_AFTER = 15 * MINUTE;
// Overdue payments: on the first pass after the due date, then every
// PAYMENT_REMINDER_EVERY, at most PAYMENT_REMINDER_MAX times per milestone.
const PAYMENT_REMINDER_EVERY = 3 * DAY;
const PAYMENT_REMINDER_MAX = 3;

const ACK_PENDING_STATUSES = ["NewBooking", "Viewed"];
const DEAD_STATUSES = ["Declined", "Cancelled"];

/**
 * Sends one reminder unless it already went out. A newer reminder of the
 * same type about the same booking supersedes the older one's action, so the
 * inbox shows one thing to do per booking.
 */
async function remind(type, booking, extra) {
  const vendorId = String(booking.vendorId);
  if (await VendorNotification.exists({ vendorId, dedupeKey: extra.dedupeKey })) return false;
  await resolveVendorActions(vendorId, booking.bookingId, [type]);
  return Boolean(await notifyVendor(type, { ...contextFromDeal(booking), ...extra }));
}

/** Clears open rows of [type] about bookings no longer in [openBookingIds]. */
async function clearResolved(type, openBookingIds) {
  await VendorNotification.updateMany(
    { type, needsAction: true, "target.id": { $nin: [...openBookingIds] } },
    { $set: { needsAction: false, actionResolvedAt: new Date() } }
  );
}

const BOOKING_FIELDS =
  "bookingId vendorId status customer eventType packageSnapshot location venueName eventDate startTime endTime " +
  "respondByAt confirmedAt setupCompletedAt paymentMilestones dayRequests";

// ── #11 Response window closing ──────────────────────────────────────────
async function responseClosing(now) {
  const awaiting = await Booking.find({
    status: { $in: ACK_PENDING_STATUSES },
    respondByAt: { $gt: now },
  })
    .select(BOOKING_FIELDS)
    .lean();

  let sent = 0;
  for (const booking of awaiting) {
    if (booking.respondByAt - now > RESPONSE_CLOSING_LEAD) continue;
    const sentNow = await remind("booking.responseClosing", booking, {
      dedupeKey: `booking.responseClosing:${booking.bookingId}:${booking.respondByAt.getTime()}`,
    });
    if (sentNow) sent++;
  }
  await clearResolved("booking.responseClosing", awaiting.map((b) => b.bookingId));
  return sent;
}

// ── #19 Payment overdue ──────────────────────────────────────────────────
const overdueMilestones = (booking, now) =>
  (booking.paymentMilestones || []).filter((m) => m.status !== "Received" && m.dueDate && m.dueDate < now);

async function paymentsOverdue(now) {
  const bookings = await Booking.find({
    status: { $nin: DEAD_STATUSES },
    confirmedAt: { $ne: null },
    paymentMilestones: { $elemMatch: { status: { $ne: "Received" }, dueDate: { $lt: now } } },
  })
    .select(BOOKING_FIELDS)
    .lean();

  let sent = 0;
  for (const booking of bookings) {
    for (const milestone of overdueMilestones(booking, now)) {
      const round = Math.min(
        Math.floor((now - milestone.dueDate) / PAYMENT_REMINDER_EVERY),
        PAYMENT_REMINDER_MAX - 1
      );
      const sentNow = await remind("payments.overdue", booking, {
        milestoneTitle: milestone.title,
        amount: milestone.amount,
        dueLabel: dateLabel(milestone.dueDate),
        dedupeKey: `payments.overdue:${booking.bookingId}:${milestone._id}:${milestone.dueDate.getTime()}:${round}`,
      });
      if (sentNow) sent++;
    }
  }
  await clearResolved("payments.overdue", bookings.map((b) => b.bookingId));
  return sent;
}

// ── #23 Setup due soon, #24 Setup overdue ────────────────────────────────
async function setupReminders(now) {
  // Wide enough to catch any slot on today's or tomorrow's IST day.
  const bookings = await Booking.find({
    status: "Confirmed",
    setupCompletedAt: null,
    startTime: { $nin: [null, ""] },
    eventDate: { $gte: new Date(now.getTime() - 2 * DAY), $lte: new Date(now.getTime() + 2 * DAY) },
  })
    .select(BOOKING_FIELDS)
    .lean();

  let sent = 0;
  const dueSoonOpen = [];
  const overdueOpen = [];
  for (const booking of bookings) {
    const start = eventStartOf(booking);
    const end = eventEndOf(booking);
    if (!start || !end || now >= end) continue;
    const ctx = { startLabel: timeLabel(start) };
    const key = `${booking.bookingId}:${start.getTime()}`;

    if (now - start >= SETUP_OVERDUE_AFTER) {
      overdueOpen.push(booking.bookingId);
      await resolveVendorActions(booking.vendorId, booking.bookingId, ["eventDay.setupDueSoon"]);
      if (await remind("eventDay.setupOverdue", booking, { ...ctx, dedupeKey: `eventDay.setupOverdue:${key}` })) sent++;
    } else if (start - now <= SETUP_DUE_LEAD) {
      dueSoonOpen.push(booking.bookingId);
      if (await remind("eventDay.setupDueSoon", booking, { ...ctx, dedupeKey: `eventDay.setupDueSoon:${key}` })) sent++;
    }
  }
  await clearResolved("eventDay.setupDueSoon", dueSoonOpen);
  await clearResolved("eventDay.setupOverdue", overdueOpen);
  return sent;
}

// ── #25 Request still pending ────────────────────────────────────────────
async function requestsPending(now) {
  const cutoff = new Date(now.getTime() - REQUEST_PENDING_AFTER);
  const bookings = await Booking.find({
    status: "Confirmed",
    dayRequests: { $elemMatch: { status: "Pending" } },
  })
    .select(BOOKING_FIELDS)
    .lean();

  let sent = 0;
  const open = [];
  for (const booking of bookings) {
    const pending = (booking.dayRequests || []).filter((r) => r.status === "Pending");
    if (pending.length) open.push(booking.bookingId);
    for (const request of pending) {
      if (!request.addedAt || request.addedAt > cutoff) continue;
      const sentNow = await remind("eventDay.requestPending", booking, {
        requestText: request.text,
        dedupeKey: `eventDay.requestPending:${booking.bookingId}:${request._id}`,
      });
      if (sentNow) sent++;
    }
  }
  await clearResolved("eventDay.requestPending", open);
  return sent;
}

const JOBS = { responseClosing, paymentsOverdue, setupReminders, requestsPending };

let running = false;

/** One pass over every job. Exported for tests and manual runs. */
export async function runNotificationJobs(now = new Date()) {
  if (running) return null;
  running = true;
  const results = {};
  try {
    for (const [name, job] of Object.entries(JOBS)) {
      try {
        results[name] = await job(now);
      } catch (error) {
        results[name] = `failed: ${error.message}`;
        console.error(`[scheduler] ${name} failed:`, error);
      }
    }
    const sent = Object.values(results).filter((n) => typeof n === "number" && n > 0);
    if (sent.length) console.log("[scheduler] reminders sent:", results);
    return results;
  } finally {
    running = false;
  }
}

let timer = null;

/** Starts the reminder loop. Call once the database is connected. */
export function startNotificationScheduler() {
  if (String(process.env.NOTIFICATION_SCHEDULER).toLowerCase() === "off") {
    console.log("[scheduler] NOTIFICATION_SCHEDULER=off — reminders disabled");
    return;
  }
  if (timer) return;
  setTimeout(() => runNotificationJobs(), FIRST_RUN_DELAY_MS).unref();
  timer = setInterval(() => runNotificationJobs(), INTERVAL_MS);
  timer.unref();
}
