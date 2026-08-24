import { cognito } from "../config/awsConfig.js";
import {
  SignUpCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import Customer from "../models/Customer.js";
import { generateISTId } from "../utils/idGenerator.js";
import { issueSession } from "./customerAuthController.js";

/**
 * Phone/OTP. Rewritten 2026-08-17 per the frontend handoff: phone+OTP is
 * now the PRIMARY way an anonymous visitor logs in or creates an account
 * (previously this was secondary/authenticated-only — phone verification
 * for a customer who'd already signed up with email+password or Google).
 * Both routes now run behind identifyOptionalCustomer (soft auth, see
 * middlewares/customerAuth.js) instead of protectCustomer, and BOTH
 * behaviors coexist by branching on whether req.customer is set:
 *
 *   - req.customer SET (existing secondary flow, unchanged): an
 *     already-logged-in customer (e.g. via Google) is verifying/attaching
 *     a phone number to THEIR OWN account. Same response shape as before
 *     ({success,message,data:Customer}) — no token change, since they're
 *     already logged in.
 *   - req.customer UNSET (new primary flow): an anonymous visitor is
 *     logging in or signing up BY phone. verify-otp finds-or-creates a
 *     Customer for that phone and calls issueSession (customerAuthController.js)
 *     — same helper every other login path uses — so the response is
 *     {success,message,accessToken,customer}, matching the shape the
 *     frontend already expects from POST /customer/auth/login (handoff
 *     section 4.2, "OPTION B").
 *
 * Reuses the same Cognito customer pool (COGNITO_*_USERS) as before.
 */

const MOBILE_REGEX = /^[6-9]\d{9}$/;

const isNewCognitoUser = async (mobile) => {
  try {
    await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: process.env.COGNITO_USER_POOL_ID_USERS,
        Username: `+91${mobile}`,
      })
    );
    return false;
  } catch (error) {
    if (error.name === "UserNotFoundException") return true;
    throw error;
  }
};

// POST /api/customer/phone/send-otp
export const sendPhoneOtp = async (req, res, next) => {
  const { mobile } = req.body;

  if (!mobile || !MOBILE_REGEX.test(mobile)) {
    return res.status(400).json({ success: false, message: "A valid 10-digit mobile number is required" });
  }

  try {
    // Only meaningful for the "attach to my already-logged-in account"
    // case — an anonymous request sending an OTP to a number that already
    // belongs to a registered customer is exactly the normal RETURNING
    // CUSTOMER LOGIN case (verify-otp below logs them into that existing
    // account), not a conflict, so this check is skipped entirely when
    // req.customer is unset.
    if (req.customer) {
      const takenByOther = await Customer.findOne({ phone: `+91${mobile}`, id: { $ne: req.customer.id } });
      if (takenByOther) {
        return res.status(409).json({ success: false, message: "This phone number is already linked to another account" });
      }
    }

    if (await isNewCognitoUser(mobile)) {
      await cognito.send(
        new SignUpCommand({
          ClientId: process.env.COGNITO_APP_CLIENT_ID_USERS,
          Username: `+91${mobile}`,
          Password: Math.random().toString(36).slice(-10) + "A1!", // never used, OTP-only
          UserAttributes: [
            { Name: "phone_number", Value: `+91${mobile}` },
            { Name: "custom:userType", Value: "Customer" },
          ],
        })
      );
    }

    const data = await cognito.send(
      new AdminInitiateAuthCommand({
        AuthFlow: "CUSTOM_AUTH",
        ClientId: process.env.COGNITO_APP_CLIENT_ID_USERS,
        UserPoolId: process.env.COGNITO_USER_POOL_ID_USERS,
        Username: `+91${mobile}`,
        AuthParameters: { USERNAME: `+91${mobile}` },
      })
    );

    res.status(200).json({ success: true, message: "OTP sent successfully", session: data.Session });
  } catch (error) {
    next(error);
  }
};

// POST /api/customer/phone/verify-otp
export const verifyPhoneOtp = async (req, res, next) => {
  const { mobile, code, session } = req.body;

  if (!mobile || !MOBILE_REGEX.test(mobile) || !code || !session) {
    return res.status(400).json({ success: false, message: "mobile, code, and session are required" });
  }

  try {
    await cognito.send(
      new AdminRespondToAuthChallengeCommand({
        ChallengeName: "CUSTOM_CHALLENGE",
        ClientId: process.env.COGNITO_APP_CLIENT_ID_USERS,
        UserPoolId: process.env.COGNITO_USER_POOL_ID_USERS,
        Username: `+91${mobile}`,
        ChallengeResponses: { USERNAME: `+91${mobile}`, ANSWER: code },
        Session: session,
      })
    );

    const normalizedPhone = `+91${mobile}`;

    // ---- Existing secondary flow: attach to the logged-in customer ----
    if (req.customer) {
      const customer = await Customer.findOne({ id: req.customer.id });
      customer.phone = normalizedPhone;
      customer.isPhoneVerified = true;
      customer.verificationStatus = customer.isEmailVerified ? "FullyVerified" : "PhoneVerified";
      await customer.save();

      const { password, ...safeCustomer } = customer.toObject();
      return res.status(200).json({ success: true, message: "Phone verified successfully", data: safeCustomer });
    }

    // ---- New primary flow: anonymous login-or-signup by phone ----
    let customer = await Customer.findOne({ phone: normalizedPhone });

    if (customer) {
      if (customer.isDeactivated) {
        return res.status(403).json({
          success: false,
          code: "ACCOUNT_DEACTIVATED",
          message: "This account has been deactivated. Please contact support.",
        });
      }
      // Already had this exact phone verified before — OTP re-confirms
      // identity, doesn't need to flip anything that isn't already true,
      // but recomputed defensively in case it was somehow false.
      customer.isPhoneVerified = true;
      customer.verificationStatus = customer.isEmailVerified ? "FullyVerified" : "PhoneVerified";
      customer.lastLogin = new Date();
      await customer.save();

      return issueSession(customer, req, res, 200, "Login successful");
    }

    // No account for this phone yet — create one. No name/email/password
    // at this point (per the handoff: password is optional, set AFTER via
    // POST /set-password) — Customer.js has none of those as required
    // fields, so a phone-only account is a genuinely valid state, not a
    // placeholder.
    customer = await Customer.create({
      id: generateISTId("CUS"),
      phone: normalizedPhone,
      isPhoneVerified: true,
      verificationStatus: "PhoneVerified",
      authProviders: [],
      lastLogin: new Date(),
    });

    return issueSession(customer, req, res, 201, "Account created successfully");
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "This phone number is already linked to another account" });
    }
    next(error);
  }
};
