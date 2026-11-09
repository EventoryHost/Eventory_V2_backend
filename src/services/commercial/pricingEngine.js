import { round2 } from "../../utils/money.js";
import { RULES_V1 } from "./rules.v1.js";
import { pctOf } from "./lookup.js";
import { packageBand, bandAtLeast, cpci, leadTimeBucket, daysToEvent as computeDaysToEvent } from "./marketEngine.js";
import { mct as computeMct, fixedCosts, pgCost } from "./economicsEngine.js";
import { vendorCommission } from "./commissionEngine.js";
import { serviceFee } from "./serviceFeeEngine.js";
import { merchandise } from "./merchandisingEngine.js";

/**
 * RUNTIME PRICING — PRD §14 steps 11–19.
 *
 * A package never stores one permanent customer price. Publication fixes a
 * commercial BASELINE (category, PCI band, B2B, benchmark); this engine turns
 * baseline + a specific customer event (date, booking mode, negotiation,
 * customer Zero-Pay history, discount) into one valid transaction price.
 *
 * Pure: no DB, no I/O. Same input + same rule set -> same output.
 *
 * Input:
 *   vendor   { gstRegistered, gstRatePct, monetizationModel, successfulBookingsCount }
 *   baseline { vendorB2B, category, pciBand, marketMedian, supportedModes[] }
 *   runtime  { bookingMode, negotiationMode, daysToEvent | (eventDate, bookingDate),
 *              eventoryDiscount, customer{ loggedIn, outstandingBalance,
 *              activeZeroPayBookings, completedBookings } }
 *
 * Output: commission, settlement, MRER, service fee (with every decision
 * component), merchandised customer price, CPCI, contribution, guardrail
 * status + reason codes, and the rule versions used.
 */

export function vendorSettlement({ vendorB2B, vendorGst, gstRegistered, commission }, rules) {
  const gstOnCommission = round2(pctOf(commission, rules.tax.gstOnCommissionPct));
  const tcs = gstRegistered ? round2(pctOf(vendorB2B, rules.tax.tcsPctRegisteredVendor)) : 0;
  const vendorInvoiceValue = round2(vendorB2B + vendorGst);
  return {
    vendorServiceValue: vendorB2B,
    vendorGst,
    vendorInvoiceValue,
    commission,
    gstOnCommission,
    tcs,
    settlement: round2(vendorInvoiceValue - commission - gstOnCommission - tcs),
  };
}

function modeAvailability({ bookingMode, band, supportedModes, customer }, rules) {
  const reasons = [];
  if (supportedModes && !supportedModes.includes(bookingMode)) reasons.push("MODE_NOT_SUPPORTED");
  if (bookingMode === "ENQUIRE_QUOTE" && !bandAtLeast(band, rules.quoteMinBand, rules)) {
    reasons.push("QUOTE_BELOW_CORE");
  }
  if (bookingMode === "ZERO_PAY_BOOK" && customer) {
    if (!customer.loggedIn) reasons.push("ZERO_PAY_LOGIN_REQUIRED");
    if ((customer.outstandingBalance ?? 0) > 0) reasons.push("ZERO_PAY_OUTSTANDING_BALANCE");
    const isNew = (customer.completedBookings ?? 0) === 0;
    if (isNew && (customer.activeZeroPayBookings ?? 0) >= rules.zeroPay.maxActiveForNewCustomer) {
      reasons.push("ZERO_PAY_ACTIVE_LIMIT");
    }
  }
  return reasons;
}

export function priceLine({ vendor = {}, baseline, runtime }, rules = RULES_V1) {
  const { vendorB2B, category, pciBand = "NOT_AVAILABLE", marketMedian, supportedModes } = baseline;
  const { bookingMode, negotiationMode = "NONE", eventoryDiscount = 0, customer } = runtime;
  const isFixed = rules.fixedPriceModes.includes(bookingMode);

  const days =
    runtime.daysToEvent ?? (runtime.eventDate ? computeDaysToEvent(runtime.eventDate, runtime.bookingDate) : null);
  const band = vendorB2B > 0 ? packageBand(vendorB2B, rules) : null;
  const leadBucket = leadTimeBucket(days, rules);

  const base = {
    versions: rules.versions,
    inputs: { vendorB2B, category, pciBand, band, bookingMode, negotiationMode, daysToEvent: days, leadBucket },
  };

  // Hard stops: nothing can be priced without these.
  const missing = [];
  if (!band) missing.push("MISSING_B2B");
  if (!category) missing.push("CATEGORY_UNAVAILABLE");
  if (!leadBucket) missing.push("MISSING_EVENT_DATE");
  if (missing.length) {
    return { ...base, status: "REVIEW_REQUIRED", reasonCodes: missing };
  }

  const unavailable = modeAvailability({ bookingMode, band, supportedModes, customer }, rules);

  // Step 12 — vendor commission
  const commission = vendorCommission(
    {
      vendorB2B,
      category,
      band,
      pciBand,
      leadBucket,
      monetizationModel: vendor.monetizationModel,
      successfulBookingsCount: vendor.successfulBookingsCount,
    },
    rules,
  );

  // Callers that already priced vendor GST (cart: gstInclusive/rate rules) pass it in.
  const vendorGst =
    vendor.vendorGst != null
      ? vendor.vendorGst
      : vendor.gstRegistered
        ? round2(pctOf(vendorB2B, vendor.gstRatePct ?? 18))
        : 0;
  const settlement = vendorSettlement(
    { vendorB2B, vendorGst, gstRegistered: !!vendor.gstRegistered, commission: commission.actual },
    rules,
  );

  // Step 13 — MCT + MRER (PG resolved inside the fee floor)
  const mctAmount = computeMct(vendorB2B, band, rules);
  const fixed = fixedCosts(
    { vendorB2B, band, bookingMode, negotiationMode, leadBucket, payoutAmount: settlement.settlement, eventoryDiscount },
    rules,
  );

  // Commission the MRER floor may count on (trial: see rules.commission).
  const floorCommission =
    commission.inTrial && rules.commission.trialFloorUsesShadowCommission ? commission.shadow : commission.actual;

  // Steps 14–15 — service fee, floors, ceilings, weak PCI
  const fee = serviceFee(
    {
      vendorB2B,
      vendorGst,
      eventoryDiscount,
      band,
      category,
      bookingMode,
      leadBucket,
      negotiationMode,
      pciBand,
      commissionRevenue: floorCommission,
      mct: mctAmount,
      variableExPg: fixed.variableExPg,
    },
    rules,
  );

  // Step 16 — merchandising + tax back-solve
  const g = rules.tax.gstOnServiceFeePct / 100;
  const unroundedTotal = vendorB2B + vendorGst + fee.fee * (1 + g) - eventoryDiscount;
  const minFee = Math.max(fee.economicFloor, fee.modeFloorFee);
  const merch = merchandise(
    {
      unroundedTotal,
      vendorB2B,
      vendorGst,
      eventoryDiscount,
      bookingMode,
      minFee,
      maxFee: fee.ceilingBreach ? Infinity : Math.max(fee.modeCeilingFee, fee.fee),
    },
    rules,
  );

  // Final economics on the price actually charged
  const pg = pgCost(merch.displayPrice, rules);
  const variableCost = round2(pg + fixed.variableExPg);
  const mrer = round2(mctAmount + variableCost);
  const platformRevenue = round2(commission.actual + merch.taxableFee);
  const contributionBeforeCac = round2(platformRevenue - variableCost);

  // Step 17 — CPCI
  const market = cpci(merch.displayPrice, marketMedian, rules);

  // Step 18 — guardrails
  const review = [];
  if (fee.ceilingBreach) review.push("FEE_CEILING_BREACH");
  if (pciBand === "WEAK" && isFixed) review.push("WEAK_PCI");
  if (market.band === "REVIEW_REQUIRED" && isFixed) review.push("CPCI_ABOVE_LIMIT");
  // A trial funded by Eventory is a known shortfall, not a pricing failure.
  if (round2(floorCommission + merch.taxableFee) + 0.01 < mrer) review.push("MRER_NOT_MET");

  const status = unavailable.length ? "UNAVAILABLE" : review.length ? "REVIEW_REQUIRED" : "APPROVED";

  return {
    ...base,
    status,
    reasonCodes: [...unavailable, ...review],
    commission,
    settlement,
    mrer: {
      mct: mctAmount,
      pg,
      ...fixed.parts,
      total: mrer,
    },
    serviceFee: {
      ...fee,
      taxableFee: merch.taxableFee,
      gstOnFee: merch.gstOnFee,
      finalRate: round2((merch.taxableFee / vendorB2B) * 100),
    },
    customer: {
      vendorService: vendorB2B,
      vendorGst,
      eventoryDiscount,
      unroundedTotal: merch.unroundedTotal,
      displayPrice: merch.displayPrice,
      roundingAdjustment: merch.adjustment,
      roundingStrategy: merch.strategy,
      corridor: merch.corridor,
    },
    cpci: market,
    platformRevenue,
    variableCost,
    contributionBeforeCac,
  };
}

/** Prices every booking mode for the same package + event (§14: a mode can fail alone). */
export function priceAllModes({ vendor, baseline, runtime }, rules = RULES_V1) {
  return Object.fromEntries(
    rules.bookingModes.map((bookingMode) => [
      bookingMode,
      priceLine({ vendor, baseline, runtime: { ...runtime, bookingMode } }, rules),
    ]),
  );
}

/** Flattens a priceLine result into the PRD §16 snapshot field names. */
export function toSnapshot(r) {
  if (!r.commission) return { commercial_viability_status: r.status, price_review_reason_code: r.reasonCodes };
  const f = r.serviceFee;
  return {
    category_rule_version: r.versions.category,
    pricing_rule_version: r.versions.pricing,
    tax_rule_version: r.versions.tax,
    mrer_at_booking: r.mrer.total,
    pg_cost_at_booking: r.mrer.pg,
    payout_cost_at_booking: r.mrer.payout,
    ops_cost_at_booking: r.mrer.ops,
    communication_cost_at_booking: r.mrer.communication,
    zero_pay_risk_reserve_at_booking: r.mrer.zeroPayReserve,
    eventory_discount_at_booking: r.mrer.eventoryDiscount,
    minimum_contribution_target_at_booking: r.mrer.mct,
    vendor_commission_at_booking: r.commission.actual,
    shadow_vendor_commission: r.commission.shadow,
    customer_service_fee_at_booking: f.taxableFee,
    platform_revenue_at_booking: r.platformRevenue,
    variable_cost_at_booking: r.variableCost,
    contribution_before_cac: r.contributionBeforeCac,
    customer_rounding_adjustment: r.customer.roundingAdjustment,
    vendor_commission_rounding_adjustment: r.commission.roundingAdjustment,
    service_fee_band_component: f.components.band,
    service_fee_category_component: f.components.category,
    service_fee_booking_mode_component: f.components.bookingMode,
    service_fee_lead_time_component: f.components.leadTime,
    service_fee_negotiation_component: f.components.negotiation,
    minimum_service_fee_required_from_mrer: f.economicFloor,
    service_fee_floor_applied: f.floorApplied,
    service_fee_ceiling_applied: f.ceilingApplied,
    commercial_viability_status: r.status,
    price_review_reason_code: r.reasonCodes,
  };
}
