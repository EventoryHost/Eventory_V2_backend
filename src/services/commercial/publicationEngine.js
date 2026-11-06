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
 * checked as an envelope and CPCI is tested on the best-case customer price
 * (Advance, 21+ days, no negotiation — the lowest fee the package can show).
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

  const quoteEligible = bandAtLeast(band, rules.quoteMinBand, rules) && baseline.supportedModes.includes("ENQUIRE_QUOTE");

  // Best-case CPCI probe (only meaningful with a benchmark).
  let bestCase = null;
  if (baseline.marketMedian) {
    bestCase = priceLine(
      {
        vendor: { gstRegistered: vendor.gstRegistered, gstRatePct: vendor.gstRatePct, monetizationModel: "COMMISSION" },
        baseline,
        runtime: { bookingMode: "ADVANCE_PAY_BOOK", negotiationMode: "NONE", daysToEvent: 30 },
      },
      rules,
    );
    snapshot.bestCaseCpci = bestCase.cpci;
  }
  const warnings = baseline.marketMedian ? [] : ["NO_MARKET_BENCHMARK"];

  let outcome = "APPROVED_FIXED";
  if (pciResult.band === "WEAK") reasons.push("WEAK_PCI");
  if (bestCase?.cpci.band === "REVIEW_REQUIRED") reasons.push("CPCI_ABOVE_LIMIT");
  const fixedBlocked = reasons.includes("WEAK_PCI") || reasons.includes("CPCI_ABOVE_LIMIT");
  if (fixedBlocked) outcome = quoteEligible ? "QUOTE_ONLY" : "PRICE_REVIEW_REQUIRED";

  const supports = (m) => baseline.supportedModes.includes(m);
  const fixedOn = outcome === "APPROVED_FIXED";
  const modes = {
    ADVANCE_PAY_BOOK: fixedOn && supports("ADVANCE_PAY_BOOK"),
    ZERO_PAY_BOOK: fixedOn && supports("ZERO_PAY_BOOK"),
    ENQUIRE_QUOTE: outcome !== "PRICE_REVIEW_REQUIRED" && quoteEligible,
  };

  return { outcome, reasonCodes: reasons, warnings, modes, baseline, snapshot, demand };
}
