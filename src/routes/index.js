import express from "express";
const router = express.Router();
import vendorRoutes from "./vendorRoutes.js";
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

