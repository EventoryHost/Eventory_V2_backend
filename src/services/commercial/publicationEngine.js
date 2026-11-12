import { RULES_V1 } from "./rules.v1.js";
import { vendorDemand, commercialCategory } from "./categoryEngine.js";
import { packageBand, bandAtLeast, pci as computePci } from "./marketEngine.js";
import { mct as computeMct } from "./economicsEngine.js";
import { commissionEnvelope } from "./commissionEngine.js";
import { priceLine } from "./pricingEngine.js";

/**
 * PUBLICATION REVIEW — PRD §13.3 steps 2–10.
 *
 * Turns vendor facts + EM-verified package facts into the commercial
 * BASELINE that runtime pricing consumes, and decides the publication
 * outcome:
 *   APPROVED_FIXED         fixed modes (Advance, Zero Pay if supported) + Quote if CORE+
 *   QUOTE_ONLY             fixed modes off; EM/PRINT can still work the lead
 *   PRICE_REVIEW_REQUIRED  B2B / benchmark / scope / data needs correction first
 *
 * Lead time is unknown at publication (no customer date), so commission is
 * checked as an envelope, and each fixed-price mode is priced at its best
 * case (30 days out): a mode whose fee would break its ceiling even then is
 * switched off, and CPCI is tested on the best-case Advance price.
 */

export function evaluatePublication({ vendor, counters, demand: knownDemand, pkg }, rules = RULES_V1) {
  const reasons = [];

  // Callers holding a resolved demand (admin tier override) pass it in.
  const demand = knownDemand ?? vendorDemand(vendor, counters, rules);
  const criticality = pkg.eventoryApprovedCriticality ?? null;
  if (!criticality) reasons.push("CRITICALITY_NOT_APPROVED");
  if (demand.tier === "PROVISIONAL") reasons.push("VENDOR_MINIMUM_INFO_MISSING");

  const category = criticality ? commercialCategory(criticality, demand.tier, rules) : null;
  const vendorB2B = pkg.vendorB2BPrice;
  if (!(vendorB2B > 0)) reasons.push("MISSING_B2B");

  const band = vendorB2B > 0 ? packageBand(vendorB2B, rules) : null;
  const verifiedB2C = pkg.b2cPriceVerified ? pkg.verifiedVendorB2CPrice : null;
  const pciResult = vendorB2B > 0 ? computePci(vendorB2B, verifiedB2C, rules) : { pci: null, band: "NOT_AVAILABLE" };

  const baseline = {
    vendorB2B,
    category,
    band,
    pci: pciResult.pci,
    pciBand: pciResult.band,
    marketMedian: pkg.marketPriceMedian ?? null,
    supportedModes: pkg.bookingModesSupported ?? rules.bookingModes,
  };

  const snapshot = {
    versions: rules.versions,
    vendorDemandScore: demand.score,
    vendorDemandTier: demand.tier,
    eventoryApprovedCriticality: criticality,
    commercialCategory: category,
    packageBand: band,
    vendorB2BPrice: vendorB2B,
    verifiedVendorB2CPrice: verifiedB2C,
    pci: pciResult.pci,
    pciBand: pciResult.band,
    marketPriceLow: pkg.marketPriceLow ?? null,
    marketPriceMedian: pkg.marketPriceMedian ?? null,
    marketPriceHigh: pkg.marketPriceHigh ?? null,
  };

  if (reasons.length) {
    return { outcome: "PRICE_REVIEW_REQUIRED", reasonCodes: reasons, modes: {}, baseline, snapshot, demand };
  }

  snapshot.mct = computeMct(vendorB2B, band, rules);
  snapshot.commissionEnvelope = commissionEnvelope({ category, band, pciBand: pciResult.band }, rules);

  const supports = (m) => baseline.supportedModes.includes(m);
  const quoteEligible = bandAtLeast(band, rules.quoteMinBand, rules) && supports("ENQUIRE_QUOTE");

  // §13.3 step 9 — best-case economics per fixed-price mode. Each mode the
  // package offers is priced at its most favourable point (30 days out,
  // the package's negotiation mode, normal commission). If even then the fee
  // Eventory needs (MRER floor) is above the mode's ceiling, no customer
  // could ever book that mode at a fixed price, so it is switched off here
  // rather than refused at checkout. The trial is temporary: a mode that only
  // fails while the vendor is in trial stays on, with a warning.
  const probe = (bookingMode, monetizationModel) =>
    priceLine(
      {
        vendor: {
          gstRegistered: vendor.gstRegistered,
          vendorGst: pkg.vendorGst ?? null,
          monetizationModel,
          successfulBookingsCount: vendor.successfulBookingsCount ?? 0,
        },
        baseline,
        runtime: { bookingMode, negotiationMode: pkg.negotiationMode ?? "NONE", daysToEvent: 30 },
      },
      rules,
    );

  const fixedModes = rules.fixedPriceModes.filter(supports);
  const feasible = {};
  const warnings = baseline.marketMedian ? [] : ["NO_MARKET_BENCHMARK"];
  let bestCase = null;
  for (const mode of fixedModes) {
    const result = probe(mode, "COMMISSION");
    feasible[mode] = !result.serviceFee?.ceilingBreach;
    if (!bestCase || mode === "ADVANCE_PAY_BOOK") bestCase = result;
    if (feasible[mode] && vendor.monetizationModel === "TRIAL" && probe(mode, "TRIAL").serviceFee?.ceilingBreach) {
      warnings.push(`TRIAL_FEE_CEILING_BREACH:${mode}`);
    }
  }
  snapshot.fixedModeFeasible = feasible;
  if (bestCase && baseline.marketMedian) snapshot.bestCaseCpci = bestCase.cpci;

  if (pciResult.band === "WEAK") reasons.push("WEAK_PCI");
  if (baseline.marketMedian && bestCase?.cpci.band === "REVIEW_REQUIRED") reasons.push("CPCI_ABOVE_LIMIT");
  if (fixedModes.length && !fixedModes.some((m) => feasible[m])) reasons.push("FEE_CEILING_BREACH");

  const fixedBlocked = reasons.length > 0;
  const fixedAvailable = !fixedBlocked && fixedModes.some((m) => feasible[m]);
  if (!fixedModes.length && supports("ENQUIRE_QUOTE") && !quoteEligible) reasons.push("QUOTE_BELOW_CORE");
  const outcome = fixedAvailable ? "APPROVED_FIXED" : quoteEligible ? "QUOTE_ONLY" : "PRICE_REVIEW_REQUIRED";

  const modes = {
    ADVANCE_PAY_BOOK: !fixedBlocked && supports("ADVANCE_PAY_BOOK") && Boolean(feasible.ADVANCE_PAY_BOOK),
    ZERO_PAY_BOOK: !fixedBlocked && supports("ZERO_PAY_BOOK") && Boolean(feasible.ZERO_PAY_BOOK),
    ENQUIRE_QUOTE: quoteEligible,
  };

  return { outcome, reasonCodes: reasons, warnings, modes, baseline, snapshot, demand };
}
