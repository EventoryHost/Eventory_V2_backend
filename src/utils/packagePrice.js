/**
 * The customer-facing "package price" — one field, `step3_policiesAndCharges
 * .packagePricing.price`, is supposed to be the single source of truth for
 * this across every vendor type (cartPricingService.js, browsePackages'
 * sort/filter, the PDP). Confirmed 2026-09-02 while fixing a "PDP variant
 * price not displaying" report: it's NEVER actually set for Caterer or
 * Decorator packages — checked every real package of both types in prod
 * (108 Decorator + 15 Caterer, including all 3 currently-Live Decorator
 * ones), 0 of them have it. Their vendor-side creation flows
 * (CatererFlow.tsx/DecoratorFlow.tsx) simply have no input for this field at
 * all — the number a Caterer/Decorator vendor actually enters as their
 * package's price lands in step3_policiesAndCharges.teamAndEquipment.price
 * instead (confirmed by reading those flows directly: DJArtist/MakeupArtist/
 * PAV/VenueProvider's flows DO write packagePricing.price, only these two
 * don't). The practical effect, before this fix: every Caterer/Decorator
 * package silently priced at ₹0 everywhere a customer would see or pay it —
 * cart/checkout total, PDP, browse listing — a real, severe, pre-existing
 * bug, not limited to the PDP display report that surfaced it.
 *
 * getEffectivePackagePrice recovers the real, vendor-entered number rather
 * than fabricating one: falls back to teamAndEquipment.price only when
 * packagePricing.price itself was never set. Harmless no-op for every other
 * vendor type, whose packagePricing.price is already reliably populated.
 */
export function getEffectivePackagePrice(pkg) {
  const charges = pkg?.step3_policiesAndCharges;
  const price = charges?.packagePricing?.price;
  if (price !== undefined && price !== null) return price;
  return charges?.teamAndEquipment?.price ?? 0;
}

export default getEffectivePackagePrice;
