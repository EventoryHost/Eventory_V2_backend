import express from "express";
import { sendPhoneOtp, verifyPhoneOtp } from "../controllers/customerPhoneController.js";
import { protectCustomer } from "../middlewares/customerAuth.js";
import { phoneOtpRequestLimiter, phoneOtpVerifyLimiter } from "../middlewares/rateLimiters.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { phoneOtpRequestSchema, phoneOtpVerifySchema } from "../validators/customerValidators.js";

const router = express.Router();

/**
 * Phone verification for an already-logged-in customer — per the spec,
 * phone is collected later (first booking / profile), not at signup.
 * Both routes require a valid access token (protectCustomer).
 */

/**
 * @swagger
 * /api/customer/phone/send-otp:
 *   post:
 *     summary: Send an OTP to verify a phone number onto the logged-in customer's account
 *     tags: [Customer Phone Verification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mobile]
 *             properties:
 *               mobile: { type: string, example: "9876543210" }
 *     responses:
 *       200: { description: OTP sent }
 *       401: { description: Not authenticated }
 *       409: { description: Phone number already linked to another account }
 */
router.post("/send-otp", protectCustomer, phoneOtpRequestLimiter, validateRequest(phoneOtpRequestSchema), sendPhoneOtp);

/**
 * @swagger
 * /api/customer/phone/verify-otp:
 *   post:
 *     summary: Verify the OTP and attach the phone number to the account
 *     tags: [Customer Phone Verification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mobile, code, session]
 *             properties:
 *               mobile: { type: string, example: "9876543210" }
 *               code: { type: string, example: "123456" }
 *               session: { type: string }
 *     responses:
 *       200: { description: Phone verified }
 *       401: { description: Not authenticated }
 *       409: { description: Phone number already linked to another account }
 */
router.post("/verify-otp", protectCustomer, phoneOtpVerifyLimiter, validateRequest(phoneOtpVerifySchema), verifyPhoneOtp);

export default router;
