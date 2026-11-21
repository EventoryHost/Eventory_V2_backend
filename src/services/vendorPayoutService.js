import axios from "axios";
import Transaction from "../models/Transaction.js";
import Vendor from "../models/Vendor.js";
import generateUniqueId from "../utils/generateId.js";
import { buildPayoutsHeaders, getPayoutsBaseUrl } from "../utils/cashfreePayoutsHelper.js";
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

/** A payout Cashfree refused, or one that can't be attempted — carries the HTTP status to answer with. */
export class PayoutError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = "PayoutError";
    this.status = status;
    this.details = details;
  }
}

const str = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * Sends `amount` to the vendor's bank account through Cashfree Payouts:
 * picks the bank account (`bankAccountId`, else the first one on file),
 * finds or registers the Cashfree beneficiary, then fires the transfer.
 *
 * Moves real money. Writes no Transaction — the caller records the transfer
 * (a manual payout creates one; an approved due record is settled in place).
 * Throws PayoutError for anything the admin should see.
 *
 * Shared by POST /api/admin/vendors/:id/payout and the payout queue
 * (POST /api/admin/payouts/:transactionId/approve).
 */
export async function disburseToVendor(vendor, amount, { bankAccountId, transferMode = "neft", remarks } = {}) {
  let bank = null;
  if (bankAccountId && Array.isArray(vendor.bankDetails)) {
    bank = vendor.bankDetails.find(
      (b) => (b._id && b._id.toString() === String(bankAccountId)) || b.beneficiaryId === String(bankAccountId)
    );
  }
  if (!bank && Array.isArray(vendor.bankDetails) && vendor.bankDetails.length > 0) {
    if (!bankAccountId) {
      bank = vendor.bankDetails[0];
    }
  }

  if (!bank || !bank.accountNumber || !bank.ifscCode) {
    throw new PayoutError(400, "No valid bank account details (account number and IFSC) found for payout");
  }

  let beneficiaryId = bank.beneficiaryId;

  const pBase = getPayoutsBaseUrl();
  const pHeaders = buildPayoutsHeaders();

  // Check if beneficiary already exists in Cashfree
  let exists = false;

  // 1. First attempt: check by beneficiary_id if present
  if (beneficiaryId) {
    try {
      const beneResp = await axios.get(`${pBase}/beneficiary`, {
        headers: pHeaders,
        params: { beneficiary_id: beneficiaryId },
      });
      if (beneResp?.status === 200) {
        exists = true;
      }
    } catch (e) {
      if (e?.response?.status !== 404) {
        console.error(
          `[VendorPayout] Cashfree beneficiary lookup by ID failed for ${beneficiaryId}:`,
          e?.response?.data || e.message
        );
      }
    }
  }

  // 2. Second attempt: check by bank_account_number and bank_ifsc
  if (!exists) {
    try {
      const bankLookupResp = await axios.get(`${pBase}/beneficiary`, {
        headers: pHeaders,
        params: {
          bank_account_number: bank.accountNumber,
          bank_ifsc: bank.ifscCode,
        },
      });
      const matchedId =
        bankLookupResp?.data?.beneficiary_id ||
        bankLookupResp?.data?.data?.beneficiary_id;

      if (matchedId) {
        beneficiaryId = matchedId;
        bank.beneficiaryId = beneficiaryId;
        await Vendor.updateOne(
          { _id: vendor._id, "bankDetails._id": bank._id },
          { $set: { "bankDetails.$.beneficiaryId": beneficiaryId } }
        );
        exists = true;
      }
    } catch (e) {
      if (e?.response?.status !== 404) {
        console.error(
          `[VendorPayout] Cashfree beneficiary lookup by bank details failed:`,
          e?.response?.data || e.message
        );
      }
    }
  }

  // 3. Create beneficiary if not found in Cashfree
  if (!exists) {
    if (!beneficiaryId) {
      beneficiaryId = generateUniqueId("BENE");
      bank.beneficiaryId = beneficiaryId;
      await Vendor.updateOne(
        { _id: vendor._id, "bankDetails._id": bank._id },
        { $set: { "bankDetails.$.beneficiaryId": beneficiaryId } }
      );
    }

    try {
      const benePhone = (vendor.pocPhone || vendor.phone || "9999999999")
        .replace(/\D/g, "")
        .slice(-10)
        .padStart(10, "9");
      const beneEmail = vendor.email || "noreply@eventory.in";
      const beneName = bank.beneficiaryName || vendor.businessName || vendor.pocName || "Vendor";

      await axios.post(
        `${pBase}/beneficiary`,
        {
          beneficiary_id: beneficiaryId,
          beneficiary_name: beneName,
          beneficiary_instrument_details: {
            bank_account_number: bank.accountNumber,
            bank_ifsc: bank.ifscCode,
          },
          beneficiary_contact_details: {
            beneficiary_email: beneEmail,
            beneficiary_phone: benePhone,
            beneficiary_country_code: "+91",
          },
        },
        { headers: pHeaders }
      );
      exists = true;
    } catch (beneErr) {
      console.error(
        `[VendorPayout] Failed to create beneficiary ${beneficiaryId}:`,
        beneErr?.response?.data || beneErr.message
      );

      // Fallback: if already exists, fetch the existing beneficiary_id from Cashfree
      const isConflict =
        beneErr?.response?.status === 409 ||
        JSON.stringify(beneErr?.response?.data || "").toLowerCase().includes("already exists") ||
        (beneErr?.message || "").toLowerCase().includes("already exists");

      if (isConflict) {
        try {
          const fallbackLookup = await axios.get(`${pBase}/beneficiary`, {
            headers: pHeaders,
            params: {
              bank_account_number: bank.accountNumber,
              bank_ifsc: bank.ifscCode,
            },
          });
          const fallbackId =
            fallbackLookup?.data?.beneficiary_id ||
            fallbackLookup?.data?.data?.beneficiary_id;

          if (fallbackId) {
            beneficiaryId = fallbackId;
            bank.beneficiaryId = beneficiaryId;
            await Vendor.updateOne(
              { _id: vendor._id, "bankDetails._id": bank._id },
              { $set: { "bankDetails.$.beneficiaryId": beneficiaryId } }
            );
            exists = true;
          }
        } catch (lookupErr) {
          console.error(
            "[VendorPayout] Fallback beneficiary lookup failed:",
            lookupErr?.response?.data || lookupErr.message
          );
        }
      }

      if (!exists) {
        const errData = beneErr?.response?.data;
        const errMsg = errData?.message || beneErr.message || "Failed to create Cashfree beneficiary";
        throw new PayoutError(502, `Cashfree Beneficiary Error: ${errMsg}`, errData);
      }
    }
  }

  // Generate unique transfer ID
  const transferId = generateUniqueId("TRN");
  const transferRemarks = str(remarks).slice(0, 70) || "Vendor Payout";

  // Call Cashfree Payouts Transfers API
  let tData;
  try {
    const tResp = await axios.post(
      `${pBase}/transfers`,
      {
        transfer_id: transferId,
        transfer_amount: amount,
        beneficiary_details: { beneficiary_id: beneficiaryId },
        transfer_mode: transferMode,
        transfer_remarks: transferRemarks,
      },
      { headers: pHeaders }
    );
    tData = tResp?.data || {};
  } catch (tErr) {
    console.error(
      `[VendorPayout] Transfer failed for vendor ${vendor.id}:`,
      tErr?.response?.data || tErr.message
    );
    const errData = tErr?.response?.data;
    const errMsg = errData?.message || tErr.message || "Failed to initiate transfer";
    throw new PayoutError(502, `Cashfree Transfer Error: ${errMsg}`, errData);
  }


  return { transferId, tData, transferMode };
}

export default recordVendorMilestoneDue;
