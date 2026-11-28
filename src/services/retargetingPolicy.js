/**
 * Personalized retargeting — the pure, rule-based decisions (no database,
 * no network), unit-tested in test/retargeting/policy.test.mjs.
 * services/retargetingCampaignService.js gathers the facts and applies them.
 *
 * Deliberately transparent: every score below is a short arithmetic rule a
 * person can read and explain to a customer ("you viewed this twice this
 * week"; "same service category, shares the Wedding event type").
 */

/** Campaign types in priority order — the first available one is shown. */
export const CAMPAIGN_PRIORITY = ["ABANDONED_CHECKOUT", "RECENTLY_VIEWED", "SIMILAR_EVENTS"];

/** Picks the single popup to show: the highest-priority campaign that has one. */
export function chooseCampaign(candidates) {
  for (const type of CAMPAIGN_PRIORITY) {
    // Type last: a payload's own field (e.g. the recovery's legacy
    // `campaign: "abandoned_checkout"`) must never override it.
    if (candidates[type]) return { ...candidates[type], campaign: type };
  }
  return null;
}

/**
 * Interest in something viewed: recency halves every `halfLifeMs`, and each
 * doubling of distinct visits adds one more unit of weight.
 *   weight = 0.5^(age / halfLife) × (1 + log2(viewCount))
 */
export function viewWeight({ lastViewedAt, viewCount }, { now, halfLifeMs }) {
  const age = Math.max(0, now.getTime() - new Date(lastViewedAt).getTime());
  const recency = 0.5 ** (age / halfLifeMs);
  const frequency = 1 + Math.log2(Math.max(1, viewCount || 1));
  return recency * frequency;
}

/**
 * Collapses per-variant views into one entry per logical package (variants
 * share packageGroupId), so viewing three tiers of one package counts as
 * interest in that package, not three different ones.
 *
 * views:    [{ packageId, viewedAt, viewCount }]
 * groupOf:  Map<packageId, packageGroupId> (packages missing from it are dropped)
 */
export function aggregateViewsByGroup(views, groupOf) {
  const groups = new Map();
  for (const view of views) {
    const groupId = groupOf.get(String(view.packageId));
    if (!groupId) continue;
    const at = new Date(view.viewedAt);
    const entry = groups.get(groupId) || { groupId, packageIds: [], lastViewedAt: at, viewCount: 0 };
    entry.packageIds.push({ packageId: String(view.packageId), viewedAt: at });
    entry.viewCount += Math.max(1, view.viewCount || 1);
    if (at > entry.lastViewedAt) entry.lastViewedAt = at;
    groups.set(groupId, entry);
  }
  for (const entry of groups.values()) entry.packageIds.sort((a, b) => b.viewedAt - a.viewedAt);
  return [...groups.values()];
}

/** Viewed packages inside the window, most interesting first. */
export function rankViewedGroups(groups, { now, config }) {
  return groups
    .filter((g) => now.getTime() - g.lastViewedAt.getTime() <= config.viewWindowMs)
    .map((g) => ({ ...g, weight: viewWeight(g, { now, halfLifeMs: config.recencyHalfLifeMs }) }))
    .sort((a, b) => b.weight - a.weight || b.lastViewedAt - a.lastViewedAt);
}

/**
 * Which live package to show for a viewed group: the variant the customer
 * actually viewed most recently if it is still live; otherwise a live sibling
 * variant (same package, different tier) flagged as an alternative; otherwise
 * null — the package is gone.
 *
 * liveVariants: live packages of this group, each { _id, ... }
 */
export function pickDisplayPackage(group, liveVariants) {
  if (!liveVariants?.length) return null;
  const liveById = new Map(liveVariants.map((p) => [String(p._id), p]));
  for (const { packageId } of group.packageIds) {
    if (liveById.has(packageId)) return { pkg: liveById.get(packageId), alternative: false };
  }
  const sorted = [...liveVariants].sort((a, b) => String(a._id).localeCompare(String(b._id)));
  return { pkg: sorted[0], alternative: true };
}

const categoriesOf = (pkg) =>
  new Set((pkg?.step1_eventAndCrew?.eventCategories || []).map((c) => String(c).trim().toLowerCase()).filter(Boolean));

/**
 * How similar `candidate` is to `anchor` — three readable rules:
 *   +3    same service category (vendorType: Decorator, Caterer, …)
 *   +0..3 share of event types in common (Jaccard of eventCategories × 3)
 *   +0..1 price closeness (min/max ratio, counted only within 2× of each other)
 * `price` is the effective package price on each object.
 */
export function similarityScore(anchor, candidate) {
  let score = 0;
  const reasons = [];
  if (anchor.vendorType && anchor.vendorType === candidate.vendorType) {
    score += 3;
    reasons.push("same_category");
  }
  const a = categoriesOf(anchor);
  const c = categoriesOf(candidate);
  if (a.size && c.size) {
    const shared = [...a].filter((x) => c.has(x)).length;
    if (shared) {
      score += (3 * shared) / new Set([...a, ...c]).size;
      reasons.push("shared_event_types");
    }
  }
  if (anchor.price > 0 && candidate.price > 0) {
    const ratio = Math.min(anchor.price, candidate.price) / Math.max(anchor.price, candidate.price);
    if (ratio >= 0.5) {
      score += ratio;
      reasons.push("similar_price");
    }
  }
  return { score, reasons };
}

/** Below this, a candidate isn't similar enough to recommend. */
export const MIN_SIMILARITY = 2;

/**
 * Top `limit` recommendations for an anchor, one variant per package, never
 * from an excluded package group (the anchor itself, booked or already
 * viewed packages). Deterministic: ties go to the closer price, then id.
 */
export function recommendSimilar(anchor, candidates, { excludeGroupIds = new Set(), limit = 3 } = {}) {
  const scored = [];
  for (const candidate of candidates) {
    const groupId = String(candidate.packageGroupId);
    if (excludeGroupIds.has(groupId) || groupId === String(anchor.packageGroupId)) continue;
    const { score, reasons } = similarityScore(anchor, candidate);
    if (score < MIN_SIMILARITY) continue;
    const priceGap = anchor.price > 0 && candidate.price > 0 ? Math.abs(anchor.price - candidate.price) : Infinity;
    scored.push({ candidate, score, reasons, priceGap });
  }
  scored.sort(
    (x, y) => y.score - x.score || x.priceGap - y.priceGap || String(x.candidate._id).localeCompare(String(y.candidate._id))
  );

  const seenGroups = new Set();
  const picked = [];
  for (const entry of scored) {
    const groupId = String(entry.candidate.packageGroupId);
    if (seenGroups.has(groupId)) continue;
    seenGroups.add(groupId);
    picked.push(entry);
    if (picked.length >= limit) break;
  }
  return picked;
}

/**
 * Customer-wide limits across every campaign, checked before any campaign is
 * considered. `forBrowsing` adds the stricter browsing-only limits.
 *
 * activity: { lastShownAt, lastDismissedAt, browsingShownLast24h }
 */
export function globalGate(activity, { now, config, forBrowsing }) {
  const t = now.getTime();
  if (activity.lastShownAt && t - new Date(activity.lastShownAt).getTime() < config.globalMinGapMs) {
    return { ok: false, reason: "global_min_gap" };
  }
  if (!forBrowsing) return { ok: true };
  if (!config.browsingEnabled) return { ok: false, reason: "browsing_disabled" };
  if (activity.lastDismissedAt && t - new Date(activity.lastDismissedAt).getTime() < config.globalDismissPauseMs) {
    return { ok: false, reason: "global_dismiss_pause" };
  }
  if ((activity.browsingShownLast24h || 0) >= config.browsingDailyCap) return { ok: false, reason: "browsing_daily_cap" };
  return { ok: true };
}
