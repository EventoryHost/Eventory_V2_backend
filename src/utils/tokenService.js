import jwt from "jsonwebtoken";
import crypto from "crypto";
import RefreshToken from "../models/RefreshToken.js";

/**
 * Shared token issuance/rotation logic for customer auth, used by every
 * login path (password, Google, Facebook, refresh) so token behavior is
 * identical no matter how the customer authenticated.
 */

const ACCESS_TOKEN_EXPIRY = "24h"; // per spec
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, per spec

export function generateAccessToken(customer) {
  return jwt.sign({ id: customer.id, email: customer.email, role: "customer" }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Issues a brand new refresh token for a customer (e.g. on login/signup).
 * Returns the RAW token — this is the only time it's ever available in
 * plaintext; only its hash is persisted.
 */
export async function issueRefreshToken(customer, req) {
  const rawToken = crypto.randomBytes(48).toString("hex");
  await RefreshToken.create({
    tokenHash: hashToken(rawToken),
    customerId: customer._id,
    createdByIp: req?.ip || null,
    userAgent: req?.headers?.["user-agent"] || null,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return rawToken;
}

/**
 * Validates a raw refresh token and rotates it: the old one is marked
 * revoked (and linked to its replacement, for reuse detection), a new one
 * is issued in its place. Returns { customerId, rawToken: newRawToken } or
 * throws with a `code` describing why it failed.
 */
export async function rotateRefreshToken(rawToken, req) {
  if (!rawToken) {
    const err = new Error("Refresh token missing");
    err.code = "REFRESH_TOKEN_MISSING";
    throw err;
  }

  const tokenHash = hashToken(rawToken);
  const existing = await RefreshToken.findOne({ tokenHash });

  if (!existing || existing.expiresAt < new Date()) {
    const err = new Error("Refresh token invalid or expired");
    err.code = "REFRESH_TOKEN_INVALID";
    throw err;
  }

  if (existing.revoked) {
    // A previously-rotated token being reused is a strong signal of theft —
    // revoke the entire chain by revoking every live token for this
    // customer, forcing a fresh login.
    await RefreshToken.updateMany({ customerId: existing.customerId, revoked: false }, { revoked: true });
    const err = new Error("Refresh token reuse detected — all sessions revoked");
    err.code = "REFRESH_TOKEN_REUSED";
    throw err;
  }

  const newRawToken = crypto.randomBytes(48).toString("hex");
  const newTokenHash = hashToken(newRawToken);

  existing.revoked = true;
  existing.replacedByTokenHash = newTokenHash;
  await existing.save();

  await RefreshToken.create({
    tokenHash: newTokenHash,
    customerId: existing.customerId,
    createdByIp: req?.ip || null,
    userAgent: req?.headers?.["user-agent"] || null,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });

  return { customerId: existing.customerId, rawToken: newRawToken };
}

/** Revokes a single refresh token (logout on this device). */
export async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  await RefreshToken.updateOne({ tokenHash: hashToken(rawToken) }, { revoked: true });
}

/** Revokes every refresh token for a customer (logout everywhere / deactivation). */
export async function revokeAllRefreshTokens(customerId) {
  await RefreshToken.updateMany({ customerId, revoked: false }, { revoked: true });
}

// Cookie options shared by every place a token cookie gets set/cleared, so
// they can never drift out of sync with each other.
export function accessTokenCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // plain HTTP in local dev
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000, // 24h, matches ACCESS_TOKEN_EXPIRY
  };
}

export function refreshTokenCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: REFRESH_TOKEN_TTL_MS,
  };
}
