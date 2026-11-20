import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCustomerWhatsAppJobs,
  eventReminderKind,
  inSendWindow,
  milestonesDueSoon,
  paymentReminderEligible,
} from "../../src/services/customerWhatsAppScheduler.js";
import { configFrom } from "./helpers.mjs";

// Event on 14 Dec 2026 (IST). Stored as IST midnight = 13 Dec 18:30Z.
const EVENT_DATE = new Date("2026-12-13T18:30:00Z");
const ist = (iso) => new Date(`${iso}+05:30`);

const booking = (overrides = {}) => ({
  _id: "b1",
  bookingId: "EVT1",
  customerId: "c1",
  status: "Confirmed",
  confirmedAt: new Date("2026-11-01T00:00:00Z"),
  eventDate: EVENT_DATE,
  startTime: "10:00",
  endTime: "14:00",
  paymentMilestones: [],
  totalAmount: 30000,
  totalReceived: 5000,
  refund: null,
  ...overrides,
});

// ── Event reminder eligibility & timezone ────────────────────────────────
test("day before the event (IST) → upcoming reminder", () => {
  assert.equal(eventReminderKind(booking(), ist("2026-12-13T10:00:00")), "eventReminder");
  // 00:30 IST on the 13th is still 12th in UTC — IST decides.
  assert.equal(eventReminderKind(booking(), ist("2026-12-13T00:30:00")), "eventReminder");
});

test("event day before the event ends (IST) → event-day reminder", () => {
  assert.equal(eventReminderKind(booking(), ist("2026-12-14T09:00:00")), "eventDay");
  assert.equal(eventReminderKind(booking(), ist("2026-12-14T13:59:00")), "eventDay");
  assert.equal(eventReminderKind(booking(), ist("2026-12-14T14:01:00")), null, "not after the event ended");
});

test("two days before / after → nothing", () => {
  assert.equal(eventReminderKind(booking(), ist("2026-12-12T23:59:00")), null);
  assert.equal(eventReminderKind(booking(), ist("2026-12-15T09:00:00")), null);
});

test("cancelled, declined, completed and unconfirmed bookings are excluded", () => {
  const at = ist("2026-12-13T10:00:00");
  for (const status of ["Cancelled", "Declined", "Completed", "NewBooking", "Viewed"]) {
    assert.equal(eventReminderKind(booking({ status }), at), null, status);
  }
  assert.equal(eventReminderKind(booking({ status: "InDiscussion", confirmedAt: null }), at), null);
  assert.equal(eventReminderKind(booking({ status: "InDiscussion" }), at), "eventReminder", "reopened after confirming still holds the date");
});

test("send window is IST", () => {
  const window = { start: 9, end: 21 };
  assert.equal(inSendWindow(ist("2026-12-13T08:59:00"), window), false);
  assert.equal(inSendWindow(ist("2026-12-13T09:00:00"), window), true);
  assert.equal(inSendWindow(ist("2026-12-13T20:59:00"), window), true);
  assert.equal(inSendWindow(ist("2026-12-13T21:00:00"), window), false);
});

// ── Payment reminder eligibility ─────────────────────────────────────────
test("payment reminders skip paid, cancelled, refunded and unconfirmed bookings", () => {
  assert.equal(paymentReminderEligible(booking()), true);
  assert.equal(paymentReminderEligible(booking({ status: "Cancelled" })), false);
  assert.equal(paymentReminderEligible(booking({ status: "Declined" })), false);
  assert.equal(paymentReminderEligible(booking({ status: "Completed" })), false);
  assert.equal(paymentReminderEligible(booking({ refund: { status: "completed", amount: 100 } })), false);
  assert.equal(paymentReminderEligible(booking({ confirmedAt: null })), false);
  assert.equal(paymentReminderEligible(booking({ paymentMilestones: [{ status: "Received", amount: 30000 }] })), false);
});

test("only unpaid milestones due within the lead window (not overdue)", () => {
  const now = new Date("2026-12-01T00:00:00Z");
  const b = booking({
    paymentMilestones: [
      { _id: "soon", status: "Pending", amount: 1000, dueDate: new Date("2026-12-02T00:00:00Z") },
      { _id: "paid", status: "Received", amount: 1000, dueDate: new Date("2026-12-02T00:00:00Z") },
      { _id: "late", status: "Pending", amount: 1000, dueDate: new Date("2026-11-30T00:00:00Z") },
      { _id: "far", status: "Pending", amount: 1000, dueDate: new Date("2026-12-10T00:00:00Z") },
      { _id: "zero", status: "Pending", amount: 0, dueDate: new Date("2026-12-02T00:00:00Z") },
    ],
  });
  assert.deepEqual(milestonesDueSoon(b, now, 48).map((m) => m._id), ["soon"]);
});

// ── Jobs ─────────────────────────────────────────────────────────────────
function jobs({ env, candidates = [], paid = new Set() } = {}) {
  const sent = [];
  const events = {
    paymentReminder: async (b, m) => (sent.push(["paymentReminder", b.bookingId, m._id]), { status: "submitted" }),
    eventReminder: async (b) => (sent.push(["eventReminder", b.bookingId]), { status: "submitted" }),
    eventDayReminder: async (b) => (sent.push(["eventDay", b.bookingId]), { status: "submitted" }),
  };
  const finders = {
    paymentReminderCandidates: async () => candidates,
    eventReminderCandidates: async () => candidates,
    milestonePaid: async (_b, m) => paid.has(m._id),
  };
  return { sent, jobs: createCustomerWhatsAppJobs({ events, finders, retryDue: async () => 0, getConfig: configFrom(env) }) };
}

test("event job sends the right reminder per booking and skips cancelled ones", async () => {
  const { sent, jobs: j } = jobs({
    candidates: [booking({ bookingId: "TOMORROW" }), booking({ bookingId: "TODAY", eventDate: new Date("2026-12-12T18:30:00Z") }), booking({ bookingId: "GONE", status: "Cancelled" })],
  });
  const count = await j.whatsappEventReminders(ist("2026-12-13T10:00:00"));
  assert.equal(count, 2);
  assert.deepEqual(sent, [["eventReminder", "TOMORROW"], ["eventDay", "TODAY"]]);
});

test("payment job skips a milestone already paid through the gateway", async () => {
  const now = new Date("2026-12-01T06:00:00Z"); // 11:30 IST
  const b = booking({
    paymentMilestones: [
      { _id: "m1", status: "Pending", amount: 1000, dueDate: new Date("2026-12-02T00:00:00Z") },
      { _id: "m2", status: "Pending", amount: 1000, dueDate: new Date("2026-12-02T06:00:00Z") },
    ],
  });
  const { sent, jobs: j } = jobs({ candidates: [b], paid: new Set(["m1"]) });
  await j.whatsappPaymentReminders(now);
  assert.deepEqual(sent, [["paymentReminder", "EVT1", "m2"]]);
});

test("jobs do nothing outside the send window or while disabled", async () => {
  const a = jobs({ candidates: [booking()] });
  assert.equal(await a.jobs.whatsappEventReminders(ist("2026-12-13T23:00:00")), 0);
  const b = jobs({ candidates: [booking()], env: { WHATSAPP_NOTIFICATIONS_ENABLED: "false" } });
  assert.equal(await b.jobs.whatsappEventReminders(ist("2026-12-13T10:00:00")), 0);
  assert.equal(a.sent.length + b.sent.length, 0);
});
