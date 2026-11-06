import { round2 } from "../../utils/money.js";
import { byMin, pctOf, roundToStep } from "./lookup.js";

/**
 * VENDOR COMMISSION ENGINE V1 — PRD §9.
 *
 *   rate = CLAMP(CategoryBase + BandModifier + PCIModifier + LeadTimeModifier, 2%, 7%)
 *
 * Lead time is deliberately inverted vs the old model: early bookings carry
 * MORE vendor commission (calendar value), urgent bookings less.
 *
 * Rounding (§9.2) is by Vendor B2B; the 2–7% clamp is re-checked AFTER
 * rounding and the amount moved to the nearest in-bounds step if needed.
 *
 * Trial (§9.1): the first N successful bookings charge 0, but the calculated
 * amount is kept as `shadow` for the post-trial vendor report.
 */

export function commissionComponents({ category, band, pciBand, leadBucket }, rules) {
  const c = rules.commission;
  return {
    category: c.categoryBase[category],
    band: c.bandModifier[band],
    pci: c.pciModifier[pciBand],
    leadTime: leadBucket ? c.leadTimeModifier[leadBucket] : null,
  };
}

/** Commission rate range with lead time unknown (publication-time envelope). */
export function commissionEnvelope({ category, band, pciBand }, rules) {
  const c = rules.commission;
  const leadMods = Object.values(c.leadTimeModifier);
  const base = c.categoryBase[category] + c.bandModifier[band] + c.pciModifier[pciBand];
  const clamp = (x) => Math.min(c.clamp.max, Math.max(c.clamp.min, x));
  return {
    minRate: round2(clamp(base + Math.min(...leadMods))),
    maxRate: round2(clamp(base + Math.max(...leadMods))),
  };
}

function roundCommission(amount, vendorB2B, rules) {
  const c = rules.commission;
  const step = byMin(c.rounding, vendorB2B).step;
  let rounded = roundToStep(amount, step);

  const minAmt = pctOf(vendorB2B, c.clamp.min);
  const maxAmt = pctOf(vendorB2B, c.clamp.max);
  if (rounded < minAmt) rounded = Math.ceil(minAmt / step) * step;
  if (rounded > maxAmt) rounded = Math.floor(maxAmt / step) * step;
  return { step, rounded };
}

/**
 * @param {object} p  { vendorB2B, category, band, pciBand, leadBucket,
 *                      monetizationModel?, successfulBookingsCount? }
 */
export function vendorCommission(p, rules) {
  const c = rules.commission;
  const components = commissionComponents(p, rules);
  const rawRate = Object.values(components).reduce((s, x) => s + x, 0);
  const rate = Math.min(c.clamp.max, Math.max(c.clamp.min, rawRate));

  const beforeRounding = round2(pctOf(p.vendorB2B, rate));
  const { step, rounded } = roundCommission(beforeRounding, p.vendorB2B, rules);

  const inTrial =
    (p.monetizationModel ?? "TRIAL") === "TRIAL" &&
    (p.successfulBookingsCount ?? 0) < c.trialBookings;

  return {
    components,
    rawRate: round2(rawRate),
    rate: round2(rate),
    clampApplied: rawRate !== rate ? (rawRate > rate ? "MAX" : "MIN") : null,
    beforeRounding,
    afterRounding: rounded,
    roundingStep: step,
    roundingAdjustment: round2(rounded - beforeRounding),
    effectiveRate: round2((rounded / p.vendorB2B) * 100),
    inTrial,
    actual: inTrial ? 0 : rounded,
    shadow: rounded,
  };
}
