import { round2 } from "../../utils/money.js";
import { byMin, pctOf } from "./lookup.js";

/**
 * ROUND-OFF & MERCHANDISING — PRD §11.
 *
 * 1. The economically valid customer total is computed first (unrounded).
 * 2. An attractive price point is picked inside the corridor
 *    |adjustment| <= 1% of Vendor B2B:
 *      - fixed-price modes: retail endings by ticket size (…99 / …499 / …999)
 *      - ENQUIRE_QUOTE: clean event-industry steps (…,500 / …,000)
 *    The NEAREST valid point wins. A lower point is valid only if the
 *    back-solved fee still clears the minimum (MRER economic floor + mode
 *    floor); a higher one only if it stays within the mode ceiling.
 * 3. The taxable Eventory fee is BACK-SOLVED so
 *      VendorService + VendorGST + EventoryFee + GST(EventoryFee) - Discount = point
 *    — the round-off lives inside the legally invoiced fee, never as an
 *    unexplained markup line.
 * No valid point in the corridor -> the total is kept, rounded to the rupee.
 */

function candidatePoints(lo, hi, bookingMode, rules) {
  const m = rules.merchandising;
  const points = [];
  if (bookingMode === "ENQUIRE_QUOTE") {
    for (let p = Math.ceil(lo / m.quoteStep) * m.quoteStep; p <= hi; p += m.quoteStep) points.push(p);
    return points;
  }
  // Ending tier is chosen per point, so a corridor straddling 10K/50K works.
  for (let base = Math.floor(lo / 100) * 100; base <= hi + 100; base += 100) {
    const p = base + 99;
    if (p < lo || p > hi) continue;
    const tier = byMin(m.fixedPriceEndings, p);
    if (tier.endings.includes(p % tier.modulus)) points.push(p);
  }
  return points;
}

export function backSolveFee(point, { vendorB2B, vendorGst, eventoryDiscount = 0 }, rules) {
  const g = rules.tax.gstOnServiceFeePct / 100;
  const gross = point - vendorB2B - vendorGst + eventoryDiscount;
  const taxable = round2(gross / (1 + g));
  return { taxableFee: taxable, gstOnFee: round2(gross - taxable) };
}

/**
 * @param {object} p { unroundedTotal, vendorB2B, vendorGst, eventoryDiscount,
 *                     bookingMode, minFee, maxFee }
 */
export function merchandise(p, rules) {
  const corridor = pctOf(p.vendorB2B, rules.merchandising.corridorPctOfB2B);
  const U = p.unroundedTotal;
  const valid = (point) => {
    const { taxableFee } = backSolveFee(point, p, rules);
    return taxableFee >= p.minFee - 0.005 && taxableFee <= p.maxFee + 0.005;
  };

  const points = candidatePoints(U - corridor, U + corridor, p.bookingMode, rules);
  const lower = points.filter((x) => x <= U && valid(x)).sort((a, b) => b - a)[0];
  const higher = points.filter((x) => x > U && valid(x)).sort((a, b) => a - b)[0];

  let displayPrice;
  let strategy;
  if (lower != null && (higher == null || U - lower <= higher - U)) {
    displayPrice = lower;
    strategy = "ROUNDED_DOWN";
  } else if (higher != null) {
    displayPrice = higher;
    strategy = "ROUNDED_UP";
  } else {
    displayPrice = Math.ceil(U);
    strategy = "NO_POINT_IN_CORRIDOR";
  }

  const { taxableFee, gstOnFee } = backSolveFee(displayPrice, p, rules);
  return {
    corridor: round2(corridor),
    unroundedTotal: round2(U),
    displayPrice,
    adjustment: round2(displayPrice - U),
    strategy,
    taxableFee,
    gstOnFee,
  };
}
