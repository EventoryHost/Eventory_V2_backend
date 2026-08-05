import express from "express";
import passport, { isGoogleConfigured, isFacebookConfigured } from "../config/passport.js";
import { signup, login, refreshToken, logout } from "../controllers/customerAuthController.js";
import { googleCallback, facebookCallback, linkAccount } from "../controllers/customerSocialAuthController.js";
import { protectCustomer } from "../middlewares/customerAuth.js";
import { signupLimiter, loginLimiter } from "../middlewares/rateLimiters.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import {
  customerSignupSchema,
  customerLoginSchema,
  customerRefreshTokenSchema,
  linkAccountSchema,
} from "../validators/customerValidators.js";

const router = express.Router();

/**
 * @swagger
 * /api/customer/auth/signup:
 *   post:
 *     summary: Email + password signup
 *     description: Creates a customer account with just name, email, and password (no phone at signup — that's collected later via /api/customer/phone).
 *     tags: [Customer Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, example: "Jane Doe" }
 *               email: { type: string, example: "jane@example.com" }
 *               password: { type: string, example: "atLeast8Chars" }
 *     responses:
 *       201: { description: Account created, access token + customer returned }
 *       409: { description: Email already registered }
 */
router.post("/signup", signupLimiter, validateRequest(customerSignupSchema), signup);

/**
 * @swagger
 * /api/customer/auth/login:
 *   post:
 *     summary: Email + password login
 *     tags: [Customer Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, example: "jane@example.com" }
 *               password: { type: string, example: "atLeast8Chars" }
 *     responses:
 *       200: { description: Login successful }
 *       401: { description: Invalid email or password }
 *       403: { description: Account deactivated }
 */
router.post("/login", loginLimiter, validateRequest(customerLoginSchema), login);

/**
 * @swagger
 * /api/customer/auth/refresh-token:
 *   post:
 *     summary: Exchange a refresh token for a new access token
 *     description: Reads the refresh token from the httpOnly cookie (or request body as a fallback for non-browser clients). Rotates the refresh token on every use.
 *     tags: [Customer Authentication]
 *     responses:
 *       200: { description: New access token issued }
 *       401: { description: Refresh token missing, invalid, expired, or reused }
 */
router.post("/refresh-token", validateRequest(customerRefreshTokenSchema), refreshToken);

/**
 * @swagger
 * /api/customer/auth/logout:
 *   post:
 *     summary: Log out (revokes the current refresh token, clears cookies)
 *     tags: [Customer Authentication]
 *     responses:
 *       200: { description: Logged out }
 */
router.post("/logout", logout);

/**
 * @swagger
 * /api/customer/auth/google:
 *   get:
 *     summary: Initiate Google OAuth
 *     description: Redirects to Google's consent screen. 501 if GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL are not set in .env yet.
 *     tags: [Customer Authentication]
 */
router.get("/google", (req, res, next) => {
  if (!isGoogleConfigured) {
    return res.status(501).json({
      success: false,
      message: "Google OAuth is not configured on this server yet (missing GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL).",
    });
  }
  passport.authenticate("google", { scope: ["profile", "email"], session: false })(req, res, next);
});

/**
 * @swagger
 * /api/customer/auth/google/callback:
 *   get:
 *     summary: Google OAuth callback
 *     tags: [Customer Authentication]
 */
router.get(
  "/google/callback",
  (req, res, next) => {
    if (!isGoogleConfigured) {
      return res.status(501).json({ success: false, message: "Google OAuth is not configured on this server yet." });
    }
    passport.authenticate("google", { session: false, failureRedirect: "/api/customer/auth/google/failed" })(req, res, next);
  },
  googleCallback
);

/**
 * @swagger
 * /api/customer/auth/facebook:
 *   get:
 *     summary: Initiate Facebook OAuth
 *     description: Redirects to Facebook's consent screen. 501 if FACEBOOK_APP_ID/SECRET/CALLBACK_URL are not set in .env yet.
 *     tags: [Customer Authentication]
 */
router.get("/facebook", (req, res, next) => {
  if (!isFacebookConfigured) {
    return res.status(501).json({
      success: false,
      message: "Facebook OAuth is not configured on this server yet (missing FACEBOOK_APP_ID/SECRET/CALLBACK_URL).",
    });
  }
  passport.authenticate("facebook", { scope: ["email"], session: false })(req, res, next);
});

/**
 * @swagger
 * /api/customer/auth/facebook/callback:
 *   get:
 *     summary: Facebook OAuth callback
 *     tags: [Customer Authentication]
 */
router.get(
  "/facebook/callback",
  (req, res, next) => {
    if (!isFacebookConfigured) {
      return res.status(501).json({ success: false, message: "Facebook OAuth is not configured on this server yet." });
    }
    passport.authenticate("facebook", { session: false, failureRedirect: "/api/customer/auth/facebook/failed" })(req, res, next);
  },
  facebookCallback
);

router.get("/google/failed", (req, res) => res.status(401).json({ success: false, message: "Google sign-in failed" }));
router.get("/facebook/failed", (req, res) => res.status(401).json({ success: false, message: "Facebook sign-in failed" }));

/**
 * @swagger
 * /api/customer/auth/link-account:
 *   post:
 *     summary: Link a social provider onto the logged-in customer's account
 *     tags: [Customer Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider, providerId]
 *             properties:
 *               provider: { type: string, enum: [google, facebook] }
 *               providerId: { type: string }
 *     responses:
 *       200: { description: Provider linked }
 *       401: { description: Not authenticated }
 *       409: { description: Already linked to this or another account }
 */
router.post("/link-account", protectCustomer, validateRequest(linkAccountSchema), linkAccount);

export default router;
