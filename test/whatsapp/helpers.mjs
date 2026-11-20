import { whatsappConfig, TEMPLATE_ENV_VARS } from "../../src/config/whatsapp.js";

/** A fully configured environment; override keys per test. */
export function testEnv(overrides = {}) {
  const env = {
    WHATSAPP_NOTIFICATIONS_ENABLED: "true",
    INTERAKT_API_KEY: "test-key-not-real",
    INTERAKT_WEBHOOK_SECRET: "test-webhook-secret",
    WHATSAPP_RETRY_BASE_DELAY_MS: "0",
    WHATSAPP_RATE_LIMIT_PER_MINUTE: "6000",
  };
  for (const [type, name] of Object.entries(TEMPLATE_ENV_VARS)) env[name] = `tpl_${type}`;
  return { ...env, ...overrides };
}

export const configFrom = (overrides) => () => whatsappConfig(testEnv(overrides));

export function optedInCustomer(overrides = {}) {
  return {
    _id: "665f0c0c0c0c0c0c0c0c0c01",
    id: "CUS20260101000000001",
    name: "Asha Verma",
    phone: "+919876543210",
    isPhoneVerified: true,
    isDeactivated: false,
    preferences: { notification: { whatsapp: true } },
    whatsappConsent: {
      status: "opted_in",
      optedInAt: new Date("2026-01-01T00:00:00Z"),
      source: "settings",
      phone: "+919876543210",
    },
    ...overrides,
  };
}

/** In-memory stand-in for the MongoDB store, with the same unique-key rule. */
export function fakeStore(customer, { now = () => new Date() } = {}) {
  const rows = new Map();
  let seq = 0;
  return {
    rows,
    all: () => [...rows.values()],
    async findCustomer() {
      return customer;
    },
    async insert(doc) {
      if ([...rows.values()].some((r) => r.dedupeKey === doc.dedupeKey)) return null;
      const row = { _id: `row${++seq}`, attempts: 0, createdAt: now(), ...doc };
      rows.set(row._id, row);
      return { ...row };
    },
    async update(id, set, unset) {
      const row = rows.get(id);
      Object.assign(row, set);
      for (const key of Object.keys(unset || {})) delete row[key];
    },
    async existsRecent({ type, bookingId, since }) {
      return [...rows.values()].some(
        (r) => r.type === type && r.bookingId === bookingId && r.createdAt >= since && !["failed", "unknown"].includes(r.status)
      );
    },
    async claimRetry(at) {
      const row = [...rows.values()].find((r) => r.status === "retry_scheduled" && r.nextAttemptAt <= at);
      if (!row) return null;
      row.status = "sending";
      row.nextAttemptAt = null;
      return { ...row };
    },
    async expireStaleSending() {
      return 0;
    },
  };
}

/** A mock Interakt client: each call takes the next scripted outcome. */
export function fakeClient(outcomes = [{ messageId: "msg-1" }]) {
  const calls = [];
  return {
    calls,
    async sendTemplate(args) {
      calls.push(args);
      const next = outcomes.length > 1 ? outcomes.shift() : outcomes[0];
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
