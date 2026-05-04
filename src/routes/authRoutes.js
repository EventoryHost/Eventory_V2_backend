import express from "express";
import { loginOrSignUp, verifyOtp } from "../controllers/authController.js";

const router = express.Router();

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Initiate Login or Sign Up
 *     description: Sends an OTP to the provided mobile number.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mobile
 *             properties:
 *               mobile:
 *                 type: string
 *                 example: "9876543210"
 *                 description: 10-digit mobile number without country code
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       400:
 *         description: Mobile number is required
 */
router.post("/login", loginOrSignUp);
/**
 * @swagger
 * /api/auth/verify-otp:
 *   post:
 *     summary: Verify OTP and Login
 *     description: Verifies the OTP sent to the user and returns a JWT token along with vendor details.
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mobile
 *               - code
 *               - session
 *             properties:
 *               mobile:
 *                 type: string
 *                 example: "9876543210"
 *               code:
 *                 type: string
 *                 example: "123456"
 *                 description: The OTP received
 *               session:
 *                 type: string
 *                 example: "cognito-session-string"
 *               name:
 *                 type: string
 *                 example: "John Doe"
 *                 description: Optional POC name for new sign-ups
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: Missing required fields
 */
router.post("/verify-otp", verifyOtp);

export default router;
