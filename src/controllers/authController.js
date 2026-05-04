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

dotenv.config();

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
  const { mobile } = req.body;

  if (!mobile) {
    return res.status(400).json({ success: false, message: "Mobile number is required" });
  }

  try {
    const isNew = await isNewUser(mobile);

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

    // Check if vendor exists in local DB
    let vendor = await Vendor.findOne({ phone: `+91${mobile}` });

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
    });
  } catch (error) {
    next(error);
  }
};
