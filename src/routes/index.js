import express from "express";
const router = express.Router();
import vendorRoutes from "./vendorRoutes.js";
import customerRoutes from "./customerRoutes.js";
import customerAuthRoutes from "./customerAuthRoutes.js";
import customerPhoneRoutes from "./customerPhoneRoutes.js";
import customerDiscoveryRoutes from "./customerDiscoveryRoutes.js";
import customerWishlistRoutes from "./customerWishlistRoutes.js";
import customerCompareRoutes from "./customerCompareRoutes.js";
import customerCartRoutes from "./customerCartRoutes.js";
import customerCheckoutRoutes from "./customerCheckoutRoutes.js";
import customerPaymentRoutes from "./customerPaymentRoutes.js";
import customerBookingRoutes from "./customerBookingRoutes.js";
import authRoutes from "./authRoutes.js";
import verificationRoutes from "./verificationRoutes.js";
import packageRoutes from "./packageRoutes.js";
import templateRoutes from "./templateRoutes.js";
import calendarRoutes from "./calendarRoutes.js";
import bookingRoutes from "./bookingRoutes.js";
import enquiryRoutes from "./enquiryRoutes.js";
import transactionRoutes from "./transactionRoutes.js";
import redirectRoutes from "./redirectRoutes.js";

/**
 * API namespace convention:
 *  - Plain CRUD on an actor's own resource stays flat + plural, matching the
 *    existing vendor style: /api/vendors, /api/customers.
 *  - Anything that isn't simple CRUD, or that could otherwise collide in
 *    name/semantics with an equivalent vendor-facing route, is namespaced
 *    under /api/customer/<feature>: e.g. /api/customer/auth today, and
 *    future additions like /api/customer/cart, /api/customer/wishlist,
 *    /api/customer/bookings ("my bookings", distinct from the vendor's
 *    /api/bookings which lists a vendor's incoming bookings).
 *  - Vendor routes were built before this convention existed and stay as
 *    they are (flat, e.g. /api/auth for vendor auth) rather than being
 *    renamed — renaming a live vendor endpoint is a breaking change with no
 *    benefit to the customer-side build.
 */

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: API Health Check
 *     description: Returns the status of the API server.
 *     tags:
 *       - System
 *     responses:
 *       200:
 *         description: Server is running successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Server is running
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
// Health check
router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

// Mount feature routes below
router.use("/vendors", vendorRoutes);
router.use("/customers", customerRoutes);
router.use("/customer/auth", customerAuthRoutes);
router.use("/customer/phone", customerPhoneRoutes);
router.use("/customer", customerDiscoveryRoutes);
router.use("/customer/wishlist", customerWishlistRoutes);
router.use("/customer/compare", customerCompareRoutes);
router.use("/customer/cart", customerCartRoutes);
router.use("/customer/checkout", customerCheckoutRoutes);
router.use("/customer/payments", customerPaymentRoutes);
router.use("/customer/bookings", customerBookingRoutes);
router.use("/auth", authRoutes);
router.use("/verification", verificationRoutes);
router.use("/packages", packageRoutes);
router.use("/templates", templateRoutes);
router.use("/calendar", calendarRoutes);
router.use("/bookings", bookingRoutes);
router.use("/enquiries", enquiryRoutes);
router.use("/transactions", transactionRoutes);
router.use("/redirect", redirectRoutes);

export default router;

