import { test } from "node:test";
import assert from "node:assert/strict";
import { createInteraktClient, classifyError, InteraktError } from "../../src/services/interaktClient.js";
import { whatsappConfig } from "../../src/config/whatsapp.js";
import { testEnv } from "./helpers.mjs";

const config = whatsappConfig(testEnv());
const httpError = (status, data = {}, headers = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data, headers } });

const send = (client) =>
  client.sendTemplate({
    countryCode: "+91",
    phoneNumber: "9876543210",
    templateName: "tpl_welcome",
    languageCode: "en",
    bodyValues: ["Asha"],
    callbackData: "row1",
  });

test("posts Interakt's documented template payload with Basic auth", async () => {
  let captured;
  const http = {
    post: async (url, body, opts) => {
      captured = { url, body, opts };
      return { status: 201, data: { result: true, message: "Message created successfully", id: "abc-123" } };
    },
  };
  const result = await send(createInteraktClient({ config, http }));
  assert.equal(result.messageId, "abc-123");
  assert.equal(captured.url, "https://api.interakt.ai/v1/public/message/");
  assert.equal(captured.opts.headers.Authorization, "Basic test-key-not-real");
  assert.equal(captured.opts.timeout, config.timeoutMs);
  assert.deepEqual(captured.body, {
    countryCode: "+91",
    phoneNumber: "9876543210",
    type: "Template",
    template: { name: "tpl_welcome", languageCode: "en", bodyValues: ["Asha"] },
    callbackData: "row1",
  });
});

test("a 2xx without result:true is a permanent failure", async () => {
  const http = { post: async () => ({ status: 200, data: { result: false, message: "Template not found" } }) };
  await assert.rejects(send(createInteraktClient({ config, http })), (e) => e instanceof InteraktError && !e.retryable && !e.ambiguous);
});

test("missing API key fails without calling Interakt", async () => {
  let called = false;
  const http = { post: async () => ((called = true), {}) };
  const noKey = whatsappConfig(testEnv({ INTERAKT_API_KEY: "" }));
  await assert.rejects(send(createInteraktClient({ config: noKey, http })), (e) => e.code === "NO_CREDENTIALS");
  assert.equal(called, false);
});

test("429 is retryable and honours Retry-After", () => {
  const e = classifyError(httpError(429, { message: "Rate limit exceeded for this resource" }, { "retry-after": "7" }));
  assert.equal(e.retryable, true);
  assert.equal(e.retryAfterMs, 7000);
  assert.equal(e.code, "RATE_LIMITED");
});

test("502/503/504 and refused connections are retryable", () => {
  for (const status of [502, 503, 504]) assert.equal(classifyError(httpError(status)).retryable, true);
  assert.equal(classifyError(Object.assign(new Error("x"), { code: "ECONNREFUSED" })).retryable, true);
});

test("timeouts and 500s are ambiguous — never retried", () => {
  for (const error of [Object.assign(new Error("t"), { code: "ECONNABORTED" }), httpError(500), Object.assign(new Error("r"), { code: "ECONNRESET" })]) {
    const e = classifyError(error);
    assert.equal(e.retryable, false);
    assert.equal(e.ambiguous, true);
  }
});

test("4xx (bad number, unapproved template) is permanent; 401/403 flagged as AUTH", () => {
  const bad = classifyError(httpError(400, { message: "Invalid phone number" }));
  assert.equal(bad.retryable, false);
  assert.equal(bad.ambiguous, false);
  assert.match(bad.message, /Invalid phone number/);
  assert.equal(classifyError(httpError(401)).code, "AUTH");
  assert.equal(classifyError(httpError(403)).code, "AUTH");
});
