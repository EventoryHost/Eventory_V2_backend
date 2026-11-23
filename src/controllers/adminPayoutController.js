import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";
import Vendor from "../models/Vendor.js";
import Booking from "../models/Booking.js";
import { round2 } from "../utils/money.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { notifyVendor } from "../services/vendorNotificationService.js";

/**
 * The vendor payout register. Every customer payment that clears leaves a
 * Transaction { status: "PaymentDue" } recording what the vendor is owed
 * (services/vendorPayoutService.js recordVendorMilestoneDue).
 *
 * No money moves from here. Payouts are made offline (bank transfer, UPI,
 * cash…) and the team records each one against its booking: settling a due
 * record, or adding an entry for a payout that had none. The record then
 * reads Received with the payment details, so the vendor's earnings and the
 * booking both show it.
 */

const STATUSES = ["PaymentDue", "Pending", "Received"];
// Bookings whose money should not go out without a second look.
const BLOCKED_BOOKING_STATUSES = ["Cancelled", "Declined"];

const queryString = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

const transactionLookup = (ref) =>
  mongoose.isValidObjectId(ref) && /^[0-9a-fA-F]{24}$/.test(ref)
    ? { $or: [{ transactionId: ref }, { _id: ref }] }
    : { transactionId: ref };

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

// The payment details a recorded payout carries (Transaction schema fields).
const paymentFields = ({ amount, transferMode, transferId, paidAt }) => {
  const reference = String(transferId).trim();
  return {
    status: "Received",
    amount: round2(Number(amount)),
    transferMode: String(transferMode).toLowerCase(),
    transferId: reference,
    settledByTransferId: reference,
    // Not a Cashfree transfer — marks an offline payout recorded by the team.
    cfTransferStatus: "MANUAL",
    receivedDate: paidAt ? new Date(paidAt) : new Date(),
  };
};

const checkBookingActive = async (bookingId, force) => {
  if (!bookingId || force === true) return null;
  const booking = await Booking.findOne({ bookingId }).select("status").lean();
  if (booking && BLOCKED_BOOKING_STATUSES.includes(booking.status)) {
    return `The booking is ${booking.status}. Check refunds first, or record with override.`;
  }
  return null;
};

/**
 * @route POST /api/admin/payouts/:transactionId/record
 * @body  { amount, transferMode, transferId, paidAt?, force? }
 *
 * Records that the vendor has been paid (offline) for a due record. Only a
 * PaymentDue record can be settled, so the same payout can't be recorded twice.
 */
export const recordPayout = async (req, res) => {
  try {
    const ref = String(req.params.transactionId || "");
    const tx = await Transaction.findOne(transactionLookup(ref)).lean();
    if (!tx) return res.status(404).json({ success: false, message: "Payout record not found" });
    if (tx.status !== "PaymentDue") {
      return res.status(409).json({ success: false, message: "This payout is already recorded." });
    }
    const blocked = await checkBookingActive(tx.bookingId, req.body.force);
    if (blocked) return res.status(409).json({ success: false, code: "BOOKING_NOT_ACTIVE", message: blocked });

    const settled = await Transaction.findOneAndUpdate(
      { _id: tx._id, status: "PaymentDue" },
      { $set: paymentFields(req.body) },
      { new: true, runValidators: true }
    ).lean();
    if (!settled) return res.status(409).json({ success: false, message: "This payout is already recorded." });

    notifyVendor("payments.payoutProcessed", {
      vendorId: tx.vendorId,
      bookingId: tx.bookingId,
      amount: settled.amount,
      dedupeKey: `payments.payout:${settled.transactionId}`,
    });
    return res.status(200).json({ success: true, data: settled });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @route POST /api/admin/payouts
 * @body  { bookingId, milestoneTitle?, amount, transferMode, transferId, paidAt?, force? }
 *
 * Adds a payout the team made for a booking that has no due record for it
 * (e.g. money the customer paid the vendor's way offline). The vendor and the
 * customer/event details are taken from the booking.
 */
export const createPayout = async (req, res) => {
  try {
    const { bookingId, milestoneTitle } = req.body;
    const booking = await Booking.findOne(
      /^[0-9a-fA-F]{24}$/.test(bookingId) ? { $or: [{ bookingId }, { _id: bookingId }] } : { bookingId }
    )
      .select("bookingId vendorId customer.name eventDate status")
      .lean();
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    const blocked = await checkBookingActive(booking.bookingId, req.body.force);
    if (blocked) return res.status(409).json({ success: false, code: "BOOKING_NOT_ACTIVE", message: blocked });

    const fields = paymentFields(req.body);
    const created = await Transaction.create({
      vendorId: booking.vendorId,
      bookingId: booking.bookingId,
      customerName: booking.customer?.name || null,
      eventDate: booking.eventDate || null,
      milestoneTitle: String(milestoneTitle || "").trim() || "Manual Payout",
      grossAmount: fields.amount,
      vendorGrossAmount: fields.amount,
      ...fields,
    });

    notifyVendor("payments.payoutProcessed", {
      vendorId: booking.vendorId,
      bookingId: booking.bookingId,
      amount: fields.amount,
      dedupeKey: `payments.payout:${created.transactionId}`,
    });
    return res.status(201).json({ success: true, data: created.toObject() });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
