import { cognito } from "../config/awsConfig.js";
import {
  SignUpCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import Customer from "../models/Customer.js";

/**
 * Phone verification for an ALREADY-AUTHENTICATED customer (protectCustomer
 * required on both routes) — per the Login/Signup spec, phone is not part
 * of signup, it's collected later (first booking, or from the profile page)
 * and SMS-OTP-verified only when provided. This reuses the same Cognito
 * customer pool (COGNITO_*_USERS) that the old phone-based signup/login
 * flow used, just repointed at "verify a phone number onto an existing
 * account" instead of "create an account".
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
    // Reject upfront if this number is already verified on a DIFFERENT account.
    const takenByOther = await Customer.findOne({ phone: `+91${mobile}`, id: { $ne: req.customer.id } });
    if (takenByOther) {
      return res.status(409).json({ success: false, message: "This phone number is already linked to another account" });
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

    const customer = await Customer.findOne({ id: req.customer.id });
    customer.phone = `+91${mobile}`;
    customer.isPhoneVerified = true;
    customer.verificationStatus = customer.isEmailVerified ? "FullyVerified" : "PhoneVerified";
    await customer.save();

    const { password, ...safeCustomer } = customer.toObject();
    res.status(200).json({ success: true, message: "Phone verified successfully", data: safeCustomer });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "This phone number is already linked to another account" });
    }
    next(error);
  }
};
