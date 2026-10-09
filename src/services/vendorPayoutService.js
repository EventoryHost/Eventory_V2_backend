import Transaction from "../models/Transaction.js";
import { round2 } from "../utils/money.js";

// Flat GST-on-commission rate — matches v1's hardcoded `* 0.18` (commission
// * 18%, standard India GST), applied on top of whatever the commission is.
const GST_ON_COMMISSION_PERCENT = 18;

// PLACEHOLDER commission rate (2026-10-08). v1's real rate is a CSV lookup
// table keyed by vendor category x price slab x days-until-event, hosted
// externally (CloudFront/S3) and not yet finalized/handed over by the
// business team (see csvDataService.ts / CustomOrderForm.tsx in the
// business_v1 repo for the real mechanism). PM's explicit instruction
// (2026-10-08): use a flat placeholder rate for now, swap in the real CSV
// lookup once provided. Every caller goes through computeVendorCommission
// below, so that swap only ever needs to happen in ONE place.
const PLACEHOLDER_COMMISSION_PERCENT = Number(process.env.VENDOR_COMMISSION_PERCENT) || 15;

/**
 * commission = serviceCost x rate%; GST on that commission is a further
 * flat 18% — exactly v1's formula (FinalOrderForm.tsx), just with a flat
 * placeholder rate in place of its CSV lookup.
 */
export function computeVendorCommission(serviceCost) {
  const commissionRatePercent = PLACEHOLDER_COMMISSION_PERCENT;
  const commission = round2(serviceCost * (commissionRatePercent / 100));
  const gstOnCommission = round2(commission * (GST_ON_COMMISSION_PERCENT / 100));
  const vendorReceivable = round2(Math.max(0, serviceCost - commission - gstOnCommission));
  return { commissionRatePercent, commission, gstOnCommission, vendorReceivable };
}

/**
 * Records that a vendor is now OWED money for a milestone the customer just
 * paid — called from milestonePaymentService.js and
 * bookingCreationService.js the instant a milestone clears. Does NOT move
 * any real money and never calls Cashfree Payouts: PM decision (2026-10-10)
 * is that approving and firing vendor payouts is entirely the business
 * admin portal's responsibility, against this same Transaction data — this
 * app's only job on the payout side is to save what's owed, not to pay it.
 * (An earlier build of this service DID fire the actual Cashfree transfer
 * itself, first automatically then via a manual admin-approval endpoint in
 * this backend — both removed per this decision; Transaction.js's
 * transferId/cfTransferStatus/settledByTransferId fields are left in place
 * since the business portal is expected to write back into the same
 * collection once it settles a payout, not because this app sets them.)
 *
 * The commission/vendorReceivable breakdown computed here is saved purely
 * as a SUGGESTED figure for whoever approves the payout to see and
 * override — not an amount enforced or sent anywhere by this app.
 */
export async function recordVendorMilestoneDue({ booking, milestoneTitle, grossAmount }) {
  if (!grossAmount || grossAmount <= 0) return null;

  const { commissionRatePercent, commission, gstOnCommission, vendorReceivable } = computeVendorCommission(grossAmount);

  return Transaction.create({
    vendorId: booking.vendorId,
    bookingId: booking.bookingId,
    customerName: booking.customer?.name || null,
    eventDate: booking.eventDate || null,
    milestoneTitle,
    grossAmount: round2(grossAmount),
    commission,
    commissionRatePercent,
    gstOnCommission,
    amount: vendorReceivable,
    status: "PaymentDue",
  });
}

export default recordVendorMilestoneDue;
