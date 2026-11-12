import { round2 } from "../../utils/money.js";
import { pctOf } from "./lookup.js";

/**
 * EVENTORY SERVICE FEE ENGINE V1 — PRD §10.
 *
 *   CommercialRate = BandBase + CategoryAccess + BookingMode + LeadTime + Negotiation
 *   CommercialFee  = VendorB2B * CommercialRate
 *   EconomicFloor  = MAX(0, MRER - VendorCommissionRevenue)
 *   Candidate      = MAX(CommercialFee, EconomicFloor)
 *
 * then the booking-mode floor/ceiling (§10.6):
 *   - below mode floor            -> raised to the floor
 *   - commercial rate above ceiling -> capped at the ceiling (not needed economically)
 *   - ECONOMIC floor above ceiling  -> REVIEW_REQUIRED, never silently charged
 *
 * Bands listed in rules.serviceFee.ceilingExemptBands (MICRO) have no
 * ceiling at all — a business override of §10.6, see rules.v1.js.
 *
 * Weak PCI (§10.7): fee = MAX(EconomicFloor, mode floor) — the customer is not
 * made to pay for a weak vendor B2B.
 *
 * All rates are % of Vendor B2B. The fee is the TAXABLE Eventory fee; GST on
 * it is added separately.
 */

export function feeComponents({ band, category, bookingMode, leadBucket, negotiationMode }, rules) {
  const f = rules.serviceFee;
  return {
    band: f.bandBase[band],
    category: f.categoryModifier[category],
    bookingMode: f.bookingModeModifier[bookingMode],
    leadTime: f.leadTimeModifier[leadBucket],
    negotiation: f.negotiationModifier[negotiationMode],
  };
}

/**
 * Smallest fee F so that platform revenue covers MRER, with PG charged on the
 * customer total that F itself produces:
 *   F + C = MCT + fixed + pg * (B + vendorGst - discount + F * (1 + g))
 */
export function economicFloor({ vendorB2B, vendorGst, eventoryDiscount = 0, commissionRevenue, mct, variableExPg }, rules) {
  const pg = rules.costs.pgRatePct / 100;
  const g = rules.tax.gstOnServiceFeePct / 100;
  const numerator =
    mct + variableExPg + pg * (vendorB2B + vendorGst - eventoryDiscount) - commissionRevenue;
  return round2(Math.max(0, numerator / (1 - pg * (1 + g))));
}

export function serviceFee(p, rules) {
  const { vendorB2B, bookingMode, pciBand } = p;
  const limits = rules.serviceFee.modeLimits[bookingMode];
  const components = feeComponents(p, rules);
  const commercialRate = Object.values(components).reduce((s, x) => s + x, 0);
  const commercialFee = round2(pctOf(vendorB2B, commercialRate));
  const floorFee = economicFloor(p, rules);
  const modeFloorFee = round2(pctOf(vendorB2B, limits.floor));
  const ceilingExempt = (rules.serviceFee.ceilingExemptBands ?? []).includes(p.band);
  const modeCeilingFee = ceilingExempt ? Infinity : round2(pctOf(vendorB2B, limits.ceiling));

  const weakPci = pciBand === "WEAK";
  let fee;
  let floorApplied = false;
  let ceilingApplied = false;

  if (weakPci) {
    fee = Math.max(floorFee, modeFloorFee);
    floorApplied = fee === modeFloorFee && modeFloorFee > floorFee;
  } else {
    const cappedCommercial = Math.min(commercialFee, modeCeilingFee);
    ceilingApplied = commercialFee > modeCeilingFee;
    fee = Math.max(cappedCommercial, floorFee);
    if (fee < modeFloorFee) {
      fee = modeFloorFee;
      floorApplied = true;
    }
  }

  const ceilingBreach = floorFee > modeCeilingFee;

  return {
    components,
    commercialRate: round2(commercialRate),
    commercialFee,
    economicFloor: floorFee,
    modeFloorFee,
    modeCeilingFee,
    weakPciMode: weakPci,
    winner: weakPci
      ? "WEAK_PCI_MINIMUM"
      : floorApplied
        ? "MODE_FLOOR"
        : fee === floorFee && floorFee > commercialFee
          ? "ECONOMIC_FLOOR"
          : "COMMERCIAL",
    floorApplied,
    ceilingApplied,
    ceilingBreach,
    fee: round2(fee),
    rate: round2((fee / vendorB2B) * 100),
  };
}
