import { test } from "node:test";
import assert from "node:assert/strict";
import { createCustomerWhatsAppEvents, formatAmount, formatDate, formatSlotTime } from "../../src/services/customerWhatsAppEvents.js";
import { buildBodyValues } from "../../src/services/customerWhatsAppService.js";
import { configFrom } from "./helpers.mjs";

const CUSTOMER_ID = "665f0c0c0c0c0c0c0c0c0c01";
// 14 Dec 2026 in IST, stored as an instant (IST midnight = 18:30Z the day before).
const EVENT_DATE = new Date("2026-12-13T18:30:00Z");

const booking = (overrides = {}) => ({
  _id: "b1",
  bookingId: "EVT20261101000000001",
  vendorId: "VEN20260101000000001",
  customerId: CUSTOMER_ID,
  status: "NewBooking",
  eventType: "Wedding ",
  eventDate: EVENT_DATE,
  startTime: "16:30",
  eventTiming: { startTime: null },
  proposalVersion: 3,
  ...overrides,
});

function harness(env) {
  const calls = [];
  const events = createCustomerWhatsAppEvents({
    notify: async (type, input) => {
      calls.push({ type, input });
      return { status: "submitted" };
    },
    lookups: {
      vendorName: async () => "Ravi Kumar",
      bookingIdsFor: async (ids) => (ids || []).map((id) => `EVT-${id}`),
    },
    getConfig: configFrom(env),
  });
  const last = () => calls[calls.length - 1];
  const values = (call = last()) => buildBodyValues(call.type, { customerName: "Asha", ...call.input.vars });
  return { events, calls, last, values };
}

test("formatters: IST date, rupees, 12h time", () => {
  assert.equal(formatDate(EVENT_DATE), "14 Dec 2026");
  assert.equal(formatAmount(12500), "₹12,500");
  assert.equal(formatAmount(99.5), "₹99.50");
  assert.equal(formatSlotTime("16:30"), "4:30 PM");
  assert.equal(formatSlotTime("00:05"), "12:05 AM");
  assert.equal(formatSlotTime("bad"), null);
});

test("all triggers are no-ops while the feature is off", async () => {
  const { events, calls } = harness({ WHATSAPP_NOTIFICATIONS_ENABLED: "false" });
  await events.bookingRequested(booking());
  await events.welcome({ _id: CUSTOMER_ID });
  assert.equal(calls.length, 0);
});

test("1. welcome — once per customer", async () => {
  const { events, last, values } = harness();
  await events.welcome({ _id: CUSTOMER_ID, name: "Asha" });
  assert.equal(last().type, "welcome");
  assert.equal(last().input.dedupeKey, `welcome:${CUSTOMER_ID}`);
  assert.deepEqual(values(), ["Asha"]);
});

test("2. vendor response — per proposal, customer matched by phone", async () => {
  const { events, last, values } = harness();
  const submittedAt = new Date("2026-11-10T10:00:00Z");
  await events.vendorResponse({
    enquiryId: "ENQ1",
    vendorId: "VEN1",
    customer: { name: "Asha", phone: "98765 43210" },
    eventType: "Birthday",
    eventDate: EVENT_DATE,
    proposal: { submittedAt },
  });
  assert.equal(last().type, "vendorResponse");
  assert.equal(last().input.phone, "98765 43210");
  assert.equal(last().input.dedupeKey, `vendorResponse:ENQ1:${submittedAt.getTime()}`);
  assert.deepEqual(values(), ["Asha", "Ravi Kumar", "Birthday", "14 Dec 2026", "ENQ1"]);
});

test("2. vendor response — enquiry without a phone is skipped", async () => {
  const { events, calls } = harness();
  const result = await events.vendorResponse({ enquiryId: "ENQ1", customer: { name: "A" } });
  assert.equal(result.reason, "no_customer_account");
  assert.equal(calls.length, 0);
});

test("3. booking request submitted", async () => {
  const { events, last, values } = harness();
  await events.bookingRequested(booking());
  assert.equal(last().type, "bookingRequest");
  assert.equal(last().input.customerId, CUSTOMER_ID);
  assert.equal(last().input.dedupeKey, "bookingRequest:EVT20261101000000001");
  assert.deepEqual(values(), ["Asha", "EVT20261101000000001", "Ravi Kumar", "Wedding", "14 Dec 2026"]);
});

test("4. booking status — accepted and declined use different values", async () => {
  const { events, last, values } = harness();
  await events.bookingStatusChanged(booking({ status: "Confirmed" }));
  assert.equal(last().input.dedupeKey, "bookingStatus:EVT20261101000000001:Confirmed");
  assert.equal(values()[4], "accepted");
  assert.match(values()[5], /reserved/);

  await events.bookingStatusChanged(booking({ status: "Declined" }));
  assert.equal(last().input.dedupeKey, "bookingStatus:EVT20261101000000001:Declined");
  assert.equal(values()[4], "declined");
  assert.match(values()[5], /other vendors/);
});

test("4. booking status — other statuses send nothing", async () => {
  const { events, calls } = harness();
  await events.bookingStatusChanged(booking({ status: "InDiscussion" }));
  assert.equal(calls.length, 0);
});

test("5. modification request — keyed by proposal version, throttled", async () => {
  const { events, last, values } = harness({ WHATSAPP_MODIFICATION_THROTTLE_MINUTES: "45" });
  await events.bookingModificationRequested(booking());
  assert.equal(last().type, "bookingModification");
  assert.equal(last().input.dedupeKey, "bookingModification:EVT20261101000000001:v3");
  assert.equal(last().input.throttleMinutes, 45);
  assert.deepEqual(values(), ["Asha", "Ravi Kumar", "EVT20261101000000001", "14 Dec 2026"]);
});

test("6. modification confirmed", async () => {
  const { events, last } = harness();
  await events.bookingModificationConfirmed(booking({ status: "Confirmed" }));
  assert.equal(last().type, "bookingModified");
  assert.equal(last().input.dedupeKey, "bookingModified:EVT20261101000000001:v3");
});

test("7. cancelled — by customer or vendor; only when actually cancelled", async () => {
  const { events, last, values, calls } = harness();
  const cancelledAt = new Date("2026-11-11T00:00:00Z");
  await events.bookingCancelled(booking({ status: "Cancelled", cancelledBy: "Customer", cancelledAt }));
  assert.equal(last().input.dedupeKey, `bookingCancelled:EVT20261101000000001:${cancelledAt.getTime()}`);
  assert.equal(values()[4], "at your request");
  await events.bookingCancelled(booking({ status: "Cancelled", cancelledBy: "Vendor", cancelledAt }));
  assert.equal(values()[4], "by the vendor");
  const before = calls.length;
  await events.bookingCancelled(booking({ status: "Confirmed" }));
  assert.equal(calls.length, before);
});

test("8. payment success — only for PAID; token payment lists created bookings", async () => {
  const { events, last, values, calls } = harness();
  await events.paymentSucceeded({ _id: "p1", status: "PAID", customerId: CUSTOMER_ID, amount: 5000, cfOrderId: "PAY123", createdBookingIds: ["a", "b"] });
  assert.equal(last().type, "paymentSuccess");
  assert.equal(last().input.dedupeKey, "paymentSuccess:p1");
  assert.deepEqual(values(), ["Asha", "₹5,000", "booking EVT-a, EVT-b", "PAY123"]);

  await events.paymentSucceeded({ _id: "p2", status: "PAID", customerId: CUSTOMER_ID, amount: 2500, cfOrderId: "PAY124", bookingId: "b9", milestoneId: "m1" });
  assert.equal(values()[2], "booking EVT-b9");
  assert.equal(last().input.refs.milestoneId, "m1");

  const before = calls.length;
  for (const status of ["PENDING", "FAILED"]) await events.paymentSucceeded({ _id: "p3", status, customerId: CUSTOMER_ID });
  assert.equal(calls.length, before, "never claims success for an unconfirmed payment");
});

test("9. payment failed — only for gateway-confirmed FAILED", async () => {
  const { events, last, values, calls } = harness();
  await events.paymentFailed({ _id: "p1", status: "FAILED", customerId: CUSTOMER_ID, amount: 5000, cfOrderId: "PAY123" });
  assert.equal(last().type, "paymentFailed");
  assert.equal(last().input.dedupeKey, "paymentFailed:p1");
  assert.deepEqual(values(), ["Asha", "₹5,000", "order PAY123"]);
  const before = calls.length;
  await events.paymentFailed({ _id: "p2", status: "PENDING", customerId: CUSTOMER_ID });
  assert.equal(calls.length, before, "a pending/uncertain payment is never reported failed");
});

test("10. payment reminder — per milestone and due date, expires at due date", async () => {
  const { events, last, values } = harness();
  const dueDate = new Date("2026-12-01T06:30:00Z");
  await events.paymentReminder(booking({ status: "Confirmed" }), { _id: "m1", title: "Advance 2", amount: 15000, dueDate });
  assert.equal(last().type, "paymentReminder");
  assert.equal(last().input.dedupeKey, `paymentReminder:EVT20261101000000001:m1:${dueDate.getTime()}`);
  assert.equal(last().input.expiresAt, dueDate);
  assert.deepEqual(values(), ["Asha", "₹15,000", "Advance 2", "EVT20261101000000001", "1 Dec 2026"]);
});

test("11. refund initiated — needs a positive refund", async () => {
  const { events, last, values, calls } = harness();
  const cancelledAt = new Date("2026-11-11T00:00:00Z");
  await events.refundInitiated(booking({ status: "Cancelled", cancelledAt, refund: { amount: 4000, status: "started" } }));
  assert.equal(last().type, "refundInitiated");
  assert.equal(last().input.dedupeKey, `refundInitiated:EVT20261101000000001:${cancelledAt.getTime()}`);
  assert.deepEqual(values(), ["Asha", "₹4,000", "EVT20261101000000001"]);
  const before = calls.length;
  await events.refundInitiated(booking({ refund: { amount: 0, status: "started" } }));
  assert.equal(calls.length, before);
});

test("12. refund completed — only once the refund is marked completed", async () => {
  const { events, last, calls } = harness();
  await events.refundCompleted(booking({ status: "Cancelled", refund: { amount: 4000, status: "started" } }));
  assert.equal(calls.length, 0, "a refund that was only started is not completed");
  await events.refundCompleted(booking({ status: "Cancelled", refund: { amount: 4000, status: "completed" } }));
  assert.equal(last().type, "refundCompleted");
});

test("13. upcoming event reminder — keyed by IST event day, expires at day start", async () => {
  const { events, last, values } = harness();
  await events.eventReminder(booking({ status: "Confirmed", eventTiming: { startTime: "18:00" } }));
  assert.equal(last().type, "eventReminder");
  assert.equal(last().input.dedupeKey, "eventReminder:EVT20261101000000001:2026-12-14");
  assert.deepEqual(last().input.expiresAt, EVENT_DATE);
  assert.deepEqual(values(), ["Asha", "Wedding", "14 Dec 2026", "6:00 PM", "Ravi Kumar", "EVT20261101000000001"]);
});

test("14. event-day reminder — keyed by IST event day, expires at event end", async () => {
  const { events, last, values } = harness();
  await events.eventDayReminder(booking({ status: "Confirmed", endTime: "22:00" }));
  assert.equal(last().type, "eventDay");
  assert.equal(last().input.dedupeKey, "eventDay:EVT20261101000000001:2026-12-14");
  assert.deepEqual(last().input.expiresAt, new Date("2026-12-14T16:30:00Z"));
  assert.deepEqual(values(), ["Asha", "Wedding", "4:30 PM", "Ravi Kumar", "EVT20261101000000001"]);
});

test("a failing lookup never rejects to the caller", async () => {
  const events = createCustomerWhatsAppEvents({
    notify: async () => ({ status: "submitted" }),
    lookups: { vendorName: async () => { throw new Error("db down"); } },
    getConfig: configFrom(),
  });
  const result = await events.bookingRequested(booking());
  assert.equal(result.status, "error");
});
