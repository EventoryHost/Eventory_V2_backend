import Customer from "../models/Customer.js";
import { generateISTId } from "../utils/idGenerator.js";
import { normalizePhone } from "../utils/phone.js";
import {
  generateAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
} from "../utils/tokenService.js";

/**
 * Customer auth. Originally email+password only (phone verification a
 * secondary, already-logged-in-only step) — per the 2026-08-17 frontend
 * handoff, phone+OTP is now the PRIMARY login/signup path instead
 * (customerPhoneController.js's verifyPhoneOtp handles anonymous
 * login/signup-by-phone and calls issueSession, exported below, for
 * exactly that reason). Email+password still fully works as an
 * alternative — signup is unchanged, and login now accepts EITHER
 * {email,password} or {mobile,password} (see login() below) since a
 * phone-only account can set a password after the fact via
 * POST /set-password to unlock this path without needing a fresh OTP.
 */

export function stripPassword(customerDoc) {
  const obj = customerDoc.toObject ? customerDoc.toObject() : customerDoc;
  const { password, ...safe } = obj;
  return safe;
}

// Exported — customerPhoneController.js's verifyPhoneOtp calls this
// directly for the anonymous login/signup-by-phone branch, so every path
// that logs a customer in (password, phone+OTP, Google, Facebook, this)
// issues tokens/cookies identically. See its own JSDoc for the response
// shape this produces.
export async function issueSession(customer, req, res, statusCode, message) {
  const accessToken = generateAccessToken(customer);
  const refreshToken = await issueRefreshToken(customer, req);

  res.cookie("accessToken", accessToken, accessTokenCookieOptions());
  res.cookie("refreshToken", refreshToken, refreshTokenCookieOptions());

  res.status(statusCode).json({
    success: true,
    message,
    accessToken, // also returned in-body: works for non-browser clients and keeps Postman/curl testing simple
    customer: stripPassword(customer),
  });
}

// POST /api/customer/auth/signup
export const signup = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const existing = await Customer.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({
        success: false,
        code: "EMAIL_ALREADY_REGISTERED",
        message: "An account with this email already exists. Please log in instead.",
      });
    }

    const customer = new Customer({
      id: generateISTId("CUS"),
      name,
      email: email.toLowerCase(),
      password, // hashed by the pre-save hook on Customer
      authProviders: [{ provider: "local" }],
      lastLogin: new Date(),
    });
    await customer.save();

    await issueSession(customer, req, res, 201, "Account created successfully");
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }
    next(error);
  }
};

// POST /api/customer/auth/login — accepts EITHER {email,password} or
// {mobile,password} (validator enforces exactly one is present). The
// phone+password path only ever succeeds for a customer who's set a
// password via POST /set-password — comparePassword already resolves to
// false (not a crash) when the account has no password set (Customer.js's
// own null-password handling), so a phone-only OTP account correctly gets
// the same generic "invalid credentials" response, not a different error.
export const login = async (req, res, next) => {
  try {
    const { email, mobile, password } = req.body;

    const customer = mobile
      ? await Customer.findOne({ phone: normalizePhone(mobile) }).select("+password")
      : await Customer.findOne({ email: email.toLowerCase() }).select("+password");

    // Same generic message whichever identity was used or wrong — avoids
    // leaking which registered emails/phones exist.
    const invalidCredentials = () =>
      res.status(401).json({ success: false, message: `Invalid ${mobile ? "phone number" : "email"} or password` });

    if (!customer) return invalidCredentials();

    const passwordMatches = await customer.comparePassword(password);
    if (!passwordMatches) return invalidCredentials();

    if (customer.isDeactivated) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_DEACTIVATED",
        message: "This account has been deactivated. Please contact support.",
      });
    }

    customer.lastLogin = new Date();
    await customer.save();

    await issueSession(customer, req, res, 200, "Login successful");
  } catch (error) {
    next(error);
  }
};

// POST /api/customer/auth/refresh-token
export const refreshToken = async (req, res, next) => {
  try {
    const rawToken = req.cookies?.refreshToken || req.body?.refreshToken;

    let rotated;
    try {
      rotated = await rotateRefreshToken(rawToken, req);
    } catch (err) {
      const status = err.code === "REFRESH_TOKEN_REUSED" ? 401 : 401;
      res.clearCookie("accessToken", accessTokenCookieOptions());
      res.clearCookie("refreshToken", refreshTokenCookieOptions());
      return res.status(status).json({ success: false, code: err.code, message: err.message });
    }

    const customer = await Customer.findById(rotated.customerId);
    if (!customer || customer.isDeactivated) {
      return res.status(401).json({ success: false, message: "Session no longer valid, please log in again" });
    }

    const accessToken = generateAccessToken(customer);
    res.cookie("accessToken", accessToken, accessTokenCookieOptions());
    res.cookie("refreshToken", rotated.rawToken, refreshTokenCookieOptions());

    res.status(200).json({ success: true, accessToken });
  } catch (error) {
    next(error);
  }
};

// POST /api/customer/auth/logout
export const logout = async (req, res, next) => {
  try {
    const rawToken = req.cookies?.refreshToken || req.body?.refreshToken;
    await revokeRefreshToken(rawToken);

    res.clearCookie("accessToken", accessTokenCookieOptions());
    res.clearCookie("refreshToken", refreshTokenCookieOptions());

    res.status(200).json({ success: true, message: "Logged out" });
  } catch (error) {
    next(error);
  }
};

// POST /api/customer/auth/set-password — new endpoint per the 2026-08-17
// frontend handoff (STEP "set-password", optional/skippable right after a
// first-time phone+OTP signup). Requires protectCustomer — only makes
// sense for an already-logged-in customer setting/replacing a password so
// they can skip OTP next time via the phone+password login path. Ensures
// authProviders gets a "local" entry if it doesn't already have one, since
// the frontend's own "does this account have a password" detection
// (section 3 of the handoff) keys off authProviders containing
// provider:"local" — not off isPhoneVerified or any other field.
export const setPassword = async (req, res, next) => {
  try {
    const { password } = req.body;

    const customer = await Customer.findOne({ id: req.customer.id });
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    customer.password = password; // hashed by the pre-save hook
    if (!customer.authProviders.some((p) => p.provider === "local")) {
      customer.authProviders.push({ provider: "local", providerId: null });
    }
    await customer.save();

    res.status(200).json({ success: true, message: "Password set successfully", data: stripPassword(customer) });
  } catch (error) {
    next(error);
  }
};
