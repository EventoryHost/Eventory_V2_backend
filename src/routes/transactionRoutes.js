import express from "express";
const router = express.Router();
import {
  getEarningsOverview,
  getEarningsAnalytics,
  getUpcomingTransactions,
  getPaymentTimeline,
} from "../controllers/transactionController.js";

/**
 * @swagger
 * tags:
 *   name: Transactions
 *   description: |
 *     Vendor earnings dashboard and payment tracking. Provides revenue
 *     overview, analytics charts, upcoming payments, and per-booking
 *     payment timelines with milestone tracking.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Transaction:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         transactionId:
 *           type: string
 *           description: "Human-readable ID, e.g. TXN20260615..."
 *         vendorId:
 *           type: string
 *         bookingId:
 *           type: string
 *         customerName:
 *           type: string
 *         eventDate:
 *           type: string
 *           format: date
 *         milestoneTitle:
 *           type: string
 *           example: "Token"
 *         amount:
 *           type: number
 *         status:
 *           type: string
 *           enum: [Received, Pending, PaymentDue]
 *         receivedDate:
 *           type: string
 *           format: date-time
 */

// ============================================================
//  EARNINGS
// ============================================================

/**
 * @swagger
 * /api/transactions/vendor/{vendorId}/earnings:
 *   get:
 *     summary: Get vendor earnings overview
 *     description: |
 *       Returns total revenue, percentage change vs previous period,
 *       available to accept, due amount, payout expected date, and
 *       linked bank details.
 *
 *       Supported periods: `1W` (1 week), `1M` (1 month), `6M` (6 months), `1Y` (1 year).
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [1W, 1M, 6M, 1Y]
 *           default: "1M"
 *         description: "Time period filter"
 *     responses:
 *       200:
 *         description: Earnings overview
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 period:
 *                   type: string
 *                 totalRevenue:
 *                   type: number
 *                   example: 285400
 *                 percentageChange:
 *                   type: number
 *                   description: "% change vs previous period. Null if no previous data."
 *                   example: 12
 *                 availableToAccept:
 *                   type: number
 *                   example: 92500
 *                 dueAmount:
 *                   type: number
 *                   example: 12500
 *                 payoutExpectedDate:
 *                   type: string
 *                   example: "2026-04-25"
 *                 bankDetails:
 *                   type: object
 *                   properties:
 *                     accountNumber:
 *                       type: string
 *                     ifscCode:
 *                       type: string
 *                     bankName:
 *                       type: string
 *                     branchName:
 *                       type: string
 *       404:
 *         description: Vendor not found
 *       500:
 *         description: Server error
 */
router.get("/vendor/:vendorId/earnings", getEarningsOverview);

/**
 * @swagger
 * /api/transactions/vendor/{vendorId}/analytics:
 *   get:
 *     summary: Get earnings analytics (bar chart data)
 *     description: |
 *       Returns revenue aggregated by day of week for the bar chart.
 *       Each data point includes the day name, total amount, and transaction count.
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [1W, 1M, 6M, 1Y]
 *           default: "1M"
 *     responses:
 *       200:
 *         description: Analytics data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 period:
 *                   type: string
 *                 chartData:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       day:
 *                         type: string
 *                         example: "Mon"
 *                       totalAmount:
 *                         type: number
 *                       count:
 *                         type: number
 *       404:
 *         description: Vendor not found
 *       500:
 *         description: Server error
 */
router.get("/vendor/:vendorId/analytics", getEarningsAnalytics);

// ============================================================
//  TRANSACTION LISTING
// ============================================================

/**
 * @swagger
 * /api/transactions/vendor/{vendorId}/upcoming:
 *   get:
 *     summary: Get upcoming transactions
 *     description: |
 *       Returns a paginated list combining:
 *       - Upcoming payment milestones from active bookings (Pending/PaymentDue)
 *       - Recent received transactions
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Upcoming transactions
 *       404:
 *         description: Vendor not found
 *       500:
 *         description: Server error
 */
router.get("/vendor/:vendorId/upcoming", getUpcomingTransactions);

// ============================================================
//  PAYMENT TIMELINE
// ============================================================

/**
 * @swagger
 * /api/transactions/booking/{bookingId}/timeline:
 *   get:
 *     summary: Get payment timeline for a booking
 *     description: |
 *       Returns the full payment milestone timeline for a specific booking,
 *       including total amount, total received, next payment due, and all milestones.
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema:
 *           type: string
 *         description: "MongoDB _id or human-readable bookingId (EVT...)"
 *     responses:
 *       200:
 *         description: Payment timeline
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 bookingId:
 *                   type: string
 *                   example: "EVT20260615..."
 *                 customerName:
 *                   type: string
 *                 eventDate:
 *                   type: string
 *                   format: date
 *                 totalAmount:
 *                   type: number
 *                 totalReceived:
 *                   type: number
 *                 nextPaymentDue:
 *                   type: object
 *                   properties:
 *                     milestoneTitle:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     dueDate:
 *                       type: string
 *                       format: date
 *                     status:
 *                       type: string
 *                 milestones:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       type:
 *                         type: string
 *                       amount:
 *                         type: number
 *                       dueDate:
 *                         type: string
 *                         format: date
 *                       status:
 *                         type: string
 *                       receivedDate:
 *                         type: string
 *                         format: date-time
 *       404:
 *         description: Booking not found
 *       500:
 *         description: Server error
 */
router.get("/booking/:bookingId/timeline", getPaymentTimeline);

export default router;
