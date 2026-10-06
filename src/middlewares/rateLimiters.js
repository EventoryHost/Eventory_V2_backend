import rateLimit from "express-rate-limit";

/**
 * Auth endpoints are the highest-value target for abuse: unlimited attempts
 * let an attacker brute-force a password or OTP, or spam SMS to burn
 * Cognito/SMS spend. All keyed by IP; a request-body key (e.g. email/mobile)
 * could be layered on later if per-account limiting is needed too.
 */

// POST /api/customer/auth/signup — cheap to abuse for account-enumeration/spam.
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many signup attempts from this device. Please try again later." },
});

// POST /api/customer/auth/login — guards against password brute-forcing.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many login attempts. Please try again in a few minutes." },
});

// POST /api/customer/phone/send-otp — sending OTPs costs money (SMS) and
// enables SMS-bombing, so this stays tight.
export const phoneOtpRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests from this device. Please try again in a few minutes.",
  },
});

// POST /api/customer/phone/verify-otp — guards against brute-forcing the
// 6-digit code within a valid session's short lifetime.
export const phoneOtpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP verification attempts. Please try again in a few minutes.",
  },
});

// GET /api/customer/packages, /api/customer/vendors — public, no auth, so IP
// is the only key available. Generous on purpose: a single page load fires
// several filtered requests, and this is here to blunt scraping/DoS-by-scan,
// not to throttle normal browsing.
export const publicBrowseLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please slow down." },
});
