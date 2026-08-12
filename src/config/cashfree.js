import { Cashfree, CFEnvironment } from "cashfree-pg";

/**
 * Cashfree PAYMENT GATEWAY client — Phase 4 Step 18. Deliberately a
 * SEPARATE credential pair (CASHFREE_CLIENT_ID_PG/CASHFREE_CLIENT_SECRET_PG)
 * from the Verification Suite client already used elsewhere in this repo
 * (CASHFREE_CLIENT_ID/CASHFREE_CLIENT_SECRET, vendor KYC face-match,
 * verificationController.js) — confirmed via directly reading V1's
 * controllers/cashfree.js that Payment Gateway and Verification Suite are
 * genuinely different Cashfree products needing their own key pairs, not
 * one credential shared across both. Do not merge these two.
 *
 * Environment picked off IS_DEV, same convention already used everywhere
 * else in this codebase (vendor Cognito OTP bypass, this Customer auth
 * build, etc.) — SANDBOX in dev, PRODUCTION otherwise.
 */
const clientId = process.env.CASHFREE_CLIENT_ID_PG;
const clientSecret = process.env.CASHFREE_CLIENT_SECRET_PG;

if (!clientId || !clientSecret) {
  console.warn(
    "[cashfree] CASHFREE_CLIENT_ID_PG / CASHFREE_CLIENT_SECRET_PG are not set — customer payment endpoints will fail until these are added to .env."
  );
}

export const cashfree = new Cashfree(
  process.env.IS_DEV === "true" ? CFEnvironment.SANDBOX : CFEnvironment.PRODUCTION,
  clientId,
  clientSecret
);

export default cashfree;
