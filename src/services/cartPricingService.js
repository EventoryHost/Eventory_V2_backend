import mongoose from "mongoose";
import CartItem from "../models/CartItem.js";
import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";
import { round2 } from "../utils/money.js";
import Booking from "../models/Booking.js";
import { computeMilestoneDueDate } from "../utils/milestoneDueDate.js";
import { hiddenVendorKeys } from "../utils/customerVisibility.js";
import { getActiveRules } from "./commercial/ruleSetService.js";
import { priceLine, toSnapshot } from "./commercial/pricingEngine.js";
import {
  buildBaseline,
  buildEngineVendor,
  defaultBookingMode,
  splitVendorPrice,
} from "./commercial/commercialContextService.js";
import { getEffectivePackagePrice } from "../utils/packagePrice.js";

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

// Convenience fee = the Eventory Service Fee from the Commercial Engine
// (PRD v1.0, src/services/commercial/), REPLACING the 2026-09-10 lookup-table
// fee (convenienceFeeService.js, now unused). Per vendor line the engine
// prices: vendor commission, MRER floor, the service fee from its five
// components, mode floor/ceiling, weak-PCI protection, then picks an
// attractive customer price inside a 1%-of-B2B corridor and back-solves the
// taxable fee + 18% GST from it. `convenienceFee` on a line is that fee
// INCLUDING its GST (same meaning existing readers already rely on);
// serviceFeeTaxable / serviceFeeGst carry the split for invoicing.
//
// The order total is no longer rounded up to the next ₹100 — rounding now
// happens per line inside the engine's corridor (PRD §11).
//
// Master kill-switch: set CONVENIENCE_FEE_DISABLED=true to suppress the fee
// everywhere (computed as 0, flagged) without a code change. Commission is
// still computed and snapshotted.
function convenienceFeeDisabled() {
  return String(process.env.CONVENIENCE_FEE_DISABLED || "").toLowerCase() === "true";
}

// Milestone dueDays is free text on the vendor's Package (Package.js:
// `dueDays: { type: String }`) with no validation anywhere, so vendors write
// a phrase ("2 days before the event"), not a number. Parsing moved to
// utils/milestoneDueDate.js — see that file for why the old integer-only
// parser returned null for literally every value in the database, leaving
// Booking.paymentMilestones[].dueDate empty on every booking.

// GST rule (2026-09-11, tightened 2026-10-15 — PM-reported): show/add GST
// ONLY when BOTH hold — the vendor has a real GSTIN on file (Vendor.
// gstNumber, set during onboarding; checked by the caller and passed in as
// vendorHasGst, never exposed to customers, see utils/publicFields.js) AND
// the vendor marked the package price as NOT inclusive of GST
// (gstInclusive:false) with a real rate set. Nothing vendor-side enforces
// gstRatePercent/gstInclusive and an actual GSTIN going together, so a
// vendor who never registered one (or explicitly skipped it — see Vendor.
// isGstSkipped) could still have a package showing/charging GST. Either
// condition failing means GST must not be shown or added at all:
// gstRatePercent/gstAmount both come back null, same as the "vendor never
// configured GST" case.
function computeGst(subtotal, pricing, vendorHasGst) {
  if (!vendorHasGst) return { gstInclusive: false, gstRatePercent: null, gstAmount: null };
  const gstInclusive = !!pricing?.gstInclusive;
  const gstRatePercent = pricing?.gstRatePercent ?? null;
  if (gstInclusive || subtotal == null || gstRatePercent == null) {
    return { gstInclusive, gstRatePercent: gstInclusive ? null : gstRatePercent, gstAmount: null };
  }
  const gstAmount = round2((subtotal * gstRatePercent) / 100);
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
    // Whole milestone, not just m.dueDays — lets the structured
    // dueOffsetFrom/dueOffsetDays fields take precedence when set.
    const dueDate = computeMilestoneDueDate(eventDate, m);
    return {
      title: m.title,
      percentage: m.percentage ?? null,
      amount,
      dueDaysRaw: m.dueDays ?? null,
      // Echoed so a client can render/re-edit the vendor's structured timing
      // rather than having to re-derive it from the free-text label.
      dueOffsetFrom: m.dueOffsetFrom ?? null,
      dueOffsetDays: m.dueOffsetDays ?? null,
      dueDate, // null when no resolvable timing was specified, or there's no event date yet
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
/**
 * Zero-Pay eligibility context for the engine (PRD §12.1): logged-in, how
 * many zero-pay bookings are still open, and whether the customer has any
 * completed history (new customers get max_active_zero_pay_bookings).
 * Outstanding Eventory balance isn't tracked yet — always 0.
 */
// Reason codes a customer may see. Anything describing Eventory's own
// economics (PCI, CPCI, fee ceiling, MRER, category) collapses to one
// neutral code — the customer never sees vendor B2B economics (PRD §17.4).
const CUSTOMER_REASONS = new Set([
  "MISSING_EVENT_DATE",
  "MODE_NOT_SUPPORTED",
  "ZERO_PAY_LOGIN_REQUIRED",
  "ZERO_PAY_OUTSTANDING_BALANCE",
  "ZERO_PAY_ACTIVE_LIMIT",
]);

function customerSafeReasons(codes) {
  const safe = codes.filter((c) => CUSTOMER_REASONS.has(c));
  return codes.length > safe.length ? [...safe, "PRICE_UNDER_REVIEW"] : safe;
}

const OPEN_BOOKING_STATUSES =["NewBooking", "Viewed", "InDiscussion", "Confirmed"];

async function zeroPayCustomerContext(customerId) {
  if (!customerId) return { loggedIn: false };
  const id = String(customerId);
  const [activeZeroPayBookings, completedBookings] = await Promise.all([
    Booking.countDocuments({ customerId: id, paymentType: "FreeBooking", status: { $in: OPEN_BOOKING_STATUSES } }),
    Booking.countDocuments({ customerId: id, status: "Completed" }),
  ]);
  return { loggedIn: true, outstandingBalance: 0, activeZeroPayBookings, completedBookings };
}

export async function computeQuoteForLines(lines, discount = 0, { customerId = null } = {}) {
  if (!lines || lines.length === 0) return null;

  const packageIds = [...new Set(lines.map((l) => String(l.packageId)))];
  const packages = await Package.find({ _id: { $in: packageIds } }).select("+commercial").lean();
  const packageById = new Map(packages.map((p) => [String(p._id), p]));

  // Vendors — needed for the convenience-fee score (bookingsPerYear /
  // experience / teamSize). line.vendorId is whatever resolveVendorRefId
  // (utils/resolveVendor.js) wrote onto the line/item — that helper's return
  // convention flipped 2026-09-24 from the Vendor's Mongo _id to its public
  // "VEN..." id (to fix vendor bookings/enquiries lookups), which made a
  // plain `_id` match here throw a CastError for every checkout (real bug,
  // found live: "Cast to ObjectId failed for value \"VEN...\"). Matching on
  // EITHER shape — a valid ObjectId via `_id`, or the public id via `id` —
  // is correct both for lines written under the old convention and the new
  // one, so this doesn't silently break again on the next such flip.
  const vendorIds = [...new Set(lines.map((l) => String(l.vendorId)).filter(Boolean))];
  const validObjectIds = vendorIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  // gstNumber selected ONLY to gate GST below (computeGst's vendorHasGst) —
  // never attached to anything serialized back to the customer; this map
  // stays purely internal to this function. See computeGst's own comment.
  const vendors = vendorIds.length
    ? await Vendor.find({ $or: [{ _id: { $in: validObjectIds } }, { id: { $in: vendorIds } }] })
        .select("id bookingsPerYear experience teamSize gstNumber commercial")
        .lean()
    : [];
  const vendorById = new Map(vendors.flatMap((v) => [[String(v._id), v], [v.id, v]]));

  const feeDisabled = convenienceFeeDisabled();
  const now = new Date();
  const hiddenVendors = new Set(await hiddenVendorKeys());
  const rules = await getActiveRules();
  const customer = await zeroPayCustomerContext(customerId);

  const lineQuotes = lines.map((item) => {
    const pkg = packageById.get(String(item.packageId));
    // A hidden vendor's package (utils/customerVisibility.js) can't be bought either.
    if (!pkg || pkg.packageStatus !== "Live" || hiddenVendors.has(String(pkg.vendorId))) {
      return {
        lineId: item.lineId,
        vendorId: item.vendorId,
        packageId: item.packageId,
        available: false,
        note: "This package is no longer Live — excluded from the quote. Remove or replace it before checkout.",
      };
    }

    // getEffectivePackagePrice (not a plain ?? 0) — see that util's own
    // comment (rewritten 2026-09-09 after a real customer-reported PDP-vs-
    // cart price mismatch): this is base price (packagePricing.price, or
    // summed setups[].price for Decorator) PLUS teamAndEquipment.price as a
    // real, separate, ALWAYS-additive charge — not a fallback substitute
    // for one another. Was silently dropping teamAndEquipment.price
    // whenever packagePricing.price was already set (most packages outside
    // Decorator/Caterer), undercharging every quote with one configured.
    // Package.commercial.vendorB2BPrice when the vendor has set one (PRD
    // §6.2) — always pre-GST — else the same effective price as before,
    // which follows the package's own gstInclusive setting.
    const explicitB2B = pkg.commercial?.vendorB2BPrice != null;
    const currentPrice = explicitB2B ? pkg.commercial.vendorB2BPrice : getEffectivePackagePrice(pkg);
    const quantity = item.quantity || 1;
    const addonsTotal = (item.selectedAddOns || []).reduce((sum, a) => sum + a.price * a.quantity, 0);
    const chargeableItemsTotal = (item.selectedItems || []).filter((s) => s.isChargeable).reduce((sum, s) => sum + (s.price || 0), 0);
    const packagePriceTotal = round2(currentPrice * quantity);
    const lineSubtotal = round2(packagePriceTotal + addonsTotal + chargeableItemsTotal);

    const vendor = vendorById.get(String(pkg.vendorId)) || vendorById.get(String(item.vendorId));
    const vendorHasGst = Boolean(vendor?.gstNumber);
    // A vendor-entered B2B price is pre-GST, so its GST is always added on top.
    const gstCharges = explicitB2B ? { ...pkg.step3_policiesAndCharges, gstInclusive: false } : pkg.step3_policiesAndCharges;
    const { gstInclusive, gstRatePercent, gstAmount } = computeGst(lineSubtotal, gstCharges, vendorHasGst);
    // gstAmount is null both when GST isn't configured AND when it's
    // inclusive (see computeGst) — either way, nothing to add on top.
    const lineTotalInclGst = gstAmount == null ? lineSubtotal : round2(lineSubtotal + gstAmount);

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

    // Commercial Engine — Vendor B2B for the line is its PRE-GST subtotal
    // (package price × quantity + add-ons + chargeable items). When the price
    // already includes the vendor's GST, the GST is taken out of it, so
    // commission, fee, TCS and band are never computed on tax; the customer
    // total (B2B + vendor GST) is still exactly lineTotalInclGst.
    const { vendorB2B: lineB2B, vendorGst: lineVendorGst } = gstInclusive
      ? splitVendorPrice(lineSubtotal, { step3_policiesAndCharges: gstCharges }, vendor)
      : { vendorB2B: lineSubtotal, vendorGst: gstAmount || 0 };
    const bookingMode = defaultBookingMode(pkg);
    const { baseline } = buildBaseline({ pkg, vendor, rules, vendorB2B: lineB2B });
    const priced = priceLine(
      {
        vendor: buildEngineVendor(vendor, { vendorGst: lineVendorGst }),
        baseline,
        runtime: {
          bookingMode,
          negotiationMode: pkg.commercial?.negotiationMode ?? "NONE",
          eventDate: item.eventDetails?.date,
          bookingDate: now,
          customer,
        },
      },
      rules
    );
    const engineFee = Boolean(priced.serviceFee);
    const convenience = feeDisabled
      ? { configured: false, fee: null, reason: "Convenience fee is disabled (CONVENIENCE_FEE_DISABLED)" }
      : engineFee
        ? { configured: true, fee: round2(priced.serviceFee.taxableFee + priced.serviceFee.gstOnFee), reason: null }
        : { configured: false, fee: null, reason: customerSafeReasons(priced.reasonCodes).join(", ") };

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
      convenienceFee: convenience.fee,
      convenienceFeeConfigured: convenience.configured,
      convenienceFeeReason: convenience.reason,
      serviceFeeTaxable: convenience.configured ? priced.serviceFee.taxableFee : null,
      serviceFeeGst: convenience.configured ? priced.serviceFee.gstOnFee : null,
      // Customer-safe summary only: no category, PCI, commission or B2B.
      convenienceFeeBreakdown: convenience.configured
        ? { engine: "COMMERCIAL_V1", ratePct: priced.serviceFee.finalRate, gstPct: rules.tax.gstOnServiceFeePct }
        : null,
      bookingMode,
      commercialStatus: priced.status,
      commercialReasonCodes: customerSafeReasons(priced.reasonCodes),
      // Internal — frozen onto the Booking (commercialSnapshot), never
      // serialized to the customer (see stripCommercialInternals).
      _commercial: engineFee
        ? {
            ...toSnapshot(priced),
            bookingMode,
            negotiationMode: priced.inputs.negotiationMode,
            daysToEventAtBooking: priced.inputs.daysToEvent,
            commercialCategory: priced.inputs.category,
            packageBand: priced.inputs.band,
            pciBand: priced.inputs.pciBand,
            vendorServiceValue: priced.settlement.vendorServiceValue,
            vendorGst: priced.settlement.vendorGst,
            vendorCommissionRate: priced.commission.rate,
            vendorCommissionShadow: priced.commission.shadow,
            vendorCommissionInTrial: priced.commission.inTrial,
            gstOnCommission: priced.settlement.gstOnCommission,
            tcs: priced.settlement.tcs,
            vendorSettlement: priced.settlement.settlement,
            serviceFeeGst: priced.serviceFee.gstOnFee,
            customerPrice: priced.customer.displayPrice,
            cpci: priced.cpci.cpci,
            cpciBand: priced.cpci.band,
            serviceFeeCharged: convenience.configured,
            pricedAt: now,
          }
        : null,
    };
  });

  const availableLines = lineQuotes.filter((l) => l.available);

  const subtotal = round2(availableLines.reduce((sum, l) => sum + l.lineSubtotal, 0));
  const gstTotal = round2(availableLines.reduce((sum, l) => sum + (l.gstAmount || 0), 0));

  // Order-level convenience fee = sum of every available line's own fee.
  // A line whose fee is null (no event date, unknown vendor type, kill-
  // switch) contributes 0 — same "don't charge what can't be computed"
  // stance as the old flat-% version. convenienceFeeComplete says whether
  // EVERY available line produced a real fee, so the frontend can show
  // "₹X (+ more once you add event dates)" rather than a falsely-final
  // number.
  const convenienceFee = round2(availableLines.reduce((sum, l) => sum + (l.convenienceFee || 0), 0));
  const convenienceFeeComplete =
    availableLines.length > 0 && availableLines.every((l) => l.convenienceFeeConfigured);
  const convenienceFeeConfigured = convenienceFee > 0 || convenienceFeeComplete;

  // No order-level round-up any more: each line's convenienceFee already
  // lands its line on an attractive price point (engine merchandising), so
  // the total is simply the sum. Kept to the rupee for the payment gateway.
  const grandTotal = round2(Math.max(0, subtotal + gstTotal + convenienceFee - discount));

  // A line the engine couldn't approve for its booking mode (Quote below
  // CORE, weak PCI, fee ceiling breach, CPCI too high, Zero-Pay
  // ineligibility) can't be paid for at a fixed price — checkout refuses it.
  const commercialBlockedLines = availableLines
    .filter((l) => l.commercialStatus !== "APPROVED")
    .map((l) => ({ lineId: l.lineId, packageId: l.packageId, status: l.commercialStatus, reasonCodes: l.commercialReasonCodes }));

  // Reconcile the payment schedule against the real payable total. Each
  // line's milestones (computeLineMilestones above) only sum to that one
  // line's own tax-inclusive package total — convenienceFee, discount, and
  // the round-off gap above are order-level and never distributed into any
  // line's milestones, so concatenating every line's schedule would under-
  // or over-total against grandTotal (the exact "Payment Schedule modal
  // rows don't add up to the total" bug reported by PM, mirrored off the
  // business admin's custom-order schedule — see CustomOrderForm.tsx, which
  // injects the same kind of gap into the last/"Final Pay" milestone rather
  // than leaving it unreconciled). Fix: inject the gap into the LAST
  // milestone of the LAST available line, same "last slot absorbs the
  // drift" pattern bookingController.js already uses for whole-rupee
  // milestone rounding. (Since the Commercial Engine there's no order-level
  // round-off; the gap is the service fee less any discount.)
  const allMilestoneAmounts = availableLines.flatMap((l) =>
    l.milestones.map((m) => m.amount).filter((a) => a != null)
  );
  if (allMilestoneAmounts.length > 0) {
    const milestonesSum = round2(allMilestoneAmounts.reduce((sum, a) => sum + a, 0));
    const milestoneGap = round2(grandTotal - milestonesSum);
    if (milestoneGap !== 0) {
      outer: for (let i = availableLines.length - 1; i >= 0; i--) {
        const lineMilestones = availableLines[i].milestones;
        for (let j = lineMilestones.length - 1; j >= 0; j--) {
          if (lineMilestones[j].amount != null) {
            lineMilestones[j].amount = round2(lineMilestones[j].amount + milestoneGap);
            break outer;
          }
        }
      }
    }
  }

  const linesWithToken = availableLines.filter((l) => l.token.tokenConfigured);
  const allTokensConfigured = linesWithToken.length === availableLines.length && availableLines.length > 0;
  const rawTokenAmountTotal = round2(linesWithToken.reduce((sum, l) => sum + (l.token.tokenAmount || 0), 0));

  // Round the advance ("Pay now to confirm") due at booking up to the next
  // ₹100 — same rule, and the same reason, as grandTotal's own round-off
  // above: a clean number at the point of payment rather than an odd
  // percentage-derived figure (e.g. 25% of ₹46,787 = ₹11,696.75). Capped at
  // grandTotal so rounding up can never ask for more than the whole booking
  // costs. The gap this creates is pushed into the LAST priced line's own
  // token.tokenAmount — same "last slot absorbs the drift" reconciliation
  // the milestone schedule above already uses — so the per-line amount
  // that actually gets saved onto that line's Booking.totalReceived
  // (bookingCreationService.js) still sums to the exact amount Cashfree
  // charges, instead of a display-only rounding that drifts from what's
  // persisted.
  const tokenAmountTotal = allTokensConfigured
    ? Math.min(rawTokenAmountTotal > 0 ? Math.ceil(rawTokenAmountTotal / 100) * 100 : 0, grandTotal)
    : null;
  if (allTokensConfigured && tokenAmountTotal !== rawTokenAmountTotal) {
    const tokenRoundOffGap = round2(tokenAmountTotal - rawTokenAmountTotal);
    const lastTokenLine = linesWithToken[linesWithToken.length - 1];
    lastTokenLine.token.tokenAmount = round2((lastTokenLine.token.tokenAmount || 0) + tokenRoundOffGap);
    lastTokenLine.token.remaining = round2(lastTokenLine.lineTotalInclGst - lastTokenLine.token.tokenAmount);
  }

  const remainingTotal = allTokensConfigured ? round2(grandTotal - tokenAmountTotal) : null;

  // Internal engine snapshots are lifted off the customer-facing lines.
  // Callers persist them server-side (CheckoutSession.commercialSnapshots)
  // and must never send them to the customer — they hold commission,
  // category, PCI and B2B economics (PRD §17.4).
  const commercialSnapshots = {};
  for (const l of lineQuotes) {
    if (l._commercial) commercialSnapshots[String(l.lineId)] = l._commercial;
    delete l._commercial;
  }

  return {
    commercialSnapshots,
    lines: lineQuotes,
    subtotal,
    gstTotal,
    convenienceFee,
    convenienceFeeConfigured,
    convenienceFeeComplete,
    discount,
    grandTotal,
    tokenAmountTotal: allTokensConfigured ? tokenAmountTotal : null,
    remainingTotal,
    allTokensConfigured,
    commercialBlockedLines,
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

  const quote = await computeQuoteForLines(lines, cart.coupon?.discountAmount || 0, { customerId: cart.customerId });
  if (quote) delete quote.commercialSnapshots;
  return quote;
}

export default computeCartQuote;
