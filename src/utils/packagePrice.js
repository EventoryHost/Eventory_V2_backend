/**
 * SUPERSEDES the 2026-09-02 version of this file — that version treated
 * step3_policiesAndCharges.teamAndEquipment.price as a FALLBACK/SUBSTITUTE
 * for a missing packagePricing.price. Found wrong 2026-09-09 via a real
 * customer-reported bug: a PDP showed "Estimated total ₹16,992" (a real
 * ₹7,200 base/setup price + a real ₹7,200 teamAndEquipment charge + 18%
 * GST), while the SAME package's cart/checkout total showed only ₹7,200.
 * The frontend's own PackageDetailPage.tsx settles what "team & equipment"
 * actually means, in its own words: "Team & equipment is a real, SEPARATE
 * flat charge ON TOP OF the package's base price... included in the
 * subtotal." Confirmed against real prod data this is universal, not
 * Decorator-only: PAV/MakeupArtist/DJArtist/VenueProvider packages
 * routinely have BOTH a real packagePricing.price AND a real, DIFFERENT
 * teamAndEquipment.price set at once (e.g. one real PAV package:
 * packagePricing.price 2000, teamAndEquipment.price 200 — genuinely two
 * separate numbers, not a vendor typing the same total twice). The old
 * "fallback" logic silently dropped teamAndEquipment.price entirely
 * whenever packagePricing.price WAS set — which is most packages outside
 * Decorator/Caterer — meaning this codebase has likely been undercharging
 * (or under-quoting) every booking with a configured team & equipment
 * charge, not just Caterer/Decorator ones, since before the 09-02 fix even
 * existed.
 *
 * getPackageBasePrice — the price of "the package itself", vendor-type-aware:
 *   - VenueProvider prices via overallPriceOfPackage, not packagePricing
 *     (mirrors the frontend's own priceOf() vendor-type branch exactly).
 *   - Every other type: packagePricing.price when the vendor's own flow
 *     actually set it (PAV/MakeupArtist/DJArtist/VenueProvider all do).
 *   - Decorator: packagePricing.price is NEVER set (confirmed against 108
 *     real prod packages, 0 exceptions) — DecoratorFlow.tsx has no input
 *     for it at all. The real base price is the SUM of every
 *     step2_productsAndPricing.setups[].price — each setup is a real,
 *     separately-priced deliverable a vendor configured, and a package
 *     with a single setup (the common case today) sums to exactly that
 *     setup's price, matching the PDP's own per-setup breakdown line ("Main
 *     photo/backdrop area and cake/display area ₹7,200") exactly.
 *   - Caterer: DELIBERATELY returns 0, not a guess. Caterer has no flat
 *     "package price" concept at all — pricing is step2_productsAndPricing
 *     .menus[].perPlatePrice, a PER-PLATE rate that only becomes a real
 *     total once multiplied by a guest count, which is a genuine unresolved
 *     product-rule question (which menu? whose guest count — the line's
 *     eventDetails.guestCount? a minimum guest count?) — not something to
 *     fabricate here. Zero Caterer packages are currently Live, so this is
 *     an honest placeholder, not a live bug, but it MUST be revisited
 *     before any Caterer package goes Live — flagged, not silently guessed.
 *
 * getTeamAndEquipmentCharge — the real, separate additive charge, when a
 * vendor configured one, for ANY vendor type (see the real PAV/MakeupArtist/
 * DJArtist examples above — this is not Decorator-specific).
 *
 * getEffectivePackagePrice — basePrice + teamAndEquipmentCharge, rounded.
 * This is the ONE number every cart/checkout/wishlist/booking/compare read
 * site in this codebase uses as "the package's price" — kept as the same
 * exported name/shape as the superseded version so every one of those call
 * sites picks up this fix automatically, with zero call-site changes.
 */
import { round2 } from "./money.js";

export function getPackageBasePrice(pkg) {
  const charges = pkg?.step3_policiesAndCharges;

  if (pkg?.vendorType === "VenueProvider") {
    return charges?.overallPriceOfPackage?.price ?? charges?.packagePricing?.price ?? 0;
  }

  const directPrice = charges?.packagePricing?.price;
  if (directPrice !== undefined && directPrice !== null) return directPrice;

  if (pkg?.vendorType === "Decorator") {
    const setups = pkg?.step2_productsAndPricing?.setups || [];
    return setups.reduce((sum, s) => sum + (s.price || 0), 0);
  }

  // Caterer (no flat price concept — see the doc comment above) and any
  // other/unknown vendor type with no packagePricing.price set: honestly 0,
  // not a guess.
  return 0;
}

export function getTeamAndEquipmentCharge(pkg) {
  return pkg?.step3_policiesAndCharges?.teamAndEquipment?.price || 0;
}

export function getEffectivePackagePrice(pkg) {
  return round2(getPackageBasePrice(pkg) + getTeamAndEquipmentCharge(pkg));
}

export default getEffectivePackagePrice;
