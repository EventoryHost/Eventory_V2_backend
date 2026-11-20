import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCustomerWhatsAppService,
  buildBodyValues,
  checkEligibility,
  cleanValue,
} from "../../src/services/customerWhatsAppService.js";
import { InteraktError } from "../../src/services/interaktClient.js";
import { whatsappConfig } from "../../src/config/whatsapp.js";
import { CUSTOMER_WHATSAPP_TYPES } from "../../src/constants/customerWhatsAppTypes.js";
import { splitE164 } from "../../src/utils/phone.js";
import { configFrom, fakeClient, fakeStore, optedInCustomer, testEnv } from "./helpers.mjs";

const noSleep = async () => {};
const service = ({ customer = optedInCustomer(), env, client = fakeClient(), now } = {}) => {
  const store = fakeStore(customer, now ? { now } : undefined);
  const svc = createCustomerWhatsAppService({ getConfig: configFrom(env), store, client, sleep: noSleep, ...(now ? { now } : {}) });
  return { svc, store, client };
};
const input = (extra = {}) => ({ customerId: "x", dedupeKey: "bookingRequest:EVT1", refs: { bookingId: "EVT1" }, vars: { bookingId: "EVT1" }, ...extra });

// ── Configuration / feature flag ─────────────────────────────────────────
test("feature flag off → nothing sent, nothing written", async () => {
  const { svc, store, client } = service({ env: { WHATSAPP_NOTIFICATIONS_ENABLED: "false" } });
  assert.deepEqual(await svc.notify("bookingRequest", input()), { status: "skipped", reason: "disabled" });
  assert.equal(client.calls.length, 0);
  assert.equal(store.all().length, 0);
});

test("enabled without credentials → skipped safely", async () => {
  const { svc, client } = service({ env: { INTERAKT_API_KEY: "" } });
  assert.equal((await svc.notify("bookingRequest", input())).reason, "missing_credentials");
  assert.equal(client.calls.length, 0);
});

test("feature defaults to off when the flag is absent", () => {
  assert.equal(whatsappConfig({ INTERAKT_API_KEY: "k" }).enabled, false);
});

test("a type without a configured template is skipped; others still send", async () => {
  const { svc } = service({ env: { WHATSAPP_TEMPLATE_BOOKING_REQUEST: "" } });
  assert.equal((await svc.notify("bookingRequest", input())).reason, "template_not_configured");
  assert.equal((await svc.notify("welcome", input({ dedupeKey: "welcome:1" }))).status, "submitted");
});

// ── Consent & phone ──────────────────────────────────────────────────────
test("opted-in customer with a verified Indian mobile is eligible", () => {
  const result = checkEligibility(optedInCustomer(), whatsappConfig(testEnv()));
  assert.equal(result.ok, true);
  assert.deepEqual(result.recipient, { countryCode: "+91", phoneNumber: "9876543210", e164: "+919876543210" });
});

for (const [label, overrides, reason] of [
  ["never opted in (phone alone is not consent)", { whatsappConsent: { status: null } }, "no_consent"],
  ["opted out", { whatsappConsent: { status: "opted_out", optedInAt: new Date(), optedOutAt: new Date() } }, "no_consent"],
  ["unverified phone", { isPhoneVerified: false }, "phone_not_verified"],
  ["no phone", { phone: null }, "no_phone"],
  ["deactivated", { isDeactivated: true }, "customer_deactivated"],
  ["consent given for a different number", { phone: "+919123456789" }, "consent_for_other_number"],
]) {
  test(`not eligible: ${label}`, async () => {
    const { svc, client, store } = service({ customer: optedInCustomer(overrides) });
    const result = await svc.notify("bookingRequest", input());
    assert.equal(result.reason, reason);
    assert.equal(client.calls.length, 0);
    assert.equal(store.all().length, 0, "an ineligible send must not consume the dedupe key");
  });
}

test("no customer account → skipped", async () => {
  const { svc } = service({ customer: null });
  assert.equal((await svc.notify("bookingRequest", input())).reason, "no_customer_account");
});

test("invalid phone numbers are rejected (E.164, +91 mobiles)", () => {
  for (const phone of ["9876543210", "+91987654321", "+915876543210", "+91 98765 43210", "+1415555", "", null]) {
    assert.equal(splitE164(phone, ["+91"]), null, String(phone));
  }
  const customer = optedInCustomer({ phone: "+915876543210", whatsappConsent: { ...optedInCustomer().whatsappConsent, phone: "+915876543210" } });
  assert.equal(checkEligibility(customer, whatsappConfig(testEnv())).reason, "invalid_phone");
});

test("other country codes only when allowed", () => {
  assert.equal(splitE164("+14155550123", ["+91"]), null);
  assert.deepEqual(splitE164("+14155550123", ["+91", "+1"]), { countryCode: "+1", phoneNumber: "4155550123", e164: "+14155550123" });
});

test("recipient allowlist restricts sends (staging safety)", async () => {
  const { svc } = service({ env: { WHATSAPP_RECIPIENT_ALLOWLIST: "+919000000000" } });
  assert.equal((await svc.notify("bookingRequest", input())).reason, "not_in_allowlist");
});

// ── Template selection, variables, logging ──────────────────────────────
test("sends the configured template with variables in catalogue order", async () => {
  const { svc, store, client } = service();
  const result = await svc.notify("bookingRequest", {
    customerId: "x",
    dedupeKey: "bookingRequest:EVT1",
    refs: { bookingId: "EVT1" },
    vars: { bookingId: "EVT1", vendorName: "Ravi", eventName: "Wedding", eventDate: "14 Dec 2026" },
  });
  assert.equal(result.status, "submitted");
  assert.equal(client.calls[0].templateName, "tpl_bookingRequest");
  assert.equal(client.calls[0].countryCode, "+91");
  assert.equal(client.calls[0].phoneNumber, "9876543210");
  // customerName defaults to the account holder's first name.
  assert.deepEqual(client.calls[0].bodyValues, ["Asha", "EVT1", "Ravi", "Wedding", "14 Dec 2026"]);
  const [row] = store.all();
  assert.equal(row.status, "submitted");
  assert.equal(row.interaktMessageId, "msg-1");
  assert.equal(row.templateName, "tpl_bookingRequest");
  assert.equal(row.recipient, "+919876543210");
  assert.equal(row.bookingId, "EVT1");
  assert.equal(row.customerId, optedInCustomer()._id);
  assert.ok(row.submittedAt instanceof Date);
  assert.equal(client.calls[0].callbackData, row._id, "callbackData lets webhooks find the row");
});

test("every catalogue type maps vars to its declared variable count", () => {
  for (const [type, def] of Object.entries(CUSTOMER_WHATSAPP_TYPES)) {
    assert.equal(buildBodyValues(type, {}).length, def.variables.length, type);
  }
});

test("values are cleaned for WhatsApp (no newlines/tabs/empty)", () => {
  assert.equal(cleanValue("a\nb\tc    d"), "a b c d");
  assert.equal(cleanValue(""), "-");
  assert.equal(cleanValue(null), "-");
  assert.equal(cleanValue("x".repeat(500)).length, 200);
});

// ── Idempotency ──────────────────────────────────────────────────────────
test("the same business event sends once", async () => {
  const { svc, client, store } = service();
  assert.equal((await svc.notify("bookingRequest", input())).status, "submitted");
  assert.equal((await svc.notify("bookingRequest", input())).status, "duplicate");
  assert.equal(client.calls.length, 1);
  assert.equal(store.all().length, 1);
});

test("concurrent duplicate triggers (webhook + poll) send once", async () => {
  const { svc, client } = service();
  const results = await Promise.all([svc.notify("paymentSuccess", input({ dedupeKey: "paymentSuccess:p1" })), svc.notify("paymentSuccess", input({ dedupeKey: "paymentSuccess:p1" }))]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["duplicate", "submitted"]);
  assert.equal(client.calls.length, 1);
});

test("throttle: a second modification within the window is skipped", async () => {
  const { svc, client } = service();
  await svc.notify("bookingModification", input({ dedupeKey: "bookingModification:EVT1:v1", throttleMinutes: 30 }));
  const second = await svc.notify("bookingModification", input({ dedupeKey: "bookingModification:EVT1:v2", throttleMinutes: 30 }));
  assert.equal(second.reason, "throttled");
  assert.equal(client.calls.length, 1);
});

// ── Interakt errors & retries ───────────────────────────────────────────
test("retryable error then success → retried inline, sent once", async () => {
  const client = fakeClient([new InteraktError("busy", { retryable: true, code: "HTTP_503" }), { messageId: "m2" }]);
  const { svc, store } = service({ client });
  assert.equal((await svc.notify("bookingRequest", input())).status, "submitted");
  assert.equal(client.calls.length, 2);
  assert.equal(store.all()[0].attempts, 2);
});

test("retryable errors past the inline budget → retry_scheduled with values kept", async () => {
  const client = fakeClient([new InteraktError("rate", { retryable: true, code: "RATE_LIMITED" })]);
  const { svc, store } = service({ client });
  const result = await svc.notify("bookingRequest", input());
  assert.equal(result.status, "retry_scheduled");
  assert.equal(client.calls.length, 3);
  const [row] = store.all();
  assert.ok(row.nextAttemptAt > new Date());
  assert.equal(row.pendingBodyValues.length, CUSTOMER_WHATSAPP_TYPES.bookingRequest.variables.length);
});

test("permanent errors (invalid recipient / rejected template) are not retried", async () => {
  const client = fakeClient([new InteraktError("Invalid phone number", { status: 400, code: "HTTP_400" })]);
  const { svc, store } = service({ client });
  const result = await svc.notify("bookingRequest", input());
  assert.equal(result.status, "failed");
  assert.equal(client.calls.length, 1);
  assert.equal(store.all()[0].failureReason, "Invalid phone number");
  assert.equal(store.all()[0].pendingBodyValues, undefined);
});

test("ambiguous errors (timeout) are marked unknown and never retried", async () => {
  const client = fakeClient([new InteraktError("timed out", { ambiguous: true, code: "ECONNABORTED" })]);
  const { svc, store } = service({ client });
  assert.equal((await svc.notify("bookingRequest", input())).status, "unknown");
  assert.equal(client.calls.length, 1);
  assert.equal(store.all()[0].status, "unknown");
});

test("notify never throws, even if the store does", async () => {
  const store = { findCustomer: async () => { throw new Error("db down"); } };
  const svc = createCustomerWhatsAppService({ getConfig: configFrom(), store, client: fakeClient(), sleep: noSleep });
  assert.equal((await svc.notify("bookingRequest", input())).status, "error");
});

test("dry run records the row without calling Interakt", async () => {
  const { svc, store, client } = service({ env: { WHATSAPP_DRY_RUN: "true" } });
  assert.equal((await svc.notify("bookingRequest", input())).status, "dry_run");
  assert.equal(client.calls.length, 0);
  assert.equal(store.all()[0].status, "dry_run");
});

test("expired messages are not sent", async () => {
  const { svc, client } = service();
  const result = await svc.notify("eventReminder", input({ dedupeKey: "e", expiresAt: new Date(Date.now() - 1000) }));
  assert.equal(result.reason, "expired");
  assert.equal(client.calls.length, 0);
});

// ── Scheduler retries ────────────────────────────────────────────────────
test("retryDue resends a due row and settles it", async () => {
  let clock = new Date("2026-11-12T06:00:00Z");
  const now = () => clock;
  const client = fakeClient([new InteraktError("busy", { retryable: true }), new InteraktError("busy", { retryable: true }), new InteraktError("busy", { retryable: true }), { messageId: "late" }]);
  const { svc, store } = service({ client, now });
  await svc.notify("bookingRequest", input());
  assert.equal(store.all()[0].status, "retry_scheduled");
  clock = new Date(clock.getTime() + 60 * 60 * 1000);
  await svc.retryDue();
  const [row] = store.all();
  assert.equal(row.status, "submitted");
  assert.equal(row.interaktMessageId, "late");
  assert.equal(row.pendingBodyValues, undefined, "values are dropped once settled");
});

test("retryDue drops a retry when the customer has since opted out", async () => {
  let clock = new Date("2026-11-12T06:00:00Z");
  const now = () => clock;
  const customer = optedInCustomer();
  const client = fakeClient([new InteraktError("busy", { retryable: true })]);
  const { svc, store } = service({ customer, client, now });
  await svc.notify("bookingRequest", input());
  customer.whatsappConsent = { status: "opted_out", optedOutAt: clock };
  clock = new Date(clock.getTime() + 60 * 60 * 1000);
  await svc.retryDue();
  assert.equal(store.all()[0].status, "failed");
  assert.match(store.all()[0].failureReason, /no_consent/);
  assert.equal(client.calls.length, 3, "no further call after opt-out");
});
