/**
 * Browsing-based retargeting (RECENTLY_VIEWED / SIMILAR_EVENTS) and the
 * customer-wide popup limits — every tunable in one place. Abandoned
 * checkout keeps its own settings in config/checkoutRecovery.js.
 *
 * Read on each call so tests and a restart with a new .env see current
 * values. A missing or malformed value falls back to the default beside it.
 *
 *   RETARGETING_BROWSING_ENABLED              default true  — RECENTLY_VIEWED and SIMILAR_EVENTS on/off
 *   RETARGETING_VIEW_WINDOW_DAYS              default 14    — only views this recent are considered
 *   RETARGETING_VIEW_SETTLE_MINUTES           default 5     — a package viewed more recently than this is "still being looked at"
 *   RETARGETING_RECENCY_HALF_LIFE_HOURS       default 72    — a view's weight halves every this many hours
 *   RETARGETING_GLOBAL_MIN_GAP_MINUTES        default 15    — no popup of ANY campaign within this long of the last one shown
 *   RETARGETING_GLOBAL_DISMISS_PAUSE_HOURS    default 6     — after dismissing ANY popup, browsing popups pause this long
 *   RETARGETING_BROWSING_DAILY_CAP            default 3     — browsing popups per customer per rolling 24h
 *   RETARGETING_IMPRESSION_COOLDOWN_HOURS     default 12    — gap between two showings of the same browsing campaign
 *   RETARGETING_MAX_IMPRESSIONS               default 2     — the same browsing campaign is shown at most this many times
 *   RETARGETING_DISMISS_COOLDOWN_HOURS        default 72    — quiet time after "Not now" on a browsing campaign
 *   RETARGETING_MAX_DISMISSALS                default 1     — a dismissed browsing campaign is retired after this many
 *   RETARGETING_SIMILAR_LIMIT                 default 3     — recommendations per SIMILAR_EVENTS popup
 *   RETARGETING_RETENTION_DAYS                default 30    — campaign records are purged (TTL) this long after last use
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

export function retargetingConfig(env = process.env) {
  const viewWindowDays = numOr(env.RETARGETING_VIEW_WINDOW_DAYS, 14, { min: 1, max: 90 });
  return {
    browsingEnabled: truthyOr(env.RETARGETING_BROWSING_ENABLED, true),
    viewWindowMs: viewWindowDays * DAY,
    viewSettleMs: numOr(env.RETARGETING_VIEW_SETTLE_MINUTES, 5, { min: 0, max: 24 * 60 }) * MINUTE,
    recencyHalfLifeMs: numOr(env.RETARGETING_RECENCY_HALF_LIFE_HOURS, 72, { min: 1, max: 24 * 90 }) * HOUR,
    globalMinGapMs: numOr(env.RETARGETING_GLOBAL_MIN_GAP_MINUTES, 15, { min: 0, max: 7 * 24 * 60 }) * MINUTE,
    globalDismissPauseMs: numOr(env.RETARGETING_GLOBAL_DISMISS_PAUSE_HOURS, 6, { min: 0, max: 30 * 24 }) * HOUR,
    browsingDailyCap: numOr(env.RETARGETING_BROWSING_DAILY_CAP, 3, { min: 0, max: 50 }),
    impressionCooldownMs: numOr(env.RETARGETING_IMPRESSION_COOLDOWN_HOURS, 12, { min: 0, max: 30 * 24 }) * HOUR,
    maxImpressions: numOr(env.RETARGETING_MAX_IMPRESSIONS, 2, { min: 1, max: 50 }),
    dismissCooldownMs: numOr(env.RETARGETING_DISMISS_COOLDOWN_HOURS, 72, { min: 0, max: 90 * 24 }) * HOUR,
    maxDismissals: numOr(env.RETARGETING_MAX_DISMISSALS, 1, { min: 1, max: 20 }),
    similarLimit: numOr(env.RETARGETING_SIMILAR_LIMIT, 3, { min: 1, max: 10 }),
    retentionMs: Math.max(numOr(env.RETARGETING_RETENTION_DAYS, 30, { min: 1, max: 365 }), viewWindowDays) * DAY,
  };
}

export default retargetingConfig;
