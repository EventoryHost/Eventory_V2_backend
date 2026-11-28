import { test } from "node:test";
import assert from "node:assert/strict";
import { retargetingConfig } from "../../src/config/retargeting.js";
import { frequencyGate } from "../../src/services/checkoutRecoveryPolicy.js";
import {
  aggregateViewsByGroup,
  chooseCampaign,
  globalGate,
  MIN_SIMILARITY,
  pickDisplayPackage,
  rankViewedGroups,
  recommendSimilar,
  similarityScore,
  viewWeight,
} from "../../src/services/retargetingPolicy.js";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-11-27T12:00:00Z");
const ago = (ms) => new Date(NOW.getTime() - ms);
const config = (env = {}) => retargetingConfig(env);

const pkg = (id, overrides = {}) => ({
  _id: id,
  packageGroupId: `g-${id}`,
  vendorType: "Decorator",
  price: 50000,
  step1_eventAndCrew: { packageName: id, eventCategories: ["Wedding", "Engagement"] },
  ...overrides,
});

test("priority: abandoned checkout > recently viewed > similar events; one popup only", () => {
  const all = { ABANDONED_CHECKOUT: { id: "a" }, RECENTLY_VIEWED: { id: "r" }, SIMILAR_EVENTS: { id: "s" } };
  assert.deepEqual(chooseCampaign(all), { campaign: "ABANDONED_CHECKOUT", id: "a" });
  assert.equal(chooseCampaign({ ABANDONED_CHECKOUT: { id: "a", campaign: "abandoned_checkout" } }).campaign, "ABANDONED_CHECKOUT");
  assert.equal(chooseCampaign({ RECENTLY_VIEWED: { id: "r" }, SIMILAR_EVENTS: { id: "s" } }).campaign, "RECENTLY_VIEWED");
  assert.equal(chooseCampaign({ SIMILAR_EVENTS: { id: "s" } }).campaign, "SIMILAR_EVENTS");
  assert.equal(chooseCampaign({}), null);
});

test("interest weight: recency decays, repeat visits add weight", () => {
  const opts = { now: NOW, halfLifeMs: 72 * HOUR };
  assert.equal(viewWeight({ lastViewedAt: NOW, viewCount: 1 }, opts), 1);
  assert.equal(viewWeight({ lastViewedAt: ago(72 * HOUR), viewCount: 1 }, opts), 0.5);
  assert.equal(viewWeight({ lastViewedAt: NOW, viewCount: 4 }, opts), 3);
  // Viewed 4 times 3 days ago beats once just now.
  assert.ok(viewWeight({ lastViewedAt: ago(72 * HOUR), viewCount: 4 }, opts) > viewWeight({ lastViewedAt: NOW, viewCount: 1 }, opts));
});

test("variants of one package count as one interest", () => {
  const groupOf = new Map([
    ["basic", "wedding-decor"],
    ["premium", "wedding-decor"],
    ["dj", "dj-night"],
  ]);
  const groups = aggregateViewsByGroup(
    [
      { packageId: "basic", viewedAt: ago(2 * HOUR), viewCount: 1 },
      { packageId: "premium", viewedAt: ago(1 * HOUR), viewCount: 2 },
      { packageId: "dj", viewedAt: ago(3 * HOUR) },
      { packageId: "deleted-package", viewedAt: ago(HOUR) },
    ],
    groupOf
  );
  const decor = groups.find((g) => g.groupId === "wedding-decor");
  assert.equal(groups.length, 2, "deleted packages are dropped");
  assert.equal(decor.viewCount, 3);
  assert.equal(decor.packageIds[0].packageId, "premium", "most recent variant first");
  assert.deepEqual(decor.lastViewedAt, ago(HOUR));
});

test("recently viewed: ranked by weight, outside the window dropped, missing history is empty", () => {
  const ranked = rankViewedGroups(
    [
      { groupId: "old", packageIds: [], lastViewedAt: ago(20 * 24 * HOUR), viewCount: 9 },
      { groupId: "once", packageIds: [], lastViewedAt: ago(HOUR), viewCount: 1 },
      { groupId: "often", packageIds: [], lastViewedAt: ago(2 * HOUR), viewCount: 4 },
    ],
    { now: NOW, config: config() }
  );
  assert.deepEqual(ranked.map((g) => g.groupId), ["often", "once"]);
  assert.deepEqual(rankViewedGroups([], { now: NOW, config: config() }), []);
});

test("unavailable: viewed tier gone → a live sibling tier is offered as an alternative; whole package gone → null", () => {
  const group = { packageIds: [{ packageId: "premium" }, { packageId: "basic" }] };
  assert.deepEqual(pickDisplayPackage(group, [{ _id: "premium" }, { _id: "basic" }]), { pkg: { _id: "premium" }, alternative: false });
  assert.deepEqual(pickDisplayPackage(group, [{ _id: "basic" }]), { pkg: { _id: "basic" }, alternative: false });
  assert.deepEqual(pickDisplayPackage({ packageIds: [{ packageId: "premium" }] }, [{ _id: "deluxe" }]), {
    pkg: { _id: "deluxe" },
    alternative: true,
  });
  assert.equal(pickDisplayPackage(group, []), null);
});

test("similarity: same category + shared event types + close price, with readable reasons", () => {
  const anchor = pkg("anchor");
  const twin = similarityScore(anchor, pkg("twin"));
  assert.equal(twin.score, 7);
  assert.deepEqual(twin.reasons, ["same_category", "shared_event_types", "similar_price"]);
  const otherCategory = similarityScore(anchor, pkg("caterer", { vendorType: "Caterer", step1_eventAndCrew: { eventCategories: ["Birthday"] } }));
  assert.equal(otherCategory.score < MIN_SIMILARITY, true);
  const pricey = similarityScore(anchor, pkg("pricey", { price: 500000 }));
  assert.equal(pricey.reasons.includes("similar_price"), false);
});

test("similar events: excludes anchor, booked/viewed groups, one variant per package, deterministic order", () => {
  const anchor = pkg("anchor", { packageGroupId: "g-anchor" });
  const candidates = [
    pkg("anchor-sibling", { packageGroupId: "g-anchor" }),
    pkg("booked", { packageGroupId: "g-booked" }),
    pkg("best-a", { packageGroupId: "g-best", price: 50000 }),
    pkg("best-b", { packageGroupId: "g-best", price: 52000 }),
    pkg("close", { packageGroupId: "g-close", price: 45000 }),
    pkg("far", { packageGroupId: "g-far", price: 90000 }),
    pkg("unrelated", { packageGroupId: "g-x", vendorType: "DJ", step1_eventAndCrew: { eventCategories: ["Corporate"] } }),
  ];
  const picks = recommendSimilar(anchor, candidates, { excludeGroupIds: new Set(["g-booked"]), limit: 3 });
  assert.deepEqual(picks.map((p) => p.candidate._id), ["best-a", "close", "far"]);
  assert.deepEqual(recommendSimilar(anchor, [], {}), []);
});

test("frequency: per-campaign caps are the shared gate (same rules as checkout recovery)", () => {
  const c = config();
  const fresh = { impressions: { count: 0 }, dismissals: { count: 0 } };
  assert.equal(frequencyGate(fresh, { now: NOW, config: c }).ok, true);
  assert.equal(frequencyGate({ ...fresh, impressions: { count: 1, lastShownAt: ago(HOUR) } }, { now: NOW, config: c }).reason, "impression_cooldown");
  assert.equal(frequencyGate({ ...fresh, impressions: { count: 2, lastShownAt: ago(48 * HOUR) } }, { now: NOW, config: c }).retire, true);
  assert.equal(frequencyGate({ ...fresh, dismissals: { count: 1, lastDismissedAt: ago(500 * HOUR) } }, { now: NOW, config: c }).retire, true);
});

test("frequency: customer-wide gap, pause after any dismissal, daily browsing cap", () => {
  const c = config();
  const quiet = { lastShownAt: null, lastDismissedAt: null, browsingShownLast24h: 0 };
  assert.equal(globalGate(quiet, { now: NOW, config: c, forBrowsing: true }).ok, true);
  assert.equal(globalGate({ ...quiet, lastShownAt: ago(5 * 60 * 1000) }, { now: NOW, config: c, forBrowsing: false }).reason, "global_min_gap");
  // A dismissal pauses browsing popups but not abandoned checkout.
  const dismissed = { ...quiet, lastDismissedAt: ago(HOUR) };
  assert.equal(globalGate(dismissed, { now: NOW, config: c, forBrowsing: false }).ok, true);
  assert.equal(globalGate(dismissed, { now: NOW, config: c, forBrowsing: true }).reason, "global_dismiss_pause");
  assert.equal(globalGate({ ...quiet, browsingShownLast24h: 3 }, { now: NOW, config: c, forBrowsing: true }).reason, "browsing_daily_cap");
  assert.equal(globalGate(quiet, { now: NOW, config: config({ RETARGETING_BROWSING_ENABLED: "false" }), forBrowsing: true }).reason, "browsing_disabled");
});
