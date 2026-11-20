import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  createInteraktWebhookHandler,
  parseInteraktEvent,
  parseUtc,
  verifyInteraktSignature,
} from "../../src/controllers/interaktWebhookController.js";
import { STATUS_RANK } from "../../src/models/WhatsAppNotification.js";
import { configFrom } from "./helpers.mjs";

const SECRET = "test-webhook-secret";
const sign = (raw, secret = SECRET) => `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;

const payload = (type, message = {}) => ({
  version: "1.0",
  timestamp: "2026-11-12T05:43:33.133000",
  type,
  data: {
    customer: { id: "c", channel_phone_number: "919876543210", traits: {} },
    message: {
      id: "msg-1",
      received_at_utc: "2026-11-12T05:43:30.000000",
      delivered_at_utc: null,
      seen_at_utc: null,
      meta_data: { source_data: { callback_data: "row1" } },
      ...message,
    },
  },
});

function memoryStore(initial = "submitted") {
  const row = { _id: "row1", status: initial, interaktMessageId: "msg-1", events: [] };
  return {
    row,
    async findRow({ messageId, callbackData }) {
      return messageId === row.interaktMessageId || callbackData === row._id ? row : null;
    },
    async fillTimestamps(_id, event) {
      for (const f of ["sentAt", "deliveredAt", "readAt", "failedAt"]) if (event[f] && !row[f]) row[f] = event[f];
    },
    async advanceStatus(_id, event) {
      if (STATUS_RANK[row.status] >= STATUS_RANK[event.status]) return false;
      row.status = event.status;
      row.events.push(event.type);
      if (event.status === "failed") row.failureReason = event.failureReason;
      return true;
    },
  };
}

async function call(handler, body, { signature, raw } = {}) {
  const rawBody = Buffer.from(raw ?? JSON.stringify(body));
  const req = { rawBody, body, headers: { "interakt-signature": signature ?? sign(rawBody) }, ip: "127.0.0.1" };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  await handler(req, res);
  return res;
}

test("signature: valid, tampered, wrong secret, missing", () => {
  const raw = '{"foo":1,"bar":2}';
  assert.equal(verifyInteraktSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyInteraktSignature('{"foo":1,"bar":3}', sign(raw), SECRET), false);
  assert.equal(verifyInteraktSignature(raw, sign(raw, "other"), SECRET), false);
  assert.equal(verifyInteraktSignature(raw, undefined, SECRET), false);
  assert.equal(verifyInteraktSignature(raw, sign(raw), null), false);
});

test("Interakt timestamps (no offset) are read as UTC", () => {
  assert.equal(parseUtc("2022-06-03T05:43:33.133000").toISOString(), "2022-06-03T05:43:33.133Z");
  assert.equal(parseUtc(null), null);
  assert.equal(parseUtc("nonsense"), null);
});

test("parses the four tracked API events; ignores others", () => {
  assert.equal(parseInteraktEvent(payload("message_api_delivered")).status, "delivered");
  const failed = parseInteraktEvent(payload("message_api_failed", { channel_failure_reason: "Recipient is not a valid WhatsApp user", channel_error_code: "1013" }));
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureCode, "1013");
  assert.equal(parseInteraktEvent(payload("message_received")), null);
  assert.equal(parseInteraktEvent(payload("message_campaign_sent")), null);
  assert.equal(parseInteraktEvent({ type: "message_api_sent" }), null);
});

test("no secret configured → 503, nothing processed", async () => {
  const store = memoryStore();
  const handler = createInteraktWebhookHandler({ getConfig: configFrom({ INTERAKT_WEBHOOK_SECRET: "" }), store });
  const res = await call(handler, payload("message_api_delivered"));
  assert.equal(res.statusCode, 503);
  assert.equal(store.row.status, "submitted");
});

test("bad signature → 401, payload not trusted", async () => {
  const store = memoryStore();
  const handler = createInteraktWebhookHandler({ getConfig: configFrom(), store });
  const res = await call(handler, payload("message_api_read"), { signature: "sha256=deadbeef" });
  assert.equal(res.statusCode, 401);
  assert.equal(store.row.status, "submitted");
});

test("status moves forward: sent → delivered → read, with timestamps", async () => {
  const store = memoryStore();
  const handler = createInteraktWebhookHandler({ getConfig: configFrom(), store });
  await call(handler, payload("message_api_sent"));
  await call(handler, payload("message_api_delivered", { delivered_at_utc: "2026-11-12T05:44:00.000000" }));
  await call(handler, payload("message_api_read", { delivered_at_utc: "2026-11-12T05:44:00.000000", seen_at_utc: "2026-11-12T05:50:00.000000" }));
  assert.equal(store.row.status, "read");
  assert.equal(store.row.sentAt.toISOString(), "2026-11-12T05:43:30.000Z");
  assert.equal(store.row.deliveredAt.toISOString(), "2026-11-12T05:44:00.000Z");
  assert.equal(store.row.readAt.toISOString(), "2026-11-12T05:50:00.000Z");
});

test("duplicate and out-of-order events are harmless", async () => {
  const store = memoryStore();
  const handler = createInteraktWebhookHandler({ getConfig: configFrom(), store });
  await call(handler, payload("message_api_read", { seen_at_utc: "2026-11-12T05:50:00.000000" }));
  const dup = await call(handler, payload("message_api_read", { seen_at_utc: "2026-11-12T05:50:00.000000" }));
  const late = await call(handler, payload("message_api_delivered"));
  assert.equal(dup.statusCode, 200);
  assert.equal(late.statusCode, 200);
  assert.equal(store.row.status, "read");
  assert.deepEqual(store.row.events, ["message_api_read"]);
});

test("failed event records the reason", async () => {
  const store = memoryStore();
  const handler = createInteraktWebhookHandler({ getConfig: configFrom(), store });
  await call(handler, payload("message_api_failed", { channel_failure_reason: "Recipient is not a valid WhatsApp user", channel_error_code: "1013" }));
  assert.equal(store.row.status, "failed");
  assert.equal(store.row.failureReason, "Recipient is not a valid WhatsApp user");
});

test("a timed-out send (unknown) is settled by a later webhook", async () => {
  const store = memoryStore("unknown");
  const handler = createInteraktWebhookHandler({ getConfig: configFrom(), store });
  await call(handler, payload("message_api_delivered"));
  assert.equal(store.row.status, "delivered");
});

test("unknown messages and ignored types still get 200 (Interakt disables failing webhooks)", async () => {
  const handler = createInteraktWebhookHandler({ getConfig: configFrom(), store: { ...memoryStore(), findRow: async () => null } });
  assert.equal((await call(handler, payload("message_api_delivered"))).statusCode, 200);
  assert.equal((await call(handler, payload("message_received"))).statusCode, 200);
});
