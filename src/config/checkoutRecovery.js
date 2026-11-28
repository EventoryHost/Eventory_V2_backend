/**
 * Abandoned-checkout recovery prompt — every tunable in one place.
 *
 * Read on each call (not once at import) so tests and a restart with a new
 * .env see the current values. Nothing here throws: a missing or malformed
 * value falls back to the default beside it.
 *
 *   CHECKOUT_RECOVERY_ENABLED                 default true
 *   CHECKOUT_RECOVERY_INACTIVITY_MINUTES      default 10   — quiet time after the last checkout edit before a prompt may show
 *   CHECKOUT_RECOVERY_MAX_AGE_DAYS            default 7    — older abandoned checkouts are never prompted
 *   CHECKOUT_RECOVERY_IMPRESSION_COOLDOWN_MINUTES default 15 — minimum gap between two showings of the same prompt
 *   CHECKOUT_RECOVERY_MAX_IMPRESSIONS         default 5    — the same prompt is shown at most this many times
 *   CHECKOUT_RECOVERY_DISMISS_COOLDOWN_HOURS  default 24   — quiet time after "Not now"
 *   CHECKOUT_RECOVERY_MAX_DISMISSALS          default 3    — after this many dismissals the prompt is retired for good
 *
 * Defaults are tuned for short visits (typically 10-15 minutes): a prompt
 * can appear within the same visit the checkout was abandoned in, and again
 * on the next visit, rather than waiting hours. Within one visit the
 * frontend still never re-shows a prompt the customer dismissed.
 *   CHECKOUT_RECOVERY_RETENTION_DAYS          default 30   — recovery records are purged (TTL) this long after the last checkout edit
 */

const truthyOr = (value, fallback) => {
  if (value === undefined || String(value).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
};

const numOr = (value, fallback, { min = 0, max = Infinity } = {}) => {
  const n = Number(value);
  return value !== undefined && String(value).trim() !== "" && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function checkoutRecoveryConfig(env = process.env) {
  const maxAgeDays = numOr(env.CHECKOUT_RECOVERY_MAX_AGE_DAYS, 7, { min: 1, max: 90 });
  return {
    enabled: truthyOr(env.CHECKOUT_RECOVERY_ENABLED, true),
    inactivityMs: numOr(env.CHECKOUT_RECOVERY_INACTIVITY_MINUTES, 10, { min: 0, max: 7 * 24 * 60 }) * MINUTE,
    maxAgeMs: maxAgeDays * DAY,
    impressionCooldownMs: numOr(env.CHECKOUT_RECOVERY_IMPRESSION_COOLDOWN_MINUTES, 15, { min: 0, max: 30 * 24 * 60 }) * MINUTE,
    maxImpressions: numOr(env.CHECKOUT_RECOVERY_MAX_IMPRESSIONS, 5, { min: 1, max: 50 }),
    dismissCooldownMs: numOr(env.CHECKOUT_RECOVERY_DISMISS_COOLDOWN_HOURS, 24, { min: 0, max: 90 * 24 }) * HOUR,
    maxDismissals: numOr(env.CHECKOUT_RECOVERY_MAX_DISMISSALS, 3, { min: 1, max: 20 }),
    // Never shorter than the prompt window itself, or a record could vanish
    // while it is still eligible.
    retentionMs: Math.max(numOr(env.CHECKOUT_RECOVERY_RETENTION_DAYS, 30, { min: 1, max: 365 }), maxAgeDays) * DAY,
  };
}

export default checkoutRecoveryConfig;
