import axios from "axios";

/**
 * Interakt public API — template messages only. Backend-only: the API key
 * never leaves this process.
 *
 * Contract (Interakt docs, "Send WhatsApp templates using APIs"):
 *   POST {base}/message/
 *   Authorization: Basic <API key from Interakt → Developer Settings>
 *     (the key is used exactly as Interakt shows it — it is already encoded)
 *   { countryCode: "+91", phoneNumber: "9876543210", type: "Template",
 *     callbackData, template: { name, languageCode, headerValues?, bodyValues?, buttonValues? } }
 *   → { result: true, message: "Message created successfully", id: "<message id>" }
 *   429 "Rate limit exceeded for this resource" when over the plan's per-minute limit.
 * Delivery status never comes back here — only through the webhook.
 *
 * sendTemplate() resolves to { messageId } or throws InteraktError, which
 * says whether trying again could help:
 *   retryable  the request certainly didn't create a message (429, 502–504,
 *              connection refused/reset before a response) — safe to resend
 *   ambiguous  we can't tell (timeout, 500) — resending could double-send,
 *              so the caller must not retry
 *   otherwise  permanent (bad number, unknown/unapproved template, bad key)
 */

export class InteraktError extends Error {
  constructor(message, { status = null, code = null, retryable = false, ambiguous = false, retryAfterMs = null } = {}) {
    super(message);
    this.name = "InteraktError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.ambiguous = ambiguous;
    this.retryAfterMs = retryAfterMs;
  }
}

// Errors raised before the request reached Interakt. A reset connection is
// not here: it can happen after Interakt has the request.
const NOT_SENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);
const TIMEOUT_CODES = new Set(["ECONNABORTED", "ETIMEDOUT", "ERR_CANCELED"]);

const retryAfterMsOf = (headers) => {
  const raw = headers?.["retry-after"];
  if (raw === undefined) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
};

// Interakt's error bodies aren't fully documented; take whatever message
// field is there, cut short (it can echo request data).
const messageOf = (data) => {
  const text = typeof data === "string" ? data : data?.message || data?.error || data?.detail || null;
  return text ? String(text).slice(0, 300) : null;
};

/** Turns an axios failure into an InteraktError. Exported for tests. */
export function classifyError(error) {
  if (error instanceof InteraktError) return error;
  const response = error?.response;
  if (!response) {
    const code = error?.code || null;
    if (TIMEOUT_CODES.has(code)) {
      return new InteraktError("Interakt request timed out — outcome unknown", { code, ambiguous: true });
    }
    if (NOT_SENT_CODES.has(code)) {
      return new InteraktError(`Could not reach Interakt (${code})`, { code, retryable: true });
    }
    return new InteraktError(`Interakt request failed: ${error?.message || "unknown error"}`, { code, ambiguous: true });
  }

  const { status, data, headers } = response;
  const detail = messageOf(data) || `HTTP ${status}`;
  if (status === 429) {
    return new InteraktError(`Interakt rate limit: ${detail}`, {
      status,
      code: "RATE_LIMITED",
      retryable: true,
      retryAfterMs: retryAfterMsOf(headers),
    });
  }
  if (status === 502 || status === 503 || status === 504) {
    return new InteraktError(`Interakt unavailable: ${detail}`, { status, code: `HTTP_${status}`, retryable: true });
  }
  if (status >= 500) {
    return new InteraktError(`Interakt server error: ${detail}`, { status, code: `HTTP_${status}`, ambiguous: true });
  }
  if (status === 401 || status === 403) {
    return new InteraktError(`Interakt rejected the API key (HTTP ${status})`, { status, code: "AUTH" });
  }
  return new InteraktError(`Interakt rejected the message: ${detail}`, { status, code: `HTTP_${status}` });
}

/**
 * @param {object} opts
 * @param {object} opts.config  whatsappConfig()
 * @param {object} [opts.http]  axios-compatible { post } — injected by tests
 */
export function createInteraktClient({ config, http = axios } = {}) {
  async function sendTemplate({ countryCode, phoneNumber, templateName, languageCode, bodyValues = [], headerValues, buttonValues, callbackData }) {
    if (!config?.apiKey) throw new InteraktError("INTERAKT_API_KEY is not set", { code: "NO_CREDENTIALS" });

    const template = { name: templateName, languageCode };
    if (headerValues?.length) template.headerValues = headerValues;
    if (bodyValues?.length) template.bodyValues = bodyValues;
    if (buttonValues && Object.keys(buttonValues).length) template.buttonValues = buttonValues;

    const payload = {
      countryCode,
      phoneNumber,
      type: "Template",
      template,
      // Echoed back in webhooks (meta_data.source_data.callback_data); max 512 chars.
      ...(callbackData ? { callbackData: String(callbackData).slice(0, 512) } : {}),
    };

    let response;
    try {
      response = await http.post(`${config.baseUrl}/message/`, payload, {
        headers: { Authorization: `Basic ${config.apiKey}`, "Content-Type": "application/json" },
        timeout: config.timeoutMs,
      });
    } catch (error) {
      throw classifyError(error);
    }

    const data = response?.data;
    if (!data || data.result !== true || !data.id) {
      // A 2xx that isn't a success: Interakt said no, so it didn't send.
      throw new InteraktError(`Interakt did not accept the message: ${messageOf(data) || "no message id returned"}`, {
        status: response?.status ?? null,
        code: "NOT_ACCEPTED",
      });
    }
    return { messageId: String(data.id) };
  }

  return { sendTemplate };
}

export default createInteraktClient;
