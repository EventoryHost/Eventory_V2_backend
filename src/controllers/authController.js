import { cognito } from "../config/awsConfig.js";
import {
  SignUpCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import jwt from "jsonwebtoken";
import Vendor from "../models/Vendor.js";
import dotenv from "dotenv";
import { generateISTId } from "../utils/idGenerator.js";
import { purgeEligibleAt } from "../utils/accountDeletion.js";

dotenv.config();

// 🔥 Dummy test user — skips Cognito entirely (no SMS, fixed OTP).
// Only this one mobile number is bypassed; every other number goes to Cognito.
const DUMMY_MOBILE = process.env.DUMMY_MOBILE || "1111111111";
const DUMMY_OTP = process.env.DUMMY_OTP || "111111";
const DUMMY_SESSION = "dummy_session";

const isDummyMobile = (mobile) => String(mobile).trim() === DUMMY_MOBILE;

// Helper to check if user exists in Cognito
const isNewUser = async (mobile) => {
  try {
    const getUserCommand = new AdminGetUserCommand({
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
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

  if (!mobile) {
    return res.status(400).json({ success: false, message: "Mobile number is required" });
  }

  // 🔥 Dummy Bypass Block — no Cognito sign-up, no OTP sent.
  if (isDummyMobile(mobile)) {
    console.log("🟡 Dummy mobile detected → Bypassing Cognito OTP");
    return res.status(200).json({
      success: true,
      message: "OTP sent successfully (Dummy Mode)",
      session: DUMMY_SESSION,
    });
  }

  try {
    const isNew = await isNewUser(mobile);
    const existingVendor = await Vendor.findOne({ phone: `+91${mobile}` });

    // A vendor with a pending deletion is deactivated but must still be able
    // to sign in during the retention window to cancel it — a grace period
    // they cannot re-enter would not be one. Support deactivations, which
    // carry no deletionRequestedAt, stay blocked.
    if (
      existingVendor &&
      existingVendor.isDeactivated &&
      !existingVendor.deletionRequestedAt
    ) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_DEACTIVATED",
        message: "This account has been deactivated. Please contact support.",
      });
    }

    if (isSignup && (!isNew || existingVendor)) {
      return res.status(400).json({
        success: false,
        code: "USER_ALREADY_EXISTS",
        message: "You are already a registered user. Please log in instead.",
      });
    }

    if (isNew) {
      // Sign Up in Cognito
      const signUpParams = {
        ClientId: process.env.COGNITO_APP_CLIENT_ID,
        Username: `+91${mobile}`,
        Password: Math.random().toString(36).slice(-10) + "A1!", // Random password as per Cognito policy
        UserAttributes: [
          { Name: "phone_number", Value: `+91${mobile}` },
          { Name: "custom:userType", Value: "Vendor" },
        ],
      };
      await cognito.send(new SignUpCommand(signUpParams));
    }

    // Initiate Auth (Send OTP)
    const authParams = {
      AuthFlow: "CUSTOM_AUTH",
      ClientId: process.env.COGNITO_APP_CLIENT_ID,
      UserPoolId: process.env.COGNITO_USER_POOL_ID,
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
  const { mobile, code, session, name } = req.body;

  if (!mobile || !code || !session) {
    return res.status(400).json({ success: false, message: "Mobile, code, and session are required" });
  }

  try {
    // 🔥 Dummy Bypass Block — accept only the fixed OTP, skip Cognito.
    if (isDummyMobile(mobile)) {
      if (code !== DUMMY_OTP) {
        return res.status(400).json({
          success: false,
          message: "Invalid OTP",
        });
      }
      console.log("🟡 Dummy mobile detected → Bypassing Cognito challenge");
    } else {
      const params = {
        ChallengeName: "CUSTOM_CHALLENGE",
        ClientId: process.env.COGNITO_APP_CLIENT_ID,
        UserPoolId: process.env.COGNITO_USER_POOL_ID,
        Username: `+91${mobile}`,
        ChallengeResponses: {
          USERNAME: `+91${mobile}`,
          ANSWER: code,
        },
        Session: session,
      };

      await cognito.send(new AdminRespondToAuthChallengeCommand(params));
    }

    // Check if vendor exists in local DB
    let vendor = await Vendor.findOne({ phone: `+91${mobile}` });

    // Mirrors loginOrSignUp: a pending deletion is allowed through so the
    // vendor can cancel it; a support deactivation is not.
    if (vendor && vendor.isDeactivated && !vendor.deletionRequestedAt) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_DEACTIVATED",
        message: "This account has been deactivated. Please contact support.",
      });
    }

    if (!vendor) {
      // Create new vendor profile if not exists
      vendor = new Vendor({
        id: generateISTId("VEN"),
        phone: `+91${mobile}`,
        pocName: name,
        isVerified: false,
      });
      await vendor.save();
    }

    // Generate JWT
    const token = jwt.sign(
      { id: vendor.id, phone: vendor.phone },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      vendor,
      // Lets the app route a returning vendor straight to the pending-deletion
      // screen instead of the main app, where they can cancel the request.
      deletionPending: Boolean(vendor.deletionRequestedAt),
      scheduledPurgeAt: vendor.deletionRequestedAt
        ? purgeEligibleAt(vendor.deletionRequestedAt)
        : null,
    });
  } catch (error) {
    next(error);
  }
};
