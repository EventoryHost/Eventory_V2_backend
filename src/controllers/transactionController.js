import Transaction from "../models/Transaction.js";
import Booking from "../models/Booking.js";
import Vendor from "../models/Vendor.js";

// ─── Helpers ────────────────────────────────────────────────

const resolveVendorId = async (vendorId) => {
  if (typeof vendorId === "string" && vendorId.startsWith("VEN")) {
    const vendorDoc = await Vendor.findOne({ id: vendorId });
    if (!vendorDoc) return null;
    return vendorDoc._id;
  }
  return vendorId;
};

/**
 * Get the start date for a time period filter.
 */
const getPeriodStartDate = (period) => {
  const now = new Date();
  switch (period) {
    case "1W":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "1M":
      return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case "6M":
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case "1Y":
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    default:
      return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); // default 1M
  }
};

// ─── Controllers ────────────────────────────────────────────

/**
 * @desc    Get earnings overview for vendor
 * @route   GET /api/transactions/vendor/:vendorId/earnings?period=1M
 */
export const getEarningsOverview = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { period = "1M" } = req.query;

    const actualVendorId = await resolveVendorId(vendorId);
    if (!actualVendorId) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Vendor not found" });
    }

    const periodStart = getPeriodStartDate(period);
    const now = new Date();

    // Total revenue in the period (received transactions)
    const revenueResult = await Transaction.aggregate([
      {
        $match: {
          vendorId: actualVendorId,
          status: "Received",
          receivedDate: { $gte: periodStart, $lte: now },
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const totalRevenue = revenueResult[0]?.totalRevenue || 0;

    // Previous period revenue for comparison
    const periodDuration = now.getTime() - periodStart.getTime();
    const prevPeriodStart = new Date(periodStart.getTime() - periodDuration);

    const prevRevenueResult = await Transaction.aggregate([
      {
        $match: {
          vendorId: actualVendorId,
          status: "Received",
          receivedDate: { $gte: prevPeriodStart, $lte: periodStart },
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$amount" },
        },
      },
    ]);

    const prevRevenue = prevRevenueResult[0]?.totalRevenue || 0;
    const percentageChange =
      prevRevenue > 0
        ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100)
        : null;

    // Available to accept — sum of Received transactions not yet paid out
    // (Simplified: all received in the period)
    const availableToAccept = totalRevenue;

    // Due amount — sum of PaymentDue milestones across all active bookings
    const dueBookings = await Booking.find({
      vendorId: actualVendorId,
      status: { $in: ["Accepted", "Pending"] },
    });

    let dueAmount = 0;
    for (const booking of dueBookings) {
      for (const milestone of booking.paymentMilestones) {
        if (milestone.status === "PaymentDue") {
          dueAmount += milestone.amount || 0;
        }
      }
    }

    // Payout expected date (simplified: 25th of current month or next month)
    const payoutDay = 25;
    let payoutDate;
    if (now.getDate() < payoutDay) {
      payoutDate = new Date(now.getFullYear(), now.getMonth(), payoutDay);
    } else {
      payoutDate = new Date(now.getFullYear(), now.getMonth() + 1, payoutDay);
    }

    // Fetch vendor bank details
    const vendor = await Vendor.findById(actualVendorId);

    return res.status(200).json({
      status: "SUCCESS",
      period,
      totalRevenue,
      percentageChange,
      availableToAccept,
      dueAmount,
      payoutExpectedDate: payoutDate.toISOString().split("T")[0],
      bankDetails: vendor?.bankDetails || null,
    });
  } catch (error) {
    console.error("Get Earnings Overview Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch earnings overview",
      error: error.message,
    });
  }
};

/**
 * @desc    Get earnings analytics (bar chart data by day of week)
 * @route   GET /api/transactions/vendor/:vendorId/analytics?period=1M
 */
export const getEarningsAnalytics = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { period = "1M" } = req.query;

    const actualVendorId = await resolveVendorId(vendorId);
    if (!actualVendorId) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Vendor not found" });
    }

    const periodStart = getPeriodStartDate(period);

    // Aggregate revenue by day of week
    const analytics = await Transaction.aggregate([
      {
        $match: {
          vendorId: actualVendorId,
          status: "Received",
          receivedDate: { $gte: periodStart },
        },
      },
      {
        $group: {
          _id: { $dayOfWeek: "$receivedDate" }, // 1=Sun, 2=Mon, ..., 7=Sat
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Map to day names
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const chartData = dayNames.map((day, index) => {
      const match = analytics.find((a) => a._id === index + 1);
      return {
        day,
        totalAmount: match?.totalAmount || 0,
        count: match?.count || 0,
      };
    });

    return res.status(200).json({
      status: "SUCCESS",
      period,
      chartData,
    });
  } catch (error) {
    console.error("Get Earnings Analytics Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch earnings analytics",
      error: error.message,
    });
  }
};

/**
 * @desc    Get upcoming transactions list
 * @route   GET /api/transactions/vendor/:vendorId/upcoming?page=1&limit=20
 */
export const getUpcomingTransactions = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const actualVendorId = await resolveVendorId(vendorId);
    if (!actualVendorId) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Vendor not found" });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get all active bookings with upcoming milestones
    const bookings = await Booking.find({
      vendorId: actualVendorId,
      status: { $in: ["Accepted", "Pending"] },
    })
      .sort({ eventDate: 1 })
      .lean();

    // Build upcoming list from payment milestones
    const upcoming = [];
    for (const booking of bookings) {
      for (const milestone of booking.paymentMilestones) {
        if (milestone.status !== "Received") {
          upcoming.push({
            bookingId: booking.bookingId,
            customerName: booking.customer.name,
            eventDate: booking.eventDate,
            milestoneType: milestone.type,
            amount: milestone.amount,
            dueDate: milestone.dueDate,
            status: milestone.status,
          });
        }
      }
    }

    // Also include recent received transactions
    const recentTransactions = await Transaction.find({
      vendorId: actualVendorId,
      status: "Received",
    })
      .sort({ receivedDate: -1 })
      .limit(10)
      .lean();

    const recentItems = recentTransactions.map((t) => ({
      transactionId: t.transactionId,
      bookingId: null,
      customerName: t.customerName,
      eventDate: t.eventDate,
      milestoneType: t.milestoneType,
      amount: t.amount,
      dueDate: null,
      status: t.status,
      receivedDate: t.receivedDate,
    }));

    // Combine and paginate
    const allItems = [...upcoming, ...recentItems];
    const paginated = allItems.slice(skip, skip + parseInt(limit));

    return res.status(200).json({
      status: "SUCCESS",
      count: paginated.length,
      total: allItems.length,
      page: parseInt(page),
      totalPages: Math.ceil(allItems.length / parseInt(limit)),
      transactions: paginated,
    });
  } catch (error) {
    console.error("Get Upcoming Transactions Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch upcoming transactions",
      error: error.message,
    });
  }
};

/**
 * @desc    Get payment timeline for a specific booking
 * @route   GET /api/transactions/booking/:bookingId/timeline
 */
export const getPaymentTimeline = async (req, res) => {
  try {
    const { bookingId } = req.params;

    let booking;
    if (bookingId.startsWith("EVT")) {
      booking = await Booking.findOne({ bookingId });
    } else {
      booking = await Booking.findById(bookingId);
    }

    if (!booking) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Booking not found" });
    }

    // Find the next payment due
    const nextDue = booking.paymentMilestones.find(
      (m) => m.status === "PaymentDue"
    );
    const nextPending = booking.paymentMilestones.find(
      (m) => m.status === "Pending"
    );
    const nextPayment = nextDue || nextPending;

    return res.status(200).json({
      status: "SUCCESS",
      bookingId: booking.bookingId,
      customerName: booking.customer.name,
      eventDate: booking.eventDate,
      totalAmount: booking.totalAmount,
      totalReceived: booking.totalReceived,
      nextPaymentDue: nextPayment
        ? {
            milestoneType: nextPayment.type,
            amount: nextPayment.amount,
            dueDate: nextPayment.dueDate,
            status: nextPayment.status,
          }
        : null,
      milestones: booking.paymentMilestones,
    });
  } catch (error) {
    console.error("Get Payment Timeline Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch payment timeline",
      error: error.message,
    });
  }
};
