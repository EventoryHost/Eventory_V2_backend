import { round2 } from "../../utils/money.js";
import { byMin, byMax, renormalisedMean } from "./lookup.js";

/**
 * CATEGORY ENGINE — PRD §3 (Pre-Eventory score), §4 (commercial category),
 * §5 (behaviour score + blend).
 *
 * Demand is VENDOR-level; criticality is PACKAGE-level. The commercial
 * category is only ever derived from the pair, never stored as a permanent
 * vendor label.
 */

const toScore100 = (score5) => (score5 == null ? null : (score5 / 5) * 100);

function factorScore(table, value) {
  if (value == null || isNaN(value)) return null;
  return byMin(table, Number(value))?.score ?? null;
}

/**
 * @param {object} v  { bookingsLast12Months, yearsOfOperation, teamSize }
 * Missing team size is renormalised away. Missing bookings OR years ->
 * PROVISIONAL (minimum-information rule), score still returned if computable.
 */
export function preEventoryScore(v, rules) {
  const r = rules.preEventory;
  const bookings = factorScore(r.bookingsScore, v.bookingsLast12Months);
  const experience = factorScore(r.yearsScore, v.yearsOfOperation);
  const team = factorScore(r.teamScore, v.teamSize);

  const score = renormalisedMean([
    { value: toScore100(bookings), weight: r.weights.bookings },
    { value: toScore100(experience), weight: r.weights.experience },
    { value: toScore100(team), weight: r.weights.team },
  ]);

  const provisional = bookings == null || experience == null;
  return {
    factors: { bookings, experience, team },
    score: round2(score),
    provisional,
    teamSizeMissing: team == null,
  };
}

export function demandTierFromScore(score, rules) {
  if (score == null) return "PROVISIONAL";
  return byMin(rules.demandTiers, score).tier;
}

function failureScore(failurePct, table) {
  return table.find((row) => failurePct <= row.maxPct).score;
}

/**
 * Behaviour score V1 (§5.5) from the raw vendor counters (§5.2).
 * Dimensions without data are excluded and weights renormalised.
 */
export function behaviourScore(c, rules) {
  const b = rules.behaviour;
  const leads = c.qualifiedLeadsCount || 0;

  const conversion = leads
    ? byMin(b.conversionScore, (c.bookingsCount / leads) * 100).score
    : null;
  const acceptance = leads
    ? byMin(b.acceptanceScore, (c.acceptedLeadsCount / leads) * 100).score
    : null;

  let response = null;
  if (c.vendorActionRequiredCount) {
    const rateScore = Math.min(100, (c.responseCount / c.vendorActionRequiredCount) * 100);
    const timeScore =
      c.medianResponseMinutes != null
        ? byMax(b.responseTimeScore, c.medianResponseMinutes, "maxMinutes").score
        : null;
    response = renormalisedMean([
      { value: rateScore, weight: 0.5 },
      { value: timeScore, weight: 0.5 },
    ]);
  }

  // §5.7 VendorFailureRate = failures / (completed + failures)
  const failures = c.vendorAttributableFailureCount || 0;
  const completed = c.completedBookingsCount || 0;
  const reliability =
    completed + failures > 0
      ? failureScore((failures / (completed + failures)) * 100, b.failureRateScore)
      : null;

  const rating =
    (c.ratingCount || 0) >= b.minRatingCount
      ? byMin(b.ratingScore, c.ratingSum / c.ratingCount).score
      : null;

  const dims = { conversion, acceptance, response, reliability, rating };
  const score = renormalisedMean(
    Object.entries(dims).map(([k, value]) => ({ value, weight: b.weights[k] })),
  );
  return { dimensions: dims, score: round2(score) };
}

/**
 * Final vendor demand (§5.6): blends Pre-Eventory with behaviour by completed
 * Eventory bookings. Behaviour is collected from booking #1 but only weighted
 * once the sample threshold is crossed.
 */
export function vendorDemand(vendor, counters, rules) {
  const pre = preEventoryScore(vendor, rules);
  if (pre.provisional) {
    return { pre, behaviour: null, behaviourWeight: 0, score: pre.score, tier: "PROVISIONAL" };
  }

  const completed = counters?.completedBookingsCount || 0;
  const behaviourWeight = byMin(rules.behaviour.blend, completed).behaviourWeight;
  const behaviour = counters ? behaviourScore(counters, rules) : null;

  const score =
    behaviourWeight && behaviour?.score != null
      ? pre.score * (1 - behaviourWeight) + behaviour.score * behaviourWeight
      : pre.score;

  return {
    pre,
    behaviour,
    behaviourWeight: behaviour?.score != null ? behaviourWeight : 0,
    score: round2(score),
    tier: demandTierFromScore(score, rules),
  };
}

/** §4: package criticality (Eventory-approved) × vendor demand tier. */
export function commercialCategory(criticality, demandTier, rules) {
  if (demandTier === "PROVISIONAL") return null;
  return rules.categoryMatrix[criticality]?.[demandTier] ?? null;
}
