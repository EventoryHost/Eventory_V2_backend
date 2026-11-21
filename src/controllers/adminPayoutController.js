import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";
import Vendor from "../models/Vendor.js";
import Booking from "../models/Booking.js";
import { round2 } from "../utils/money.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { PayoutError, disburseToVendor } from "../services/vendorPayoutService.js";
import { notifyVendor } from "../services/vendorNotificationService.js";

/**
 * The vendor payout queue. Every customer payment that clears leaves a
 * Transaction { status: "PaymentDue" } recording what the vendor is owed
 * (services/vendorPayoutService.js recordVendorMilestoneDue). Nothing is paid
 * automatically: the team reviews each due record here, approves it, and the
 * transfer goes out through Cashfree Payouts. The record is then settled in
 * place (Received + transfer ids), so the vendor's earnings and the booking
 * both show the payout.
 */

const STATUSES = ["PaymentDue", "Pending", "Received"];
// Bookings whose money should not go out without a second look.
const BLOCKED_BOOKING_STATUSES = ["Cancelled", "Declined"];

const queryString = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

const transactionLookup = (ref) =>
  mongoose.isValidObjectId(ref) && /^[0-9a-fA-F]{24}$/.test(ref)
    ? { $or: [{ transactionId: ref }, { _id: ref }] }
    : { transactionId: ref };

const findVendor = (ref) =>
  Vendor.findOne(
    /^[0-9a-fA-F]{24}$/.test(String(ref)) ? { $or: [{ id: ref }, { _id: ref }] } : { id: ref }
  );

/**
 * @route GET /api/admin/payouts
 * @query status (PaymentDue | Pending | Received | all; default PaymentDue),
 *        vendor (public id, _id or business name), bookingId, from, to, page, limit
 */
export const listPayouts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const status = queryString(req.query.status) || "PaymentDue";

    const filter = {};
    if (status !== "all") {
      if (!STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: `status must be one of ${STATUSES.join(", ")} or all` });
      }
      filter.status = status;
    }
    const bookingId = queryString(req.query.bookingId);
    if (bookingId) filter.bookingId = bookingId;

    const vendor = queryString(req.query.vendor);
    if (vendor) {
      const rx = { $regex: escapeRegex(vendor.slice(0, 100)), $options: "i" };
      const matches = await Vendor.find({
        $or: [{ id: vendor }, { businessName: rx }, ...(/^[0-9a-fA-F]{24}$/.test(vendor) ? [{ _id: vendor }] : [])],
      })
        .select("_id id")
        .limit(200)
        .lean();
      const refs = new Set([vendor]);
      matches.forEach((v) => {
        if (v.id) refs.add(v.id);
        refs.add(String(v._id));
      });
      filter.vendorId = { $in: [...refs] };
    }

    const from = queryString(req.query.from);
    const to = queryString(req.query.to);
    if (from || to) {
      filter.createdAt = {};
      if (from && !Number.isNaN(Date.parse(from))) filter.createdAt.$gte = new Date(from);
      if (to && !Number.isNaN(Date.parse(to))) {
        const end = new Date(to);
        end.setUTCHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const [rows, total, totals] = await Promise.all([
      Transaction.find(filter)
        .sort({ createdAt: status === "Received" ? -1 : 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(filter),
      Transaction.aggregate([
        { $match: filter },
        { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount" } } },
      ]),
    ]);

    const vendorIds = [...new Set(rows.map((r) => String(r.vendorId)).filter(Boolean))];
    const bookingIds = [...new Set(rows.map((r) => r.bookingId).filter(Boolean))];
    const [vendors, bookings] = await Promise.all([
      Vendor.find({
        $or: [
          { id: { $in: vendorIds } },
          { _id: { $in: vendorIds.filter((id) => /^[0-9a-fA-F]{24}$/.test(id)) } },
        ],
      })
        .select("_id id businessName phone bankDetails.accountNumber bankDetails.ifscCode bankDetails.bankName")
        .lean(),
      Booking.find({ bookingId: { $in: bookingIds } })
        .select("_id bookingId status eventDate packageSnapshot.name totalAmount totalReceived customer.name")
        .lean(),
    ]);
    const vendorByRef = new Map();
    vendors.forEach((v) => {
      if (v.id) vendorByRef.set(v.id, v);
      vendorByRef.set(String(v._id), v);
    });
    const bookingByRef = new Map(bookings.map((b) => [b.bookingId, b]));

    const data = rows.map((row) => {
      const v = vendorByRef.get(String(row.vendorId));
      const b = row.bookingId ? bookingByRef.get(row.bookingId) : null;
      const bank = v?.bankDetails?.[0];
      return {
        ...row,
        vendor: v
          ? {
              _id: v._id,
              id: v.id ?? null,
              businessName: v.businessName ?? null,
              phone: v.phone ?? null,
              hasBank: Boolean(bank?.accountNumber && bank?.ifscCode),
              bankLabel: bank?.accountNumber
                ? `${bank.bankName || "Bank"} ••${String(bank.accountNumber).slice(-4)}`
                : null,
            }
          : null,
        booking: b
          ? {
              _id: b._id,
              bookingId: b.bookingId,
              status: b.status,
              eventDate: b.eventDate,
              packageName: b.packageSnapshot?.name ?? null,
              customerName: b.customer?.name ?? null,
              totalAmount: b.totalAmount ?? null,
              totalReceived: b.totalReceived ?? null,
            }
          : null,
      };
    });

    return res.status(200).json({
      success: true,
      data,
      totals: Object.fromEntries(totals.map((t) => [t._id, { count: t.count, amount: round2(t.amount) }])),
      pagination: { total, page, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @route POST /api/admin/payouts/:transactionId/approve
 * @body  { amount?, transferMode?, remarks?, bankAccountId?, force? }
 *
 * Approves one due record and pays it. `amount` overrides the suggested net
 * figure the record carries. The record is claimed (PaymentDue → Pending)
 * before any money moves, so two clicks — or two admins — can't pay it twice;
 * a failed transfer puts it back to PaymentDue.
 */
export const approvePayout = async (req, res) => {
  const ref = String(req.params.transactionId || "");
  let claimed = null;
  try {
    const { amount, transferMode, remarks, bankAccountId, force } = req.body || {};
    const tx = await Transaction.findOne(transactionLookup(ref));
    if (!tx) return res.status(404).json({ success: false, message: "Payout record not found" });
    if (tx.status !== "PaymentDue") {
      return res.status(409).json({ success: false, message: `This payout is already ${tx.status === "Received" ? "paid" : "being processed"}.` });
    }

    const payAmount = amount != null ? round2(Number(amount)) : round2(tx.amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      return res.status(400).json({ success: false, message: "Valid positive amount is required" });
    }

    if (tx.bookingId && force !== true) {
      const booking = await Booking.findOne({ bookingId: tx.bookingId }).select("status").lean();
      if (booking && BLOCKED_BOOKING_STATUSES.includes(booking.status)) {
        return res.status(409).json({
          success: false,
          code: "BOOKING_NOT_ACTIVE",
          message: `The booking is ${booking.status}. Check refunds before paying the vendor, or approve with override.`,
        });
      }
    }

    const vendor = await findVendor(tx.vendorId);
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    claimed = await Transaction.findOneAndUpdate(
      { _id: tx._id, status: "PaymentDue" },
      { $set: { status: "Pending" } },
      { new: true }
    );
    if (!claimed) {
      return res.status(409).json({ success: false, message: "This payout is already being processed." });
    }

    const mode = String(transferMode || "neft").toLowerCase();
    let transfer;
    try {
      transfer = await disburseToVendor(vendor, payAmount, {
        bankAccountId,
        transferMode: mode,
        remarks: remarks || `${tx.bookingId || "Payout"} ${tx.milestoneTitle || ""}`.trim(),
      });
    } catch (payoutError) {
      await Transaction.updateOne({ _id: tx._id, status: "Pending" }, { $set: { status: "PaymentDue" } });
      claimed = null;
      if (payoutError instanceof PayoutError) {
        return res.status(payoutError.status).json({
          success: false,
          message: payoutError.message,
          ...(payoutError.details ? { details: payoutError.details } : {}),
        });
      }
      throw payoutError;
    }

    const settled = await Transaction.findByIdAndUpdate(
      tx._id,
      {
        $set: {
          status: "Received",
          receivedDate: new Date(),
          amount: payAmount,
          transferId: transfer.transferId,
          settledByTransferId: transfer.transferId,
          cfTransferStatus: transfer.tData?.status || "SUCCESS",
          transferMode: transfer.transferMode,
        },
      },
      { new: true }
    ).lean();
    claimed = null;

    notifyVendor("payments.payoutProcessed", {
      vendorId: vendor.id,
      bookingId: tx.bookingId,
      amount: payAmount,
      dedupeKey: `payments.payout:${transfer.transferId}`,
    });

    return res.status(200).json({ success: true, data: settled, transfer: transfer.tData });
  } catch (error) {
    // The transfer may or may not have gone out — leave a claimed record as
    // Pending for the team to check in Cashfree rather than reopening it.
    console.error(`[adminPayout] approve ${ref} failed:`, error);
    return res.status(500).json({
      success: false,
      message: claimed
        ? `${error.message}. The record is left as Pending — check the transfer in Cashfree before retrying.`
        : error.message,
    });
  }
};

/**
 * @route PUT /api/admin/payouts/:transactionId/reopen
 * Puts a record stuck in Pending (a transfer whose outcome was unclear) back
 * into the queue once the team has checked Cashfree.
 */
export const reopenPayout = async (req, res) => {
  try {
    const tx = await Transaction.findOneAndUpdate(
      { ...transactionLookup(String(req.params.transactionId || "")), status: "Pending" },
      { $set: { status: "PaymentDue" } },
      { new: true }
    ).lean();
    if (!tx) return res.status(409).json({ success: false, message: "Only a Pending payout can be reopened." });
    return res.status(200).json({ success: true, data: tx });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
