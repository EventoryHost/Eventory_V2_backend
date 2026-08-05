import rateLimit from "express-rate-limit";

/**
 * OTP send/verify endpoints are the highest-value target for abuse in an
 * OTP-only auth system: unlimited requests let an attacker brute-force a
 * 6-digit code, or spam a phone number with SMS ("SMS bombing") to burn
 * Cognito/SMS spend. Both are keyed by IP; a request-body key (e.g. mobile
 * number) could be layered on later if per-number limiting is needed too.
 */

// POST /api/customer/auth/login — sending OTPs is what costs money (SMS) and
// enables SMS-bombing, so this stays tight.
export const otpRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests from this device. Please try again in a few minutes.",
  },
});

// POST /api/customer/auth/verify-otp — guards against brute-forcing the
// 6-digit code within a valid session's short lifetime.
export const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP verification attempts. Please try again in a few minutes.",
  },
});
