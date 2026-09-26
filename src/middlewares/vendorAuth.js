import jwt from "jsonwebtoken";
import Package from "../models/Package.js";
import { buildGroupFilter } from "../utils/packageGroup.js";
import { resolveVendorRefId } from "../utils/resolveVendor.js";

/**
 * Vendor authentication and ownership for /api/vendors and /api/packages.
 *
 * Until now the vendor token signed at OTP login (authController.verifyOtp)
 * was never checked, so any caller could read, edit or delete any vendor's
 * profile and packages by id. These guards require the caller to hold a
 * vendor token AND to be the vendor that owns what the route touches.
 *
 * Rolled out behind VENDOR_AUTH_MODE, because not every client sends the
 * token yet (the web vendor dashboard, and possibly the admin panel, call
 * these routes without one):
 *
 *   report  (default) — never blocks; logs every call that would be refused,
 *                       so the remaining token-less callers can be found.
 *   enforce           — refuses them: 401 without a valid vendor token, 403
 *                       for another vendor's data.
 *   off               — skips the checks entirely.
 *
 * Switch to enforce once the report log is quiet.
 */

const mode = () => {
  const m = String(process.env.VENDOR_AUTH_MODE || "report").toLowerCase();
  return m === "enforce" || m === "off" ? m : "report";
};

/**
 * The vendor a request is authenticated as, or why it is not. Customer tokens
 * are signed with the same secret but carry role "customer"; a vendor token
 * carries no role. Anything with a role is not a vendor.
 */
const authenticate = (req) => {
  const [scheme, token] = String(req.headers.authorization || "").split(" ");
  if (scheme !== "Bearer" || !token) return { error: "missing token" };
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role) return { error: `a ${decoded.role} token` };
    if (!decoded.id) return { error: "token without a vendor id" };
    return { vendorId: String(decoded.id) };
  } catch (err) {
    return { error: err.name === "TokenExpiredError" ? "expired token" : "invalid token" };
  }
};

const refuse = (res, status, message) =>
  res.status(status).json({ success: false, status: "FAILED", message });

/**
 * @param resolveOwner (req) => the public vendor id ("VEN...") that owns the
 *   route's target, null when the target does not exist (the route's own 404
 *   then applies), or undefined when the route has no single owner and only
 *   authentication is required.
 */
export const requireVendor = (resolveOwner) => async (req, res, next) => {
  const current = mode();
  if (current === "off") return next();

  try {
    const auth = authenticate(req);
    let violation = null;
    if (auth.error) {
      violation = { status: 401, reason: auth.error, message: "Authentication required. Please log in again." };
    } else if (resolveOwner) {
      const owner = await resolveOwner(req, auth.vendorId);
      if (owner && owner !== auth.vendorId) {
        violation = { status: 403, reason: `vendor ${auth.vendorId} acting on ${owner}`, message: "You are not authorized to access this resource" };
      }
    }
    if (auth.vendorId) req.authVendorId = auth.vendorId;

    if (!violation) return next();

    // Never logs the token itself.
    console.warn(
      `[vendor-auth:${current}] ${violation.status} ${violation.reason} — ${req.method} ${req.originalUrl} ip=${req.ip}`
    );
    return current === "enforce" ? refuse(res, violation.status, violation.message) : next();
  } catch (error) {
    // A lookup failing must not open the route in enforce mode, nor break it
    // in report mode.
    console.error(`[vendor-auth] owner lookup failed — ${req.method} ${req.originalUrl}:`, error.message);
    return mode() === "enforce" ? refuse(res, 500, "Could not verify access") : next();
  }
};

// ── Owner resolvers ─────────────────────────────────────────────────────────

/** Package.vendorId holds either the public "VEN..." id or the Mongo _id. */
const ownerOfPackageDoc = async (pkg) =>
  pkg ? (await resolveVendorRefId(pkg.vendorId)) || String(pkg.vendorId) : null;

export const ownerFromParam = (param) => (req) => String(req.params[param]);

export const ownerFromBody = (field) => (req, tokenVendorId) =>
  req.body?.[field] ? String(req.body[field]) : tokenVendorId;

export const ownerOfPackage = async (req) => {
  const { packageId } = req.params;
  if (!/^[0-9a-fA-F]{24}$/.test(String(packageId))) return null;
  return ownerOfPackageDoc(await Package.findById(packageId).select("vendorId").lean());
};

export const ownerOfGroup = async (req) =>
  ownerOfPackageDoc(
    await Package.findOne(await buildGroupFilter(req.params.packageGroupId)).select("vendorId").lean()
  );

/** For routes no vendor should reach at all (e.g. listing every vendor). */
export const nobody = () => "(no vendor)";

export default { requireVendor, ownerFromParam, ownerFromBody, ownerOfPackage, ownerOfGroup, nobody };
