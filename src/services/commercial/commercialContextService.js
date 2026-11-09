import { round2 } from "../../utils/money.js";
import { getEffectivePackagePrice } from "../../utils/packagePrice.js";
import { vendorDemand, commercialCategory } from "./categoryEngine.js";
import { packageBand, pci as computePci } from "./marketEngine.js";

/**
 * Bridges stored documents (Vendor, Package) to the pure engine inputs.
 *
 * Existing data predates the Commercial Engine, so every input has a
 * defined fallback instead of blocking the sale:
 *   - demand inputs: Vendor.commercial numbers, else the leading integer of
 *     the legacy free-text profile fields (same parse convenienceFeeService
 *     used), else missing -> PROVISIONAL
 *   - criticality: EM-approved value, else the legacy per-vendor-type map
 *   - Vendor B2B: Package.commercial.vendorB2BPrice, else the package's
 *     effective price (what the vendor already charges through Eventory)
 *   - booking modes: Package.commercial.bookingModesSupported, else derived
 *     from bookingSettings (Enquiry -> Quote, Free -> Zero Pay, Token -> Advance)
 */

// Legacy criticality by vendor type (old convenienceFeeService SERVICE_TYPE).
const LEGACY_CRITICALITY = {
  PAV: "CRITICAL",
  VenueProvider: "CRITICAL",
  Caterer: "CRITICAL",
  Decorator: "CRITICAL",
  MakeupArtist: "NON_CRITICAL",
  DJArtist: "NON_CRITICAL",
};

function leadingInt(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

export function vendorDemandInputs(vendor) {
  const c = vendor?.commercial || {};
  return {
    bookingsLast12Months: c.bookingsLast12Months ?? leadingInt(vendor?.bookingsPerYear),
    yearsOfOperation: c.yearsOfOperation ?? leadingInt(vendor?.experience),
    teamSize: c.teamSize ?? leadingInt(vendor?.teamSize),
  };
}

function behaviourCounters(vendor) {
  const c = vendor?.commercial?.counters;
  if (!c) return null;
  return {
    ...c,
    // §5.3 intends a median; the stored aggregate only gives the mean.
    medianResponseMinutes: c.responseCount ? c.responseTimeTotalMinutes / c.responseCount : null,
  };
}

/** Current demand tier: admin override, else computed (Pre-Eventory + behaviour blend). */
export function resolveVendorDemand(vendor, rules) {
  const demand = vendorDemand(vendorDemandInputs(vendor), behaviourCounters(vendor), rules);
  const override = vendor?.commercial?.tierOverride?.tier;
  return override ? { ...demand, computedTier: demand.tier, tier: override, overridden: true } : demand;
}

export function packageCriticality(pkg) {
  return pkg?.commercial?.eventoryApprovedCriticality ?? LEGACY_CRITICALITY[pkg?.vendorType] ?? null;
}

export function packageVendorB2B(pkg) {
  return pkg?.commercial?.vendorB2BPrice ?? getEffectivePackagePrice(pkg);
}

export function packageBookingModes(pkg) {
  const explicit = pkg?.commercial?.bookingModesSupported;
  if (explicit?.length) return explicit;
  return [defaultBookingMode(pkg)];
}

/** The mode a plain add-to-cart / Book Now uses for this package. */
export function defaultBookingMode(pkg) {
  const s = pkg?.bookingSettings || {};
  if (s.bookingType === "Enquiry/Quote") return "ENQUIRE_QUOTE";
  if (s.paymentType === "Free") return "ZERO_PAY_BOOK";
  return "ADVANCE_PAY_BOOK";
}

/**
 * Engine baseline for one package. `vendorB2B` overrides the package price
 * for a priced line (quantity, add-ons and chargeable items included).
 */
export function buildBaseline({ pkg, vendor, rules, vendorB2B }) {
  const demand = resolveVendorDemand(vendor, rules);
  const criticality = packageCriticality(pkg);
  const b2b = round2(vendorB2B ?? packageVendorB2B(pkg));
  const c = pkg?.commercial || {};
  // PCI is a property of the package price, not of a line's add-ons.
  const pciResult = computePci(packageVendorB2B(pkg), c.b2cPriceVerified ? c.verifiedVendorB2CPrice : null, rules);

  return {
    demand,
    criticality,
    baseline: {
      vendorB2B: b2b,
      category: criticality ? commercialCategory(criticality, demand.tier, rules) : null,
      band: b2b > 0 ? packageBand(b2b, rules) : null,
      pci: pciResult.pci,
      pciBand: pciResult.band,
      marketMedian: c.marketPriceMedian ?? null,
      supportedModes: packageBookingModes(pkg),
    },
  };
}

/** Engine vendor block. `vendorGst` is the line's actual vendor GST amount. */
export function buildEngineVendor(vendor, { vendorGst } = {}) {
  return {
    gstRegistered: Boolean(vendor?.gstNumber),
    vendorGst: vendorGst ?? null,
    monetizationModel: vendor?.commercial?.monetizationModel ?? "TRIAL",
    successfulBookingsCount: vendor?.commercial?.successfulBookingsCount ?? 0,
  };
}

/** Publication-engine package shape from a stored Package. */
export function publicationPackage(pkg) {
  const c = pkg?.commercial || {};
  return {
    eventoryApprovedCriticality: packageCriticality(pkg),
    vendorB2BPrice: packageVendorB2B(pkg),
    b2cPriceVerified: c.b2cPriceVerified,
    verifiedVendorB2CPrice: c.verifiedVendorB2CPrice,
    marketPriceLow: c.marketPriceLow,
    marketPriceMedian: c.marketPriceMedian,
    marketPriceHigh: c.marketPriceHigh,
    bookingModesSupported: packageBookingModes(pkg),
  };
}
