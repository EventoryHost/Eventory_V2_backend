import { computeQuoteForLines } from "./cartPricingService.js";

/**
 * The quote inputs for a checkout session — one entry per line, keyed to the
 * line's selected VARIANT (line.packageId is the variant document's _id).
 * Shared by the quote lock (customerCheckoutController.lockQuote) and the
 * payment-time freshness check below, so the two can never price differently.
 */
export const quoteLinesFromSession = (session) =>
  session.lines.map((l) => ({
    lineId: l._id,
    vendorId: l.vendorId,
    packageId: l.packageId,
    quantity: l.quantity,
    selectedAddOns: l.selectedAddOns,
    selectedItems: l.selectedItems,
    eventDetails: l.eventDetails,
    packageSnapshot: l.packageSnapshot,
  }));

/**
 * Re-prices the session against the live variants and lists every line whose
 * variant has stopped being bookable (deactivated, deleted, vendor hidden) or
 * whose package price changed since the quote was locked.
 *
 * The locked quote can be up to SESSION_TTL old when the customer pays, and
 * an admin can deactivate or reprice a variant in that window. The customer
 * must never be charged a price, or for a variant, that no longer exists.
 *
 * @returns {{ drift: Array, freshQuote: object|null }}
 */
export const findQuoteDrift = async (session) => {
  const locked = session.lockedQuote;
  if (!locked || !session.lines.length) return { drift: [], freshQuote: null };

  const freshQuote = await computeQuoteForLines(
    quoteLinesFromSession(session),
    locked.discount || 0,
    { customerId: session.customerId }
  );

  const lockedById = new Map((locked.lines || []).map((l) => [String(l.lineId), l]));
  const drift = [];
  for (const fresh of freshQuote.lines || []) {
    const before = lockedById.get(String(fresh.lineId));
    if (!before) continue;
    if (before.available !== false && fresh.available === false) {
      drift.push({ lineId: fresh.lineId, packageId: fresh.packageId, reason: "UNAVAILABLE" });
    } else if (
      fresh.available !== false &&
      Number.isFinite(before.currentPrice) &&
      Number.isFinite(fresh.currentPrice) &&
      fresh.currentPrice !== before.currentPrice
    ) {
      drift.push({
        lineId: fresh.lineId,
        packageId: fresh.packageId,
        reason: "PRICE_CHANGED",
        lockedPrice: before.currentPrice,
        currentPrice: fresh.currentPrice,
      });
    }
  }
  // Anything else that changes what the customer pays (token %, GST, add-on
  // or fee rules) shows up in the totals even when no line's base price moved.
  if (!drift.length) {
    for (const key of ["tokenAmountTotal", "grandTotal"]) {
      if ((locked[key] ?? null) !== (freshQuote[key] ?? null)) {
        drift.push({ reason: "TOTAL_CHANGED", field: key, locked: locked[key] ?? null, current: freshQuote[key] ?? null });
      }
    }
  }
  return { drift, freshQuote };
};

export default { quoteLinesFromSession, findQuoteDrift };
