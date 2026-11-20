/**
 * Customer WhatsApp notifications (Interakt) — every setting in one place.
 *
 * Read on each call rather than once at import, so a test (or a restart
 * with a new .env) sees the current environment. Nothing here throws: a
 * missing or malformed value turns into a safe default, and `problems`
 * says what is missing so the service can log it once and stay quiet.
 *
 * The feature is OFF unless WHATSAPP_NOTIFICATIONS_ENABLED=true AND the
 * Interakt API key is set. Each notification type also needs its approved
 * template's code name (WHATSAPP_TEMPLATE_*) — a type without one is
 * skipped on its own, the rest still send. See docs/whatsapp/README.md.
 */

const DEFAULT_BASE_URL = "https://api.interakt.ai/v1/public";

const truthy = (value) => ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());

const intOr = (value, fallback, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

const list = (value) =>
  String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** Env var holding each notification type's Interakt template code name. */
export const TEMPLATE_ENV_VARS = {
  welcome: "WHATSAPP_TEMPLATE_WELCOME",
  vendorResponse: "WHATSAPP_TEMPLATE_VENDOR_RESPONSE",
  bookingRequest: "WHATSAPP_TEMPLATE_BOOKING_REQUEST",
  bookingStatus: "WHATSAPP_TEMPLATE_BOOKING_STATUS",
  bookingModification: "WHATSAPP_TEMPLATE_BOOKING_MODIFICATION",
  bookingModified: "WHATSAPP_TEMPLATE_BOOKING_MODIFIED",
  bookingCancelled: "WHATSAPP_TEMPLATE_BOOKING_CANCELLED",
  paymentSuccess: "WHATSAPP_TEMPLATE_PAYMENT_SUCCESS",
  paymentFailed: "WHATSAPP_TEMPLATE_PAYMENT_FAILED",
  paymentReminder: "WHATSAPP_TEMPLATE_PAYMENT_REMINDER",
  refundInitiated: "WHATSAPP_TEMPLATE_REFUND_INITIATED",
  refundCompleted: "WHATSAPP_TEMPLATE_REFUND_COMPLETED",
  eventReminder: "WHATSAPP_TEMPLATE_EVENT_REMINDER",
  eventDay: "WHATSAPP_TEMPLATE_EVENT_DAY",
};

export function whatsappConfig(env = process.env) {
  const enabledFlag = truthy(env.WHATSAPP_NOTIFICATIONS_ENABLED);
  const apiKey = String(env.INTERAKT_API_KEY ?? "").trim();

  const templates = {};
  for (const [type, name] of Object.entries(TEMPLATE_ENV_VARS)) {
    templates[type] = String(env[name] ?? "").trim() || null;
  }

  const problems = [];
  if (enabledFlag && !apiKey) problems.push("INTERAKT_API_KEY is not set");

  // Scheduled sends only go out inside this IST window ("8-21" = 08:00 to
  // 20:59), so nobody is woken by a reminder.
  const [windowStart, windowEnd] = String(env.WHATSAPP_SCHEDULE_WINDOW_IST || "9-21")
    .split("-")
    .map((part) => Number(part));
  const validWindow =
    Number.isInteger(windowStart) && Number.isInteger(windowEnd) && windowStart >= 0 && windowEnd <= 24 && windowStart < windowEnd;

  return {
    enabledFlag,
    // Everything below only matters when this is true.
    enabled: enabledFlag && Boolean(apiKey),
    problems,

    apiKey,
    baseUrl: (String(env.INTERAKT_API_BASE_URL ?? "").trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    webhookSecret: String(env.INTERAKT_WEBHOOK_SECRET ?? "").trim() || null,

    templates,
    languageCode: String(env.WHATSAPP_TEMPLATE_LANGUAGE ?? "").trim() || "en",

    // Log what would be sent and record it, without calling Interakt.
    dryRun: truthy(env.WHATSAPP_DRY_RUN),
    // When set, only these E.164 numbers are messaged — for staging against
    // a database that holds real customers.
    recipientAllowlist: list(env.WHATSAPP_RECIPIENT_ALLOWLIST),
    // Country codes we can split an E.164 number by. Customer phones are
    // +91 today (the OTP flow only issues those).
    countryCodes: list(env.WHATSAPP_ALLOWED_COUNTRY_CODES || "+91"),

    timeoutMs: intOr(env.WHATSAPP_API_TIMEOUT_MS, 10000, { min: 1000, max: 60000 }),
    // In-request attempts for one send, and the total across the scheduler's
    // later retries.
    maxAttemptsInline: intOr(env.WHATSAPP_MAX_ATTEMPTS_INLINE, 3, { min: 1, max: 5 }),
    maxAttemptsTotal: intOr(env.WHATSAPP_MAX_ATTEMPTS_TOTAL, 6, { min: 1, max: 20 }),
    retryBaseDelayMs: intOr(env.WHATSAPP_RETRY_BASE_DELAY_MS, 1000, { min: 0, max: 60000 }),
    // Interakt allows 300/min on Growth, 600/min on Advanced; keep headroom.
    ratePerMinute: intOr(env.WHATSAPP_RATE_LIMIT_PER_MINUTE, 240, { min: 1, max: 6000 }),

    scheduleWindowIst: validWindow ? { start: windowStart, end: windowEnd } : { start: 9, end: 21 },
    paymentReminderLeadHours: intOr(env.WHATSAPP_PAYMENT_REMINDER_LEAD_HOURS, 48, { min: 1, max: 24 * 14 }),
    // Repeated proposal edits within this many minutes produce one message.
    modificationThrottleMinutes: intOr(env.WHATSAPP_MODIFICATION_THROTTLE_MINUTES, 30, { min: 0, max: 24 * 60 }),
  };
}

export default whatsappConfig;
