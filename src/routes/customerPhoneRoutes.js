import express from "express";
import { sendPhoneOtp, verifyPhoneOtp } from "../controllers/customerPhoneController.js";
import { identifyOptionalCustomer } from "../middlewares/customerAuth.js";
import { phoneOtpRequestLimiter, phoneOtpVerifyLimiter } from "../middlewares/rateLimiters.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { phoneOtpRequestSchema, phoneOtpVerifySchema } from "../validators/customerValidators.js";

const router = express.Router();

/**
 * Phone/OTP — PRIMARY login/signup path as of the 2026-08-17 frontend
 * handoff (previously secondary/authenticated-only). Both routes run
 * behind identifyOptionalCustomer (soft auth, never 401s) instead of
 * protectCustomer, so they work for BOTH:
 *   (a) an anonymous visitor logging in or creating an account by phone
 *   (b) an already-logged-in customer attaching/re-verifying a phone
 *       number on their own account (unchanged from before — still sends
 *       Bearer/cookie auth when available, still gets the same
 *       {success,message,data} response shape)
 * See customerPhoneController.js's own top-of-file comment for exactly
 * how each branch differs.
 */

/**
 * @swagger
 * /api/customer/phone/send-otp:
 *   post:
 *     summary: Send an OTP — works anonymously (login/signup by phone) or authenticated (attach phone to my account)
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
 *       409: { description: "Authenticated only: phone number already linked to another account" }
 */
router.post("/send-otp", identifyOptionalCustomer, phoneOtpRequestLimiter, validateRequest(phoneOtpRequestSchema), sendPhoneOtp);

/**
 * @swagger
 * /api/customer/phone/verify-otp:
 *   post:
 *     summary: Verify the OTP — logs in/creates an account (anonymous) or attaches the phone (authenticated)
 *     description: |
 *       Anonymous caller (no Bearer/cookie token): finds-or-creates a Customer
 *       for this phone number and logs them in — response is
 *       {success,message,accessToken,customer}, same shape as
 *       POST /customer/auth/login (accessToken also set as an httpOnly
 *       cookie, same as every other login path).
 *       Authenticated caller: attaches/re-verifies this phone on their own
 *       account — response is {success,message,data:Customer}, unchanged
 *       from before.
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
 *       200: { description: Logged in (anonymous) or phone verified (authenticated) }
 *       201: { description: New account created and logged in (anonymous, first time this phone is seen) }
 *       403: { description: "Anonymous only: this account has been deactivated" }
 *       409: { description: "Authenticated only: phone number already linked to another account" }
 */
router.post("/verify-otp", identifyOptionalCustomer, phoneOtpVerifyLimiter, validateRequest(phoneOtpVerifySchema), verifyPhoneOtp);

export default router;
