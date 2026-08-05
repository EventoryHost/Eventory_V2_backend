import { cognito } from "../config/awsConfig.js";
import {
  SignUpCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import jwt from "jsonwebtoken";
import Customer from "../models/Customer.js";
import dotenv from "dotenv";
import { generateISTId } from "../utils/idGenerator.js";

dotenv.config();

/**
 * Customer auth flow — mirrors authController.js (vendor), but uses the
 * dedicated customer Cognito pool (COGNITO_*_USERS env vars) and the
 * Customer model, so a customer account can never be confused with /
 * escalate into a vendor account.
 */

const MOBILE_REGEX = /^[6-9]\d{9}$/; // basic Indian 10-digit mobile sanity check

// Helper to check if user exists in the CUSTOMER Cognito pool
const isNewUser = async (mobile) => {
  try {
    const getUserCommand = new AdminGetUserCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID_USERS,
      Username: `+91${mobile}`,
    });
    await cognito.send(getUserCommand);
    return false; // User exists
  } catch (error) {
    if (error.name === "UserNotFoundException") {
      return true; // New user
    }
    throw error;
  }
};

// Sign Up / Login Initiation (OTP Send)
export const loginOrSignUp = async (req, res, next) => {
  const { mobile, isSignup } = req.body;

  if (!mobile || !MOBILE_REGEX.test(mobile)) {
    return res.status(400).json({ success: false, message: "A valid 10-digit mobile number is required" });
  }

  try {
    const isNew = await isNewUser(mobile);
    const existingCustomer = await Customer.findOne({ phone: `+91${mobile}` });

    if (existingCustomer && existingCustomer.isDeactivated) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_DEACTIVATED",
        message: "This account has been deactivated. Please contact support.",
      });
    }

    if (isSignup && (!isNew || existingCustomer)) {
      return res.status(400).json({
        success: false,
        code: "USER_ALREADY_EXISTS",
        message: "You are already a registered user. Please log in instead.",
      });
    }

    if (isNew) {
      // Sign Up in the customer Cognito pool
      const signUpParams = {
        ClientId: process.env.COGNITO_APP_CLIENT_ID_USERS,
        Username: `+91${mobile}`,
        Password: Math.random().toString(36).slice(-10) + "A1!", // Random password as per Cognito policy; never used, OTP-only auth
        UserAttributes: [
          { Name: "phone_number", Value: `+91${mobile}` },
          { Name: "custom:userType", Value: "Customer" },
        ],
      };
      await cognito.send(new SignUpCommand(signUpParams));
    }

    // Initiate Auth (Send OTP)
    const authParams = {
      AuthFlow: "CUSTOM_AUTH",
      ClientId: process.env.COGNITO_APP_CLIENT_ID_USERS,
      UserPoolId: process.env.COGNITO_USER_POOL_ID_USERS,
      Username: `+91${mobile}`,
      AuthParameters: {
        USERNAME: `+91${mobile}`,
      },
    };
    const data = await cognito.send(new AdminInitiateAuthCommand(authParams));

    res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      session: data.Session,
    });
  } catch (error) {
    next(error);
  }
};

// Verify OTP
export const verifyOtp = async (req, res, next) => {
  const { mobile, code, session, name, email } = req.body;

  if (!mobile || !MOBILE_REGEX.test(mobile) || !code || !session) {
    return res.status(400).json({ success: false, message: "Mobile, code, and session are required" });
  }

  try {
    const params = {
      ChallengeName: "CUSTOM_CHALLENGE",
      ClientId: process.env.COGNITO_APP_CLIENT_ID_USERS,
      UserPoolId: process.env.COGNITO_USER_POOL_ID_USERS,
      Username: `+91${mobile}`,
      ChallengeResponses: {
        USERNAME: `+91${mobile}`,
        ANSWER: code,
      },
      Session: session,
    };

    await cognito.send(new AdminRespondToAuthChallengeCommand(params));

    // Check if customer exists in local DB
    let customer = await Customer.findOne({ phone: `+91${mobile}` });

    if (customer && customer.isDeactivated) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_DEACTIVATED",
        message: "This account has been deactivated. Please contact support.",
      });
    }

    if (!customer) {
      // Create new customer profile if not exists — OTP success on the
      // customer's own phone number is itself the proof of phone ownership
      customer = new Customer({
        id: generateISTId("CUS"),
        phone: `+91${mobile}`,
        name,
        email,
        isPhoneVerified: true,
        verificationStatus: "PhoneVerified",
      });
      await customer.save();
    } else if (!customer.isPhoneVerified) {
      customer.isPhoneVerified = true;
      customer.verificationStatus = "PhoneVerified";
      await customer.save();
    }

    // Generate JWT — role claim keeps this token scoped to customer-only
    // routes and distinguishes it from a vendor token at verification time.
    const token = jwt.sign(
      { id: customer.id, phone: customer.phone, role: "customer" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      customer,
    });
  } catch (error) {
    next(error);
  }
};
