import Transaction from "../models/Transaction.js";
import { round2 } from "../utils/money.js";
import { bookingCommercialSnapshot } from "./commercial/commercialService.js";

// Flat GST-on-commission rate — matches v1's hardcoded `* 0.18` (commission
// * 18%, standard India GST), applied on top of whatever the commission is.
const GST_ON_COMMISSION_PERCENT = 18;

// LEGACY placeholder rate, kept only for bookings created before the
// Commercial Engine (no Booking.commercialSnapshot). Every booking priced by
// the engine carries its own commission — see engineCommissionForMilestone.
const PLACEHOLDER_COMMISSION_PERCENT = Number(process.env.VENDOR_COMMISSION_PERCENT) || 15;

/**
 * Legacy: commission = serviceCost x rate%; GST on that commission is a
 * further flat 18% — v1's formula with a flat placeholder rate.
 */
export function computeVendorCommission(serviceCost) {
  const commissionRatePercent = PLACEHOLDER_COMMISSION_PERCENT;
  const commission = round2(serviceCost * (commissionRatePercent / 100));
  const gstOnCommission = round2(commission * (GST_ON_COMMISSION_PERCENT / 100));
  const vendorReceivable = round2(Math.max(0, serviceCost - commission - gstOnCommission));
  return { commissionRatePercent, commission, gstOnCommission, tcs: 0, vendorReceivable, pricingRuleVersion: null };
}

/**
 * Commercial Engine split of one customer payment (PRD §15.2–15.4).
 *
 * The booking's commission, GST on it and TCS were fixed at checkout
 * (Booking.commercialSnapshot). Each milestone takes its proportional share
 * of the vendor invoice value; the running totals already recorded for the
 * booking cap every figure, so the milestones together never exceed the
 * snapshot — and the final milestone, which also carries the Eventory
 * Service Fee, only counts its vendor portion.
 */
async function engineCommissionForMilestone(booking, s, grossAmount) {
  const invoiceValue = round2((s.vendorServiceValue || 0) + (s.vendorGst || 0));

  const [prior] = await Transaction.aggregate([
    { $match: { bookingId: booking.bookingId } },
    {
      $group: {
        _id: null,
        vendorGross: { $sum: { $ifNull: ["$vendorGrossAmount", "$grossAmount"] } },
        commission: { $sum: { $ifNull: ["$commission", 0] } },
        gstOnCommission: { $sum: { $ifNull: ["$gstOnCommission", 0] } },
        tcs: { $sum: { $ifNull: ["$tcs", 0] } },
      },
    },
  ]);

  const vendorGross = round2(Math.max(0, Math.min(grossAmount, invoiceValue - (prior?.vendorGross || 0))));
  const share = invoiceValue > 0 ? vendorGross / invoiceValue : 0;
  const capped = (total, already) => round2(Math.max(0, Math.min(total * share, total - already)));

  const commission = capped(s.vendor_commission_at_booking || 0, prior?.commission || 0);
  const gstOnCommission = capped(s.gstOnCommission || 0, prior?.gstOnCommission || 0);
  const tcs = capped(s.tcs || 0, prior?.tcs || 0);

  return {
    commissionRatePercent: s.vendorCommissionRate ?? null,
    commission,
    gstOnCommission,
    tcs,
    vendorGross,
    vendorReceivable: round2(Math.max(0, vendorGross - commission - gstOnCommission - tcs)),
    pricingRuleVersion: s.pricing_rule_version ?? null,
  };
}

/**
 * Records that a vendor is now OWED money for a milestone the customer just
 * paid — called from milestonePaymentService.js and
 * bookingCreationService.js the instant a milestone clears. Does NOT move
 * any real money and never calls Cashfree Payouts: PM decision (2026-10-10)
 * is that approving and firing vendor payouts is entirely the business
 * admin portal's responsibility, against this same Transaction data — this
 * app's only job on the payout side is to save what's owed, not to pay it.
 *
 * The commission/vendorReceivable breakdown computed here is saved purely
 * as a SUGGESTED figure for whoever approves the payout to see and
 * override — not an amount enforced or sent anywhere by this app.
 */
export async function recordVendorMilestoneDue({ booking, milestoneTitle, grossAmount }) {
  if (!grossAmount || grossAmount <= 0) return null;

  const snapshot = await bookingCommercialSnapshot(booking);
  const split = snapshot
    ? await engineCommissionForMilestone(booking, snapshot, grossAmount)
    : computeVendorCommission(grossAmount);

  return Transaction.create({
    vendorId: booking.vendorId,
    bookingId: booking.bookingId,
    customerName: booking.customer?.name || null,
    eventDate: booking.eventDate || null,
    milestoneTitle,
    grossAmount: round2(grossAmount),
    vendorGrossAmount: split.vendorGross ?? round2(grossAmount),
    commission: split.commission,
    commissionRatePercent: split.commissionRatePercent,
    gstOnCommission: split.gstOnCommission,
    tcs: split.tcs,
    pricingRuleVersion: split.pricingRuleVersion,
    amount: split.vendorReceivable,
    status: "PaymentDue",
  });
}

export default recordVendorMilestoneDue;
