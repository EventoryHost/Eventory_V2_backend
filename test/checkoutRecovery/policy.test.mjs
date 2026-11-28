import { test } from "node:test";
import assert from "node:assert/strict";
import { checkoutRecoveryConfig } from "../../src/config/checkoutRecovery.js";
import {
  assessItems,
  invalidationReason,
  isEventDatePast,
  paymentState,
  promptGate,
  snapshotFromSession,
  transitionForSessionStatus,
} from "../../src/services/checkoutRecoveryPolicy.js";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-11-16T12:00:00Z");
const ago = (ms) => new Date(NOW.getTime() - ms);
const config = (env = {}) => checkoutRecoveryConfig(env);

const recovery = (overrides = {}) => ({
  status: "Open",
  source: "cart",
  lastActivityAt: ago(2 * HOUR),
  impressions: { count: 0, lastShownAt: null },
  dismissals: { count: 0, lastDismissedAt: null },
  items: [
    {
      packageId: "pkgA",
      sourceCartItemId: "ci1",
      eventDetails: { date: new Date("2026-12-20T00:00:00Z"), guestCount: 100 },
    },
  ],
  ...overrides,
});

test("config: defaults, overrides and malformed values", () => {
  const c = config();
  assert.equal(c.enabled, true);
  // Tuned for 10-15 minute visits: eligible within the same visit.
  assert.equal(c.inactivityMs, 10 * 60 * 1000);
  assert.equal(c.impressionCooldownMs, 15 * 60 * 1000);
  assert.equal(c.maxImpressions, 5);
  assert.equal(c.dismissCooldownMs, 24 * HOUR);
  assert.equal(c.maxDismissals, 3);
  assert.equal(config({ CHECKOUT_RECOVERY_IMPRESSION_COOLDOWN_MINUTES: "60" }).impressionCooldownMs, HOUR);
  assert.equal(config({ CHECKOUT_RECOVERY_ENABLED: "false" }).enabled, false);
  assert.equal(config({ CHECKOUT_RECOVERY_INACTIVITY_MINUTES: "15" }).inactivityMs, 15 * 60 * 1000);
  assert.equal(config({ CHECKOUT_RECOVERY_INACTIVITY_MINUTES: "soon" }).inactivityMs, 10 * 60 * 1000);
  // Retention never shorter than the prompt window.
  assert.ok(config({ CHECKOUT_RECOVERY_RETENTION_DAYS: "1", CHECKOUT_RECOVERY_MAX_AGE_DAYS: "10" }).retentionMs >= 10 * 24 * HOUR);
});

test("session status transitions: Expired keeps the record open, Completed converts", () => {
  assert.equal(transitionForSessionStatus("Active"), "track");
  assert.equal(transitionForSessionStatus("Completed"), "convert");
  assert.equal(transitionForSessionStatus("Cancelled"), "invalidate");
  assert.equal(transitionForSessionStatus("Expired"), "none");
});

test("snapshot keeps display/resume fields only — no contact or price data", () => {
  const [item] = snapshotFromSession({
    lines: [
      {
        packageId: { toString: () => "pkgA" },
        vendorId: "v1",
        sourceCartItemId: "ci1",
        packageSnapshot: { name: "Royal Decor", image: "https://x/img.jpg", price: 50000, vendorType: "Decorator" },
        eventDetails: { eventType: "Wedding", date: new Date("2026-12-20"), guestCount: 200 },
        quantity: 2,
      },
    ],
    contactDetails: { phone: "+919999999999" },
  });
  assert.equal(item.packageId, "pkgA");
  assert.equal(item.name, "Royal Decor");
  assert.equal(item.quantity, 2);
  assert.equal(item.price, undefined);
  assert.equal(JSON.stringify(item).includes("9999999999"), false);
});

test("gate 1/2: not shown before the inactivity period has passed", () => {
  const r = recovery({ lastActivityAt: ago(5 * 60 * 1000) });
  assert.deepEqual(promptGate(r, { now: NOW, config: config() }), { ok: false, reason: "too_recent" });
  assert.equal(promptGate(recovery(), { now: NOW, config: config() }).ok, true);
});

test("gate: a recent payment attempt resets the inactivity clock", () => {
  const r = recovery({ lastActivityAt: ago(5 * HOUR) });
  const gate = promptGate(r, { activityAt: ago(5 * 60 * 1000), now: NOW, config: config() });
  assert.equal(gate.reason, "too_recent");
});

test("gate: too old is retired; disabled and closed never show", () => {
  assert.deepEqual(promptGate(recovery({ lastActivityAt: ago(8 * 24 * HOUR) }), { now: NOW, config: config() }), {
    ok: false,
    reason: "too_old",
    retire: true,
  });
  assert.equal(promptGate(recovery(), { now: NOW, config: config({ CHECKOUT_RECOVERY_ENABLED: "0" }) }).ok, false);
  for (const status of ["Converted", "Invalidated", "Superseded", "Retired"]) {
    assert.equal(promptGate(recovery({ status }), { now: NOW, config: config() }).ok, false);
  }
});

test("gate 4: dismissal cooldown, then retirement at the cap", () => {
  const cooling = recovery({ dismissals: { count: 1, lastDismissedAt: ago(HOUR) } });
  assert.equal(promptGate(cooling, { now: NOW, config: config() }).reason, "dismiss_cooldown");
  const cooled = recovery({ dismissals: { count: 1, lastDismissedAt: ago(73 * HOUR) }, lastActivityAt: ago(80 * HOUR) });
  assert.equal(promptGate(cooled, { now: NOW, config: config() }).ok, true);
  const capped = recovery({ dismissals: { count: 3, lastDismissedAt: ago(100 * HOUR) } });
  assert.deepEqual(promptGate(capped, { now: NOW, config: config() }), { ok: false, reason: "dismissed_max", retire: true });
});

test("gate: impression cooldown and lifetime cap stop repeated interruptions", () => {
  const justShown = recovery({ impressions: { count: 1, lastShownAt: ago(5 * 60 * 1000) } });
  assert.equal(promptGate(recovery({ impressions: { count: 1, lastShownAt: ago(20 * 60 * 1000) } }), { now: NOW, config: config() }).ok, true);
  assert.equal(promptGate(justShown, { now: NOW, config: config() }).reason, "impression_cooldown");
  const maxed = recovery({ impressions: { count: 5, lastShownAt: ago(48 * HOUR) } });
  assert.equal(promptGate(maxed, { now: NOW, config: config() }).retire, true);
});

test("payment 3/11: paid or uncertain never prompts; failed and none do", () => {
  assert.equal(paymentState([], null), "none");
  assert.equal(paymentState([{ status: "PAID" }, { status: "FAILED" }], null), "paid");
  assert.equal(paymentState([{ status: "FAILED" }], null), "failed");
  assert.equal(paymentState([{ status: "PENDING" }], "PAID"), "paid");
  assert.equal(paymentState([{ status: "PENDING" }], "unknown"), "uncertain");
  assert.equal(paymentState([{ status: "PENDING" }], "SOMETHING_NEW"), "uncertain");
  assert.equal(paymentState([{ status: "PENDING" }], "ACTIVE"), "failed");
  assert.equal(paymentState([{ status: "PENDING" }], "EXPIRED"), "failed");
});

test("items 6/7: unavailable package, passed date and removed cart item are excluded", () => {
  const r = recovery({
    items: [
      { packageId: "live", sourceCartItemId: "c1", eventDetails: { date: new Date("2026-12-20") } },
      { packageId: "gone", sourceCartItemId: "c2", eventDetails: { date: new Date("2026-12-20") } },
      { packageId: "live2", sourceCartItemId: "c3", eventDetails: { date: new Date("2026-11-01") } },
      { packageId: "live3", sourceCartItemId: "c4", eventDetails: { date: null } },
    ],
  });
  const { valid, invalid } = assessItems(r, {
    livePackages: new Map([["live", {}], ["live2", {}], ["live3", {}]]),
    cartItemIds: new Set(["c1", "c3"]),
    availability: new Map([["live", false]]),
    now: NOW,
  });
  assert.deepEqual(valid.map((i) => i.packageId), ["live"]);
  assert.equal(valid[0].dateAvailable, false);
  assert.deepEqual(
    invalid.map((i) => [i.packageId, i.reason]),
    [
      ["gone", "package_unavailable"],
      ["live2", "event_date_passed"],
      ["live3", "removed_from_cart"],
    ]
  );
  assert.equal(invalidationReason(invalid), "items_unavailable");
  assert.equal(invalidationReason([{ reason: "event_date_passed" }]), "event_date_passed");
});

test("items: direct checkouts don't need a cart", () => {
  const r = recovery({ source: "direct", items: [{ packageId: "live", sourceCartItemId: null, eventDetails: {} }] });
  const { valid } = assessItems(r, { livePackages: new Map([["live", {}]]), cartItemIds: null, availability: new Map(), now: NOW });
  assert.equal(valid.length, 1);
});

test("event date: today still counts as upcoming", () => {
  assert.equal(isEventDatePast(new Date("2026-11-16T00:00:00Z"), NOW), false);
  assert.equal(isEventDatePast(new Date("2026-11-14T00:00:00Z"), NOW), true);
  assert.equal(isEventDatePast(null, NOW), false);
});
