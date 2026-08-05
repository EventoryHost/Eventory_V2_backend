import Customer from "../models/Customer.js";
import { generateISTId } from "../utils/idGenerator.js";
import {
  generateAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
} from "../utils/tokenService.js";

/**
 * Email + password customer auth, per the Login/Signup/Dashboard spec:
 * 3-field signup (name, email, password), no phone at signup. Phone
 * verification lives in customerPhoneController.js instead, and only runs
 * for an already-authenticated customer.
 */

function stripPassword(customerDoc) {
  const obj = customerDoc.toObject ? customerDoc.toObject() : customerDoc;
  const { password, ...safe } = obj;
  return safe;
}

async function issueSession(customer, req, res, statusCode, message) {
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

// POST /api/customer/auth/login
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const customer = await Customer.findOne({ email: email.toLowerCase() }).select("+password");

    // Same generic message whether the email doesn't exist or the password
    // is wrong — avoids leaking which registered emails exist.
    const invalidCredentials = () =>
      res.status(401).json({ success: false, message: "Invalid email or password" });

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
