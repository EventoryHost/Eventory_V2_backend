import crypto from "crypto";

/**
 * Ground-contact links — the public, read-only page a vendor's on-ground
 * contact opens on the event day (see Booking.js's GroundStaffSchema).
 *
 * The code is the only thing guarding that page (it has no login), so it is
 * random rather than derived from anything about the booking: 8 random
 * bytes, base64url-encoded to 11 URL-safe characters (64 bits).
 */

const DEFAULT_WEB_URL = "https://eventory.in";

// What a code looks like, so a malformed one can be refused without a query.
export const GROUND_CODE_PATTERN = /^[A-Za-z0-9_-]{8,32}$/;

export const generateGroundCode = () => crypto.randomBytes(8).toString("base64url");

/** The shareable page URL for a code, on the customer-facing web host. */
export const groundLinkFor = (code) => {
  const base = (process.env.PUBLIC_WEB_URL || DEFAULT_WEB_URL).replace(/\/+$/, "");
  return `${base}/g/${code}`;
};

/**
 * Adds the derived `link` to a stored groundStaff object. `link` is never
 * stored (the web host may change), so every place a booking is serialised
 * for the app goes through this — see utils/pricingBreakdown.js.
 */
export const withGroundLink = (groundStaff) =>
  groundStaff?.code ? { ...groundStaff, link: groundLinkFor(groundStaff.code) } : null;
