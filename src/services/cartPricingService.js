import CartItem from "../models/CartItem.js";
import Package from "../models/Package.js";
import { round2 } from "../utils/money.js";

/**
 * Cart pricing/due-now calculation — Phase 3 Step 14. This is the
 * AUTHORITATIVE quote: unlike the plain GET /api/customer/cart (Step 13,
 * which prices off each item's packageSnapshot for a stable display total),
 * this re-fetches each package's CURRENT price/GST/token/milestone config
 * and computes off that — matching the final BRD's "All money is computed
 * server-side and echoed to the client; the client never invents a total"
 * principle (Section 10.4) and its own "single source of truth" framing for
 * a quote endpoint (Section 18). Both numbers are surfaced side by side
 * (snapshot vs. quoted) rather than one silently overwriting the other.
 *
 * Deliberately excludes src/services/ as a folder — this is the first file
 * in it. A pricing engine reused by both Cart (here) and, later, Phase 4's
 * checkout is a genuine case for pulling logic out of a controller; this
 * codebase had no services/ layer before (see info.txt PART 1).
 *
 * Only CartItems with selectedForCheckout:true are priced — the final BRD's
 * "item-level select checkbox... summary recalculates on selection"
 * (Section 9). This is also a correction to Step 13's plain GET, which
 * summed every item regardless of selection — fixed alongside this file,
 * see info.txt.
 */

// Convenience fee % is a genuine open product/finance decision (final BRD
// §21 Q1/Q2 — token %, and which fee presentation ships, are both still
// unresolved even by the client's own document) — NOT hardcoded here to
// 3% (or any other number) as if it were settled. Read from an env var so
// it's at least externally adjustable without a code change; if unset, the
// fee is computed as 0 and explicitly flagged `convenienceFeeConfigured:
// false` rather than silently charging a number nobody approved.
function getConvenienceFeePercent() {
  const raw = process.env.CONVENIENCE_FEE_PERCENT;
  if (raw === undefined || raw === "") return null;
  const parsed = Number(raw);
  return isNaN(parsed) ? null : parsed;
}

// Milestone dueDays is a free-text field on the vendor's Package
// (Package.js: `dueDays: { type: String }`), not a number — some vendors
// may have entered a real integer ("7"), others a description ("On event
// day"). Only compute a real due date when it parses cleanly; otherwise
// return the raw label and say so, rather than guessing.
function tryComputeMilestoneDueDate(eventDate, dueDaysRaw) {
  if (!eventDate || !dueDaysRaw) return null;
  const days = parseInt(dueDaysRaw, 10);
  if (isNaN(days) || String(days) !== String(dueDaysRaw).trim()) return null;
  const due = new Date(eventDate);
  due.setUTCDate(due.getUTCDate() - days);
  return due;
}

function computeGst(subtotal, pricing) {
  const gstInclusive = !!pricing?.gstInclusive;
  const gstRatePercent = pricing?.gstRatePercent ?? null;
  if (subtotal == null || gstRatePercent == null) {
    return { gstInclusive, gstRatePercent, gstAmount: null };
  }
  const gstAmount = gstInclusive
    ? round2(subtotal - subtotal / (1 + gstRatePercent / 100))
    : round2((subtotal * gstRatePercent) / 100);
  return { gstInclusive, gstRatePercent, gstAmount };
}

// Per-line token/advance — reads the OWNING PACKAGE's own bookingSettings,
// never a hardcoded percentage. "Free" paymentType is a real, explicit
// zero-advance case (answers the OPEN QUESTIONS entry on no-upfront
// bookings for THIS package), distinct from "not configured at all", which
// is flagged rather than defaulted to any percentage — see the module
// comment on why 25% specifically must never appear here.
function computeLineToken(lineTotalInclGst, pkg) {
  const settings = pkg.bookingSettings || {};

  if (settings.paymentType === "Free") {
    return { tokenConfigured: true, paymentType: "Free", tokenAmount: 0, remaining: lineTotalInclGst };
  }

  const token = settings.token || {};
  if (settings.paymentType !== "Token" || !token.tokenType || token.value == null) {
    return { tokenConfigured: false, paymentType: settings.paymentType || null, tokenAmount: null, remaining: null };
  }

  const tokenAmount =
    token.tokenType === "Percentage" ? round2((lineTotalInclGst * token.value) / 100) : round2(Math.min(token.value, lineTotalInclGst));

  return {
    tokenConfigured: true,
    paymentType: "Token",
    tokenType: token.tokenType,
    tokenValue: token.value,
    tokenAmount,
    remaining: round2(lineTotalInclGst - tokenAmount),
  };
}

function computeLineMilestones(lineTotal, pkg, eventDate) {
  const milestones = pkg.paymentMilestones?.milestones || [];
  return milestones.map((m) => {
    const amount = m.percentage != null ? round2((lineTotal * m.percentage) / 100) : null;
    const dueDate = tryComputeMilestoneDueDate(eventDate, m.dueDays);
    return {
      title: m.title,
      percentage: m.percentage ?? null,
      amount,
      dueDaysRaw: m.dueDays ?? null,
      dueDate, // null if dueDays wasn't a clean integer or there's no event date yet
    };
  });
}

/**
 * @desc Core pricing engine, independent of Cart. Takes a plain array of
 * "lines" — { lineId, vendorId, packageId, quantity, selectedAddOns,
 * selectedItems, eventDetails, packageSnapshot? } — and returns the same
 * quote shape computeCartQuote always has. Pulled out in Phase 4 Step 15 so
 * CheckoutSession (a direct "Book Now" purchase, or a locked-in copy of the
 * cart's lines, either way NOT necessarily backed by live CartItem
 * documents) can reuse the exact same math as the Cart quote endpoint,
 * rather than a third, potentially-drifting reimplementation.
 */
export async function computeQuoteForLines(lines, discount = 0) {
  if (!lines || lines.length === 0) return null;

  const packageIds = [...new Set(lines.map((l) => String(l.packageId)))];
  const packages = await Package.find({ _id: { $in: packageIds } }).lean();
  const packageById = new Map(packages.map((p) => [String(p._id), p]));

  const lineQuotes = lines.map((item) => {
    const pkg = packageById.get(String(item.packageId));
    if (!pkg || pkg.packageStatus !== "Live") {
      return {
        lineId: item.lineId,
        vendorId: item.vendorId,
        packageId: item.packageId,
        available: false,
        note: "This package is no longer Live — excluded from the quote. Remove or replace it before checkout.",
      };
    }

    const currentPrice = pkg.step3_policiesAndCharges?.packagePricing?.price ?? 0;
    const quantity = item.quantity || 1;
    const addonsTotal = (item.selectedAddOns || []).reduce((sum, a) => sum + a.price * a.quantity, 0);
    const chargeableItemsTotal = (item.selectedItems || []).filter((s) => s.isChargeable).reduce((sum, s) => sum + (s.price || 0), 0);
    const packagePriceTotal = round2(currentPrice * quantity);
    const lineSubtotal = round2(packagePriceTotal + addonsTotal + chargeableItemsTotal);

    const { gstInclusive, gstRatePercent, gstAmount } = computeGst(lineSubtotal, pkg.step3_policiesAndCharges);
    const lineTotalInclGst = gstAmount == null ? lineSubtotal : gstInclusive ? lineSubtotal : round2(lineSubtotal + gstAmount);

    const token = computeLineToken(lineTotalInclGst, pkg);
    // Same base as token (lineTotalInclGst, tax-INCLUDED), not lineSubtotal
    // — a real bug, found while building Step 19: milestone percentages
    // were computed off the pre-tax subtotal while the token amount (the
    // actual amount charged via Cashfree) was computed off the tax-
    // inclusive total, so a "25%" milestone and a "25%" token never
    // actually agreed in rupees for the same package, and Step 19's
    // milestone-to-Booking mapping (which matches the paid milestone by
    // comparing amounts) could never find a real match. Milestones now sum
    // to 100% of the actual tax-inclusive amount owed, consistent with
    // what's actually charged.
    const milestones = computeLineMilestones(lineTotalInclGst, pkg, item.eventDetails?.date);

    return {
      lineId: item.lineId,
      vendorId: item.vendorId,
      packageId: item.packageId,
      available: true,
      snapshotPrice: item.packageSnapshot?.price ?? null,
      currentPrice,
      priceChanged: item.packageSnapshot?.price != null && item.packageSnapshot.price !== currentPrice,
      packagePriceTotal,
      addonsTotal: round2(addonsTotal),
      chargeableItemsTotal: round2(chargeableItemsTotal),
      lineSubtotal,
      gstInclusive,
      gstRatePercent,
      gstAmount,
      lineTotalInclGst,
      token,
      milestones,
    };
  });

  const availableLines = lineQuotes.filter((l) => l.available);

  const subtotal = round2(availableLines.reduce((sum, l) => sum + l.lineSubtotal, 0));
  const gstTotal = round2(availableLines.reduce((sum, l) => sum + (l.gstAmount || 0), 0));

  const convenienceFeePercent = getConvenienceFeePercent();
  const convenienceFeeConfigured = convenienceFeePercent != null;
  const convenienceFee = convenienceFeeConfigured ? round2((subtotal * convenienceFeePercent) / 100) : 0;

  const grandTotal = round2(Math.max(0, subtotal + gstTotal + convenienceFee - discount));

  const linesWithToken = availableLines.filter((l) => l.token.tokenConfigured);
  const allTokensConfigured = linesWithToken.length === availableLines.length && availableLines.length > 0;
  const tokenAmountTotal = round2(linesWithToken.reduce((sum, l) => sum + (l.token.tokenAmount || 0), 0));
  const remainingTotal = allTokensConfigured ? round2(grandTotal - tokenAmountTotal) : null;

  return {
    lines: lineQuotes,
    subtotal,
    gstTotal,
    convenienceFeePercent,
    convenienceFeeConfigured,
    convenienceFee,
    discount,
    grandTotal,
    tokenAmountTotal: allTokensConfigured ? tokenAmountTotal : null,
    remainingTotal,
    allTokensConfigured,
    note: allTokensConfigured
      ? null
      : "One or more selected vendors have no token/advance configured on their package (bookingSettings.paymentType/token) — tokenAmountTotal and remainingTotal are withheld rather than guessed. Never defaults to 25% or any other assumed percentage.",
  };
}

/**
 * @desc Computes the authoritative quote for a Cart's currently-selected
 * items. Returns null if the cart has no selected items (nothing to quote).
 * Thin wrapper over computeQuoteForLines — fetches the live CartItems and
 * maps them to the generic line shape.
 */
export async function computeCartQuote(cart) {
  const items = await CartItem.find({ cartId: cart._id, selectedForCheckout: true }).lean();
  if (items.length === 0) return null;

  const lines = items.map((item) => ({
    lineId: item._id,
    vendorId: item.vendorId,
    packageId: item.packageId,
    quantity: item.quantity,
    selectedAddOns: item.selectedAddOns,
    selectedItems: item.selectedItems,
    eventDetails: item.eventDetails,
    packageSnapshot: item.packageSnapshot,
  }));

  return computeQuoteForLines(lines, cart.coupon?.discountAmount || 0);
}

export default computeCartQuote;
