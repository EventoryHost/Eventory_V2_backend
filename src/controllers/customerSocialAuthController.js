import Customer from "../models/Customer.js";
import { generateISTId } from "../utils/idGenerator.js";
import { generateAccessToken, issueRefreshToken, accessTokenCookieOptions, refreshTokenCookieOptions } from "../utils/tokenService.js";

/**
 * Finds an existing customer by email and links this provider onto it, or
 * creates a brand new customer if the email has never been seen — matching
 * the spec's Google flow: "If exists: Log user in... If new: Create
 * account with emailVerified: true, skip OTP". Shared by both the Google
 * and Facebook Passport strategies so linking/creation behavior is
 * identical regardless of which provider was used.
 */
export async function findOrCreateSocialCustomer({ email, name, photo, providerId }, provider) {
  if (!email) {
    const err = new Error(`${provider} did not return an email address for this account`);
    err.statusCode = 400;
    throw err;
  }

  let customer = await Customer.findOne({ email: email.toLowerCase() });

  if (customer) {
    if (customer.isDeactivated) {
      const err = new Error("This account has been deactivated. Please contact support.");
      err.statusCode = 403;
      err.code = "ACCOUNT_DEACTIVATED";
      throw err;
    }
    const alreadyLinked = customer.authProviders.some((p) => p.provider === provider);
    if (!alreadyLinked) {
      customer.authProviders.push({ provider, providerId, linkedAt: new Date() });
    }
    // A social login is itself proof of email ownership.
    if (!customer.isEmailVerified) {
      customer.isEmailVerified = true;
      customer.verificationStatus = customer.isPhoneVerified ? "FullyVerified" : "EmailVerified";
    }
    customer.lastLogin = new Date();
    await customer.save();
    return customer;
  }

  customer = new Customer({
    id: generateISTId("CUS"),
    name,
    email: email.toLowerCase(),
    profilePicture: photo,
    authProviders: [{ provider, providerId, linkedAt: new Date() }],
    isEmailVerified: true,
    verificationStatus: "EmailVerified",
    lastLogin: new Date(),
  });
  await customer.save();
  return customer;
}

async function issueSessionAndRedirect(customer, req, res) {
  const accessToken = generateAccessToken(customer);
  const refreshToken = await issueRefreshToken(customer, req);

  res.cookie("accessToken", accessToken, accessTokenCookieOptions());
  res.cookie("refreshToken", refreshToken, refreshTokenCookieOptions());

  // No frontend OAuth-callback page is wired up yet — FRONTEND_URL lets that
  // be configured once one exists; defaults to the common local Next.js dev
  // port so this is at least redirectable during development.
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  res.redirect(`${frontendUrl}/auth/callback?success=true`);
}

// GET /api/customer/auth/google/callback — passport has already run
// findOrCreateSocialCustomer via the strategy's verify callback and
// attached the result to req.user.
export const googleCallback = async (req, res, next) => {
  try {
    await issueSessionAndRedirect(req.user, req, res);
  } catch (error) {
    next(error);
  }
};

// GET /api/customer/auth/facebook/callback
export const facebookCallback = async (req, res, next) => {
  try {
    await issueSessionAndRedirect(req.user, req, res);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/customer/auth/link-account — for an ALREADY logged-in customer
 * (protectCustomer required) to attach an additional provider without a
 * full OAuth redirect dance. Expects the frontend to have already completed
 * the provider's client-side sign-in and obtained basic profile info; this
 * only records the link server-side. Real token verification against
 * Google/Facebook (exchanging an id_token/access_token server-side) is left
 * as a follow-up once real OAuth credentials exist to test against — for
 * now this defends against linking a provider identity that's already tied
 * to a *different* customer account, which is the main integrity risk.
 */
export const linkAccount = async (req, res, next) => {
  try {
    const { provider, providerId } = req.body;

    if (!["google", "facebook"].includes(provider) || !providerId) {
      return res.status(400).json({ success: false, message: "provider (google|facebook) and providerId are required" });
    }

    const conflict = await Customer.findOne({
      "authProviders.provider": provider,
      "authProviders.providerId": providerId,
      id: { $ne: req.customer.id },
    });
    if (conflict) {
      return res.status(409).json({
        success: false,
        message: `This ${provider} account is already linked to a different Eventory account`,
      });
    }

    const customer = await Customer.findOne({ id: req.customer.id });
    const alreadyLinked = customer.authProviders.some((p) => p.provider === provider);
    if (alreadyLinked) {
      return res.status(409).json({ success: false, message: `${provider} is already linked to this account` });
    }

    customer.authProviders.push({ provider, providerId, linkedAt: new Date() });
    await customer.save();

    const { password, ...safeCustomer } = customer.toObject();
    res.status(200).json({ success: true, message: `${provider} linked successfully`, data: safeCustomer });
  } catch (error) {
    next(error);
  }
};
