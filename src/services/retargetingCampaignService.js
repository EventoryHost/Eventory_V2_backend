import mongoose from "mongoose";
import RetargetingCampaign from "../models/RetargetingCampaign.js";
import CheckoutRecovery from "../models/CheckoutRecovery.js";
import ViewedItem from "../models/ViewedItem.js";
import Package from "../models/Package.js";
import Booking from "../models/Booking.js";
import CommercialEvent from "../models/CommercialEvent.js";
import { retargetingConfig } from "../config/retargeting.js";
import { getPromptForCustomer as getCheckoutRecoveryPrompt } from "./checkoutRecoveryService.js";
import { frequencyGate } from "./checkoutRecoveryPolicy.js";
import {
  aggregateViewsByGroup,
  chooseCampaign,
  globalGate,
  pickDisplayPackage,
  rankViewedGroups,
  recommendSimilar,
} from "./retargetingPolicy.js";
import { packageCoverImage } from "../utils/packageCoverImage.js";
import { getEffectivePackagePrice } from "../utils/packagePrice.js";
import { visibleVendorIdClause } from "../utils/customerVisibility.js";

/**
 * Unified personalized retargeting — picks the ONE popup a customer should
 * see, in priority order:
 *   1. ABANDONED_CHECKOUT — delegated unchanged to checkoutRecoveryService
 *   2. RECENTLY_VIEWED    — a package they viewed but didn't start checkout for
 *   3. SIMILAR_EVENTS     — related packages, based on what they viewed
 *
 * Boundaries:
 *   - Checkout recovery business logic stays in checkoutRecoveryService; this
 *     file only decides whether it wins and applies the customer-wide limits.
 *   - Browsing history is read from ViewedItem (the existing tracking); this
 *     file never copies it anywhere.
 *   - Every query is scoped to the authenticated customer's _id.
 *   - Never writes Booking, Payment or CheckoutSession.
 */

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id));
const DAY = 24 * 60 * 60 * 1000;
// Bookings in these states never happened, so the package can be suggested again.
const NOT_BOOKED_STATUSES = ["Cancelled", "Declined"];

const PACKAGE_FIELDS =
  "packageGroupId variantType vendorId vendorType packageStatus deletedAt " +
  "step1_eventAndCrew.packageName step1_eventAndCrew.eventCategories " +
  "step2_productsAndPricing.setups step3_policiesAndCharges.packagePricing " +
  "step3_policiesAndCharges.teamAndEquipment step3_policiesAndCharges.overallPriceOfPackage step4_sampleMedia";

const withPrice = (pkg) => ({ ...pkg, price: getEffectivePackagePrice(pkg) || 0 });

function toItem(pkg) {
  return {
    packageId: String(pkg._id),
    name: pkg.step1_eventAndCrew?.packageName || null,
    image: packageCoverImage(pkg),
    vendorType: pkg.vendorType || null,
    variantType: pkg.variantType || null,
    eventCategories: (pkg.step1_eventAndCrew?.eventCategories || []).slice(0, 3),
    // Current live price, shown as "from" — browsing popups only link to the
    // package page; nothing here is a price promise.
    startingPrice: getEffectivePackagePrice(pkg) || null,
  };
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/** Latest popup shown/dismissed across ALL campaigns, plus browsing volume. */
async function customerActivity(customerId, now) {
  const [lastRecoveryShown, lastRecoveryDismissed, lastCampaignShown, lastCampaignDismissed, browsingShownLast24h] =
    await Promise.all([
      CheckoutRecovery.findOne({ customerId, "impressions.lastShownAt": { $ne: null } })
        .sort({ "impressions.lastShownAt": -1 })
        .select("impressions.lastShownAt")
        .lean(),
      CheckoutRecovery.findOne({ customerId, "dismissals.lastDismissedAt": { $ne: null } })
        .sort({ "dismissals.lastDismissedAt": -1 })
        .select("dismissals.lastDismissedAt")
        .lean(),
      RetargetingCampaign.findOne({ customerId, "impressions.lastShownAt": { $ne: null } })
        .sort({ "impressions.lastShownAt": -1 })
        .select("impressions.lastShownAt")
        .lean(),
      RetargetingCampaign.findOne({ customerId, "dismissals.lastDismissedAt": { $ne: null } })
        .sort({ "dismissals.lastDismissedAt": -1 })
        .select("dismissals.lastDismissedAt")
        .lean(),
      RetargetingCampaign.countDocuments({ customerId, "impressions.lastShownAt": { $gte: new Date(now.getTime() - DAY) } }),
    ]);
  const latest = (...dates) => dates.filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a)[0] || null;
  return {
    lastShownAt: latest(lastRecoveryShown?.impressions?.lastShownAt, lastCampaignShown?.impressions?.lastShownAt),
    lastDismissedAt: latest(lastRecoveryDismissed?.dismissals?.lastDismissedAt, lastCampaignDismissed?.dismissals?.lastDismissedAt),
    browsingShownLast24h,
  };
}

async function groupsForPackageIds(packageIds) {
  const ids = [...new Set(packageIds.map(String).filter(isObjectId))];
  if (!ids.length) return new Map();
  const rows = await Package.find({ _id: { $in: ids } }).select("packageGroupId").lean();
  return new Map(rows.map((p) => [String(p._id), String(p.packageGroupId)]));
}

/** Package groups this customer has booked (any booking not cancelled/declined). */
async function bookedGroupIds(customerId) {
  const bookings = await Booking.find({ customerId, status: { $nin: NOT_BOOKED_STATUSES } })
    .select("packageId packageGroupId")
    .lean();
  const groups = new Set(bookings.map((b) => b.packageGroupId).filter(Boolean).map(String));
  const byPackage = await groupsForPackageIds(bookings.map((b) => b.packageId).filter(Boolean));
  for (const g of byPackage.values()) groups.add(g);
  return groups;
}

/** Package groups this customer started checkout for — abandoned checkout's territory. */
async function checkoutStartedGroupIds(customerId, since) {
  const [events, recoveries] = await Promise.all([
    CommercialEvent.find({ type: "CHECKOUT_STARTED", customerId, at: { $gte: since } }).select("packageId").lean(),
    CheckoutRecovery.find({ customerId, updatedAt: { $gte: since } }).select("items.packageId").lean(),
  ]);
  const ids = [...events.map((e) => e.packageId), ...recoveries.flatMap((r) => (r.items || []).map((i) => i.packageId))];
  return new Set((await groupsForPackageIds(ids.filter(Boolean))).values());
}

/**
 * Everything the browsing campaigns need, in one pass: ranked viewed groups
 * with their live display package (or null if gone), and the exclusions.
 */
async function browsingFacts(customerId, { now, config }) {
  const since = new Date(now.getTime() - config.viewWindowMs);
  const views = await ViewedItem.find({ customerId, viewedAt: { $gte: since } })
    .sort({ viewedAt: -1 })
    .limit(50)
    .select("packageId viewedAt viewCount")
    .lean();
  if (!views.length) return null;

  const viewedPackages = await Package.find({ _id: { $in: views.map((v) => v.packageId).filter(isObjectId) } })
    .select(PACKAGE_FIELDS)
    .lean();
  const packageById = new Map(viewedPackages.map((p) => [String(p._id), p]));
  const groupOf = new Map(viewedPackages.map((p) => [String(p._id), String(p.packageGroupId)]));
  const ranked = rankViewedGroups(aggregateViewsByGroup(views, groupOf), { now, config });
  if (!ranked.length) return null;

  const groupIds = ranked.map((g) => g.groupId);
  const [liveVariants, booked, checkoutStarted] = await Promise.all([
    Package.find({
      packageGroupId: { $in: groupIds },
      packageStatus: "Live",
      deletedAt: null,
      ...(await visibleVendorIdClause()),
    })
      .select(PACKAGE_FIELDS)
      .lean(),
    bookedGroupIds(customerId),
    checkoutStartedGroupIds(customerId, since),
  ]);
  const liveByGroup = new Map();
  for (const p of liveVariants) {
    const key = String(p.packageGroupId);
    liveByGroup.set(key, [...(liveByGroup.get(key) || []), p]);
  }

  const groups = ranked
    .filter((g) => !booked.has(g.groupId)) // already booked: never retarget
    .map((g) => ({
      ...g,
      viewedPackage: packageById.get(g.packageIds[0].packageId),
      display: pickDisplayPackage(g, liveByGroup.get(g.groupId)),
      checkoutStarted: checkoutStarted.has(g.groupId),
    }));

  return { groups, booked, viewedGroupIds: new Set(groupIds) };
}

async function openRecord(customerId, campaign, group, now, config) {
  const key = { customerId, campaign, anchorPackageGroupId: group.groupId };
  const existing = await RetargetingCampaign.findOne(key);
  if (existing) return existing;
  try {
    return await RetargetingCampaign.create({
      ...key,
      anchorPackageId: group.packageIds[0].packageId,
      purgeAt: new Date(now.getTime() + config.retentionMs),
    });
  } catch (err) {
    if (err?.code === 11000) return RetargetingCampaign.findOne(key);
    throw err;
  }
}

/** Status + per-campaign caps; retires a record that hit a lifetime cap. */
async function recordAllows(record, { now, config }) {
  if (record.status !== "Open") return false;
  const gate = frequencyGate(record, { now, config });
  if (gate.retire) {
    await RetargetingCampaign.updateOne(
      { _id: record._id, status: "Open" },
      { $set: { status: "Retired", statusReason: gate.reason, statusChangedAt: now } }
    );
  }
  return gate.ok;
}

async function finalize(record, packageIds, now, config) {
  await RetargetingCampaign.updateOne(
    { _id: record._id },
    { $set: { shownPackageIds: packageIds, purgeAt: new Date(now.getTime() + config.retentionMs) } }
  );
}

// ---------------------------------------------------------------------------
// Campaign builders
// ---------------------------------------------------------------------------

async function recentlyViewedCandidate(customerId, facts, { now, config }) {
  for (const group of facts.groups) {
    if (!group.display || group.checkoutStarted) continue;
    // Still on it (or just left it): let them finish looking first.
    if (now.getTime() - group.lastViewedAt.getTime() < config.viewSettleMs) continue;

    const record = await openRecord(customerId, "RECENTLY_VIEWED", group, now, config);
    if (!(await recordAllows(record, { now, config }))) continue;

    const item = toItem(group.display.pkg);
    await finalize(record, [item.packageId], now, config);
    return {
      id: String(record._id),
      anchor: {
        packageId: group.packageIds[0].packageId,
        name: group.viewedPackage?.step1_eventAndCrew?.packageName || item.name,
        available: true,
        // The exact tier they viewed is gone; a sibling tier of the same package is shown.
        alternative: group.display.alternative,
        viewCount: group.viewCount,
        lastViewedAt: group.lastViewedAt,
      },
      items: [item],
    };
  }
  return null;
}

async function similarCandidate(customerId, facts, { now, config }) {
  const visible = await visibleVendorIdClause();
  // Top few anchors only — each one is a candidate query.
  for (const group of facts.groups.slice(0, 3)) {
    const anchorPkg = group.display?.pkg || group.viewedPackage;
    if (!anchorPkg) continue;
    if (now.getTime() - group.lastViewedAt.getTime() < config.viewSettleMs) continue;

    const record = await openRecord(customerId, "SIMILAR_EVENTS", group, now, config);
    if (!(await recordAllows(record, { now, config }))) continue;

    const anchor = withPrice(anchorPkg);
    const categories = anchor.step1_eventAndCrew?.eventCategories || [];
    const candidates = await Package.find({
      packageStatus: "Live",
      deletedAt: null,
      ...visible,
      packageGroupId: { $nin: [...facts.booked, ...facts.viewedGroupIds] },
      $or: [{ vendorType: anchor.vendorType }, ...(categories.length ? [{ "step1_eventAndCrew.eventCategories": { $in: categories } }] : [])],
    })
      .select(PACKAGE_FIELDS)
      .limit(300)
      .lean();

    const picks = recommendSimilar(anchor, candidates.map(withPrice), {
      excludeGroupIds: new Set([...facts.booked, ...facts.viewedGroupIds]),
      limit: config.similarLimit,
    });
    if (!picks.length) continue;

    const items = picks.map((p) => ({ ...toItem(p.candidate), matchReasons: p.reasons }));
    await finalize(record, items.map((i) => i.packageId), now, config);
    return {
      id: String(record._id),
      anchor: {
        packageId: String(anchorPkg._id),
        name: anchorPkg.step1_eventAndCrew?.packageName || null,
        // false = the package they viewed is no longer offered; these are the alternatives.
        available: Boolean(group.display),
        vendorType: anchorPkg.vendorType || null,
        eventCategories: categories.slice(0, 3),
      },
      items,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Customer-facing operations
// ---------------------------------------------------------------------------

/** The one retargeting popup (any campaign type) to show this customer now, or null. */
export async function selectCampaignForCustomer(customerId, { now = new Date() } = {}) {
  customerId = String(customerId);
  const config = retargetingConfig();
  const activity = await customerActivity(customerId, now);

  if (!globalGate(activity, { now, config, forBrowsing: false }).ok) return null;

  const checkout = await getCheckoutRecoveryPrompt(customerId, { now });
  if (checkout) return chooseCampaign({ ABANDONED_CHECKOUT: checkout });

  if (!globalGate(activity, { now, config, forBrowsing: true }).ok) return null;

  const facts = await browsingFacts(customerId, { now, config });
  if (!facts?.groups.length) return null; // no browsing history: nothing to say

  const recentlyViewed = await recentlyViewedCandidate(customerId, facts, { now, config });
  if (recentlyViewed) return chooseCampaign({ RECENTLY_VIEWED: recentlyViewed });

  const similar = await similarCandidate(customerId, facts, { now, config });
  return chooseCampaign({ SIMILAR_EVENTS: similar });
}

async function findOwned(customerId, campaignId) {
  if (!isObjectId(campaignId)) return null;
  return RetargetingCampaign.findOne({ _id: campaignId, customerId: String(customerId) });
}

/** The popup was rendered. Counted at most once per cooldown window. */
export async function recordImpression(customerId, campaignId, { now = new Date() } = {}) {
  const record = await findOwned(customerId, campaignId);
  if (!record) return { error: { status: 404, message: "Campaign not found" } };
  if (record.status !== "Open") return { ok: true };
  const config = retargetingConfig();
  const cutoff = new Date(now.getTime() - config.impressionCooldownMs);
  await RetargetingCampaign.updateOne(
    { _id: record._id, status: "Open", $or: [{ "impressions.lastShownAt": null }, { "impressions.lastShownAt": { $lte: cutoff } }] },
    { $inc: { "impressions.count": 1 }, $set: { "impressions.lastShownAt": now } }
  );
  return { ok: true };
}

/** "Not now". Retires the campaign once the dismissal cap is reached. */
export async function dismiss(customerId, campaignId, { now = new Date() } = {}) {
  const record = await findOwned(customerId, campaignId);
  if (!record) return { error: { status: 404, message: "Campaign not found" } };
  if (record.status !== "Open") return { ok: true };
  const config = retargetingConfig();
  const updated = await RetargetingCampaign.findOneAndUpdate(
    { _id: record._id, status: "Open" },
    { $inc: { "dismissals.count": 1 }, $set: { "dismissals.lastDismissedAt": now } },
    { returnDocument: "after" }
  );
  if (updated && updated.dismissals.count >= config.maxDismissals) {
    await RetargetingCampaign.updateOne(
      { _id: updated._id, status: "Open" },
      { $set: { status: "Retired", statusReason: "dismissed_max", statusChangedAt: now } }
    );
  }
  return { ok: true };
}

/** "Explore Event" / a recommendation was clicked. Only a package the popup showed is recorded. */
export async function recordClick(customerId, campaignId, packageId, { now = new Date() } = {}) {
  const record = await findOwned(customerId, campaignId);
  if (!record) return { error: { status: 404, message: "Campaign not found" } };
  const shown = packageId && record.shownPackageIds.includes(String(packageId)) ? String(packageId) : null;
  await RetargetingCampaign.updateOne(
    { _id: record._id },
    { $inc: { "ctaClicks.count": 1 }, $set: { "ctaClicks.lastClickedAt": now, "ctaClicks.lastPackageId": shown } }
  );
  return { ok: true };
}

/**
 * Conversion attribution — called when a checkout session is set Completed
 * (server-side, after payment verification; see CheckoutSession.js). A shown
 * browsing campaign whose package (or a sibling variant) was just booked is
 * marked Converted.
 */
export async function recordConversionFromCheckout(session, { now = new Date() } = {}) {
  if (session?.status !== "Completed" || !session.customerId) return;
  const customerId = String(session.customerId);
  const packageIds = (session.lines || []).map((l) => String(l.packageId));
  const groupIds = [
    ...new Set([
      ...(session.lines || []).map((l) => l.packageGroupId).filter(Boolean).map(String),
      ...(await groupsForPackageIds(packageIds)).values(),
    ]),
  ];

  const matches = await RetargetingCampaign.find({
    customerId,
    status: "Open",
    "impressions.count": { $gt: 0 },
    $or: [{ anchorPackageGroupId: { $in: groupIds } }, { shownPackageIds: { $in: packageIds } }],
  });
  for (const record of matches) {
    const bought = packageIds.find((id) => record.shownPackageIds.includes(id)) || packageIds[0];
    await RetargetingCampaign.updateOne(
      { _id: record._id, status: "Open" },
      {
        $set: {
          status: "Converted",
          statusReason: "booked",
          statusChangedAt: now,
          convertedAt: now,
          convertedCheckoutSessionId: String(session._id),
          convertedPackageId: bought,
          convertedAfterClick: (record.ctaClicks?.count || 0) > 0,
        },
      }
    );
  }
}
