import { round2 } from "../../utils/money.js";
import { byMin, pctOf } from "./lookup.js";

/**
 * ECONOMICS ENGINE — PRD §8 MCT and MRER.
 *
 *   MCT  = MAX(BandMinimum, VendorB2B * BandTargetRate)
 *   MRER = PG + Payout + ConditionalOps + Communication + ZeroPayReserve
 *          + EventoryFundedDiscount + MCT
 *
 * MRER is a FLOOR on platform revenue, never the selling price.
 *
 * The PG cost depends on the customer total, which depends on the service
 * fee, which may itself be set by MRER. `fixedCosts` returns everything
 * except PG so the fee engine can solve that loop in closed form.
 */

export function mct(vendorB2B, band, rules) {
  const { rate, minimum } = rules.mct[band];
  return round2(Math.max(minimum, pctOf(vendorB2B, rate)));
}

export function impsPayoutFee(payoutAmount, rules) {
  return byMin(rules.costs.impsPayoutFee, Math.max(0, payoutAmount)).fee;
}

export function opsCost(bookingMode, negotiationMode, rules) {
  const c = rules.costs;
  if (!c.opsCostModes.includes(bookingMode)) return 0;
  return c.opsCost[negotiationMode] ?? 0;
}

export function zeroPayReserve(bookingMode, vendorB2B, leadBucket, rules) {
  if (bookingMode !== "ZERO_PAY_BOOK") return 0;
  return round2(pctOf(vendorB2B, rules.costs.zeroPayReservePct[leadBucket] ?? 0));
}

export function pgCost(capturedAmount, rules) {
  return round2(pctOf(capturedAmount, rules.costs.pgRatePct));
}

/** All MRER components except PG (see header). */
export function fixedCosts({ vendorB2B, band, bookingMode, negotiationMode, leadBucket, payoutAmount, eventoryDiscount = 0 }, rules) {
  const parts = {
    payout: impsPayoutFee(payoutAmount, rules) * rules.costs.payoutsPerBooking,
    ops: opsCost(bookingMode, negotiationMode, rules),
    communication: rules.costs.communicationCost,
    zeroPayReserve: zeroPayReserve(bookingMode, vendorB2B, leadBucket, rules),
    eventoryDiscount,
  };
  return { parts, variableExPg: Object.values(parts).reduce((s, x) => s + x, 0) };
}
