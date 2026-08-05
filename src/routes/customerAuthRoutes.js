import express from "express";
import { loginOrSignUp, verifyOtp } from "../controllers/customerAuthController.js";

const router = express.Router();

/**
 * @swagger
 * /api/customer/auth/login:
 *   post:
 *     summary: Initiate customer Login or Sign Up
 *     description: Sends an OTP to the provided mobile number via the customer Cognito pool.
 *     tags:
 *       - Customer Authentication
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
 *               isSignup:
 *                 type: boolean
 *                 example: false
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       400:
 *         description: Invalid mobile number, or already registered when isSignup is true
 *       403:
 *         description: Account deactivated
 */
router.post("/login", loginOrSignUp);

/**
 * @swagger
 * /api/customer/auth/verify-otp:
 *   post:
 *     summary: Verify OTP and Login
 *     description: Verifies the OTP sent to the customer and returns a JWT token along with the customer profile. Creates the customer profile on first-time login.
 *     tags:
 *       - Customer Authentication
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
 *               session:
 *                 type: string
 *                 example: "cognito-session-string"
 *               name:
 *                 type: string
 *                 example: "Jane Doe"
 *                 description: Optional, used only for first-time sign-up
 *               email:
 *                 type: string
 *                 example: "jane@example.com"
 *                 description: Optional, used only for first-time sign-up
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: Missing required fields
 *       403:
 *         description: Account deactivated
 */
router.post("/verify-otp", verifyOtp);

export default router;
