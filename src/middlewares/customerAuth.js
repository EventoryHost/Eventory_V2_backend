import jwt from "jsonwebtoken";
import Customer from "../models/Customer.js";

/**
 * Verifies the customer access token issued by customerAuthController
 * (email/password login or signup) or customerSocialAuthController
 * (Google/Facebook). Accepts the token from either the httpOnly
 * "accessToken" cookie (browser clients, per the spec) or an
 * "Authorization: Bearer <token>" header (non-browser clients, and the
 * simplest path for manual/Postman testing) — whichever is present.
 *
 * This is the first place in the codebase that actually calls jwt.verify()
 * — until now a token was signed on login but never checked anywhere, so
 * every route was effectively unauthenticated. Any route that should only
 * be reachable by a logged-in customer must use this middleware.
 *
 * On success, attaches the authenticated customer document to req.customer.
 */
export const protectCustomer = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, headerToken] = authHeader.split(" ");
    const token = (scheme === "Bearer" && headerToken) || req.cookies?.accessToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication token missing. Log in, or include 'Authorization: Bearer <token>'.",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      const message =
        err.name === "TokenExpiredError" ? "Session expired, please log in again" : "Invalid authentication token";
      return res.status(401).json({ success: false, message });
    }

    // A vendor token (no role, or role !== "customer") must never be
    // usable to access customer-only routes, and vice versa.
    if (decoded.role !== "customer") {
      return res.status(403).json({ success: false, message: "This token is not authorized for customer access" });
    }

    const customer = await Customer.findOne({ id: decoded.id }).lean();
    if (!customer) {
      return res.status(401).json({ success: false, message: "Customer account not found" });
    }
    if (customer.isDeactivated) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_DEACTIVATED",
        message: "This account has been deactivated. Please contact support.",
      });
    }

    req.customer = customer;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Ownership guard for routes shaped like /:id — ensures a customer can only
 * ever act on their own record, never someone else's by guessing/enumerating
 * IDs in the URL. Must run after protectCustomer.
 */
export const requireSelf = (req, res, next) => {
  if (req.customer.id !== req.params.id) {
    return res.status(403).json({ success: false, message: "You are not authorized to access this resource" });
  }
  next();
};

/**
 * Soft-auth cart identity resolution — Phase 3 Step 13. Cart needs to work
 * for BOTH a logged-in customer AND an anonymous guest (Cart.js's own
 * scope: "guest cart support before login"), so unlike protectCustomer this
 * middleware never 401s on a missing/invalid token — it just falls through
 * to guest identification instead.
 *
 * Resolution order: a valid customer access token wins (sets req.customer,
 * exactly like protectCustomer); otherwise an "x-guest-cart-id" header (or
 * ?guestCartId= query param, for easy manual/Postman testing) sets
 * req.guestId; if neither is present, both are left unset and the cart
 * controller mints a brand-new guest cart on the first write action.
 */
export const identifyCartOwner = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, headerToken] = authHeader.split(" ");
    const token = (scheme === "Bearer" && headerToken) || req.cookies?.accessToken;

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role === "customer") {
          const customer = await Customer.findOne({ id: decoded.id }).lean();
          if (customer && !customer.isDeactivated) {
            req.customer = customer;
            return next();
          }
        }
      } catch {
        // Invalid/expired token — NOT an error here (unlike protectCustomer):
        // fall through to guest identification rather than 401ing a cart
        // request just because a stale token happened to be sent alongside it.
      }
    }

    const guestId = req.headers["x-guest-cart-id"] || req.query.guestCartId;
    if (typeof guestId === "string" && guestId.trim()) {
      req.guestId = guestId.trim();
    }

    next();
  } catch (error) {
    next(error);
  }
};
