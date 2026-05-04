import axios from "axios";
import dotenv from "dotenv";
import { generateSignature } from "../utils/generateId.js";
import Vendor from "../models/Vendor.js";

dotenv.config();

const verifyGSTIN = async (req, res) => {
  const { gstIn } = req.params;

  if (!gstIn) {
    return res.status(400).json({ message: "Please provide a GSTIN number" });
  }

  const gstinPattern =
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}[Z]{1}[A-Z0-9]{1}$/;
  if (process.env.IS_DEV !== "true" && !gstinPattern.test(gstIn)) {
    return res.status(400).json({ message: "Invalid GSTIN format" });
  }
  try {
    const clientId = process.env.CASHFREE_CLIENT_ID;
    const clientSecret = process.env.CASHFREE_CLIENT_SECRET;

    const publicKey = `-----BEGIN PUBLIC KEY-----\n${process.env.CASHFREE_PUBLIC_KEY}\n-----END PUBLIC KEY-----`;

    const timestamp = Math.floor(Date.now() / 1000);

    const signature = generateSignature(clientId, publicKey, timestamp);

    var url;
    process.env.IS_DEV === "true"
      ? (url = `https://sandbox.cashfree.com/verification/gstin`)
      : (url = `https://api.cashfree.com/verification/gstin`);

    var headers = {}
    process.env.IS_DEV === "true" ?
      headers = {
        "x-client-id": clientId,
        "x-client-secret": clientSecret,
        "X-Cf-Signature": signature,
        "X-Timestamp": timestamp.toString(),
        "x-environment": "sandbox",
        "Content-Type": "application/json",
      } :
      headers = {
        "x-client-id": clientId,
        "x-client-secret": clientSecret,
        "X-Cf-Signature": signature,
        "X-Timestamp": timestamp.toString(),
        "Content-Type": "application/json",
      };

    const response = await axios.post(url, { gstin: gstIn }, { headers });

    console.log("GSTIN Verification response:", response.data);

    // Format the response to include the legal name in a standardized way
    if (response.data && response.data.legal_name_of_business) {
      return res.status(200).json({
        status: "SUCCESS",
        legal_name: response.data.legal_name_of_business,
        message: "GSTIN verified successfully",
        originalResponse: response.data,
      });
    } else if (response.data) {
      // If we have response data but not the expected field, return what we have
      return res.status(200).json({
        status: "SUCCESS",
        legal_name: response.data.trade_name_of_business || "Verified",
        message: "GSTIN verified successfully but name may be limited",
        originalResponse: response.data,
      });
    }
  } catch (error) {
    console.error("Error verifying GSTIN:", error);

    if (error.response) {
      const { status } = error.response;
      console.error("GSTIN API error response:", {
        status,
        data: error.response.data,
      });

      if (status === 429) {
        return res
          .status(429)
          .json({ message: "Too many requests, please try again later" });
      }

      if (status === 404) {
        return res.status(404).json({ message: "GSTIN not found" });
      }

      return res.status(status).json({
        message: "Error from GSTIN API",
        details: error.response.data,
      });
    }

    console.error("Unexpected error:", error.message);
    res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

const verifyPAN = async (req, res) => {
  const { panNo } = req.params;
  const vendor_id = req.query.vendor_id; // Get vendor_id from query params if provided

  if (!panNo) {
    return res
      .status(400)
      .json({ message: "Please provide a PAN card number" });
  }

  // 🔥 Dummy Bypass Block
  if (panNo.toUpperCase() === "DUMMYDUMMY") {
    console.log("🟡 Dummy PAN detected → Bypassing Cashfree API");

    return res.status(200).json({
      status: "SUCCESS",
      name: "Dummy User",
      registered_name: "Dummy User",
      message: "PAN Card verified successfully (Dummy Mode)",
      gstin_list: [],
      originalResponse: {
        dummy: true,
        pan: "DUMMY",
      },
    });
  }

  // PAN card format validation - 5 letters followed by 4 numbers and then 1 letter
  const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (process.env.IS_DEV !== "true" && !panPattern.test(panNo)) {
    return res.status(400).json({ message: "Invalid PAN card format" });
  }

  try {
    const clientId = process.env.CASHFREE_CLIENT_ID;
    const clientSecret = process.env.CASHFREE_CLIENT_SECRET;

    const publicKey = `-----BEGIN PUBLIC KEY-----\n${process.env.CASHFREE_PUBLIC_KEY}\n-----END PUBLIC KEY-----`;

    const timestamp = Math.floor(Date.now() / 1000);

    const signature = generateSignature(clientId, publicKey, timestamp);

    const panUrl =
      process.env.IS_DEV === "true"
        ? `https://sandbox.cashfree.com/verification/pan`
        : `https://api.cashfree.com/verification/pan`;

    const panGstinUrl =
      process.env.IS_DEV === "true"
        ? `https://sandbox.cashfree.com/verification/pan-gstin`
        : `https://api.cashfree.com/verification/pan-gstin`;

    const headers = {
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      "X-Cf-Signature": signature,
      "X-Timestamp": timestamp.toString(),
      "Content-Type": "application/json",
    };

    // First, verify the PAN
    const panResponse = await axios.post(panUrl, { pan: panNo }, { headers });

    console.log("PAN Verification response:", panResponse.data);

    // If PAN is valid, try to fetch associated GSTINs
    let gstinList = [];

    try {
      // Create a unique verification ID for the PAN-GSTIN request
      const verification_id = `eventory_${Date.now()}_${panNo}`;

      const gstinResponse = await axios.post(
        panGstinUrl,
        {
          pan: panNo,
          verification_id: verification_id,
        },
        { headers }
      );

      console.log("GSTIN from PAN response:", gstinResponse.data);

      if (gstinResponse.data && gstinResponse.data.gstin_list) {
        gstinList = gstinResponse.data.gstin_list;

        // If vendor_id is provided, store the first active GSTIN in the vendor's profile
        if (vendor_id && gstinList.length > 0) {
          try {
            // Find the vendor
            const vendor = await Vendor.findOne({ id: vendor_id });

            if (vendor) {
              // Store PAN
              vendor.panNumber = panNo;
              vendor.isPanVerified = true;

              // Find the first active GSTIN
              const activeGstin = gstinList.find((g) => g.status === "ACTIVE");

              if (activeGstin) {
                vendor.gstNumber = activeGstin.gstin;
              }

              // Save the changes
              await vendor.save();
              console.log(
                `Updated Vendor ${vendor_id} with PAN and GSTIN from verification`
              );
            } else {
              console.log(`Vendor not found with ID: ${vendor_id}`);
            }
          } catch (vendorError) {
            console.error("Error updating vendor with GSTIN:", vendorError);
            // Don't fail the API response if this part fails
          }
        }
      }
    } catch (gstinError) {
      // Just log the error but don't fail the entire request
      // This way, even if GSTIN lookup fails, we still return the PAN verification
      console.error("Error fetching GSTINs from PAN:", gstinError);
    }

    // Extract registered name
    const registeredName =
      panResponse.data.name ||
      panResponse.data.pan_holder_name ||
      panResponse.data.registered_name ||
      "Verified";

    // Return combined response with both PAN verification and GSTIN list
    res.status(200).json({
      status: "SUCCESS",
      name: registeredName,
      registered_name: registeredName,
      message: "PAN Card verified successfully",
      gstin_list: gstinList, // Include the GSTIN list in the response
      originalResponse: panResponse.data,
    });
  } catch (error) {
    console.error("Error verifying PAN:", error);

    if (error.response) {
      const { status } = error.response;
      console.error("PAN API error response:", {
        status,
        data: error.response.data,
      });

      if (status === 429) {
        return res
          .status(429)
          .json({ message: "Too many requests, please try again later" });
      }

      if (status === 404) {
        return res.status(404).json({ message: "PAN card not found" });
      }

      return res.status(status).json({
        message: "Error from PAN verification API",
        details: error.response.data,
      });
    }

    console.error("Unexpected error:", error.message);
    res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

const DUMMY_ACCOUNT_NO = "0000000000";
const DUMMY_IFSC = "ABCD0ABCDEF";

export const verifyBankDetails = async (req, res) => {
  const { bank_account, ifsc, name, phone } = req.body;

  if (!name || !bank_account || !ifsc) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  const cleanedAcc = String(bank_account).trim().replace(/\s+/g, "");
  const cleanedIfsc = String(ifsc).trim().toUpperCase();

  // 🔹 Dummy bypass: skip Cashfree, return success immediately
  if (cleanedAcc === DUMMY_ACCOUNT_NO && cleanedIfsc === DUMMY_IFSC) {
    return res.status(200).json({
      status: "SUCCESS",
      message: "Bank account verified successfully (dummy bypass)",
      accountDetails: {
        account_status: "VALID",
        name_match_result: "EXACT",
        name_at_bank: name || "DUMMY ACCOUNT",
        match_score: 100,
        bank_name: "Dummy Bank",
        branch: "Dummy Branch",
        utr: "DUMMYUTR0001",
      },
      originalResponse: {
        dummy: true,
      },
    });
  }

  // 🔹 Existing Cashfree flow below this point
  try {
    const clientId = process.env.CASHFREE_CLIENT_ID;
    const clientSecret = process.env.CASHFREE_CLIENT_SECRET;

    const publicKey = `-----BEGIN PUBLIC KEY-----\n${process.env.CASHFREE_PUBLIC_KEY}\n-----END PUBLIC KEY-----`;

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = generateSignature(clientId, publicKey, timestamp);

    const headers = {
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      "X-Cf-Signature": signature,
      "X-Timestamp": timestamp.toString(),
      "Content-Type": "application/json",
    };

    const payload = { bank_account, ifsc, name };
    if (phone) payload.phone = phone;

    const url =
      process.env.IS_DEV === "true"
        ? "https://sandbox.cashfree.com/verification/bank-account/sync"
        : "https://api.cashfree.com/verification/bank-account/sync";

    const response = await axios.post(url, payload, { headers });
    const data = response.data;

    if (data.account_status === "VALID") {
      return res.status(200).json({
        status: "SUCCESS",
        message: "Bank account verified successfully",
        accountDetails: {
          account_status: data.account_status,
          name_match_result: data.name_match_result,
          name_at_bank: data.name_at_bank,
          match_score: data.name_match_score,
          bank_name: data.bank_name,
          branch: data.branch,
          utr: data.utr,
        },
        originalResponse: data,
      });
    } else {
      return res.status(200).json({
        status: "FAILED",
        message: "Bank account could not be verified",
        account_status: data.account_status,
        reason: data.account_status_code,
        originalResponse: data,
      });
    }
  } catch (error) {
    console.error(
      " Bank verification error:",
      error?.response?.data || error.message
    );
    return res.status(500).json({
      message: "Bank verification failed",
      error: error?.response?.data || error.message,
    });
  }
};

export const generateDigilockerUrl = async (req, res) => {
  try {
    const clientId = process.env.CASHFREE_CLIENT_ID;
    const clientSecret = process.env.CASHFREE_CLIENT_SECRET;
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${process.env.CASHFREE_PUBLIC_KEY}\n-----END PUBLIC KEY-----`;

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = generateSignature(clientId, publicKey, timestamp);

    const headers = {
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      "X-Cf-Signature": signature,
      "X-Timestamp": timestamp.toString(),
      "Content-Type": "application/json",
    };

    const url =
      process.env.IS_DEV === "true"
        ? "https://sandbox.cashfree.com/verification/digilocker"
        : "https://api.cashfree.com/verification/digilocker";

    const verification_id = `eventory_dl_${Date.now()}`;
    const payload = {
      verification_id: verification_id,
      document_requested: ["AADHAAR"],
    };

    const response = await axios.post(url, payload, { headers });

    res.status(200).json({
      status: "SUCCESS",
      message: "DigiLocker URL generated successfully",
      url: response.data.url,
      verification_id: verification_id,
      originalResponse: response.data,
    });
  } catch (error) {
    console.error(
      "Error generating DigiLocker URL:",
      error?.response?.data || error.message
    );
    res.status(error?.response?.status || 500).json({
      message: "Failed to generate DigiLocker URL",
      error: error?.response?.data || error.message,
    });
  }
};

export const getDigilockerDocument = async (req, res) => {
  const { verificationId } = req.params;
  const vendor_id = req.query.vendor_id || req.body?.vendor_id;
  const originalAadhar = req.query.aadhar_number || req.body?.aadhar_number;

  if (!verificationId) {
    return res.status(400).json({ message: "verificationId is required" });
  }

  try {
    const clientId = process.env.CASHFREE_CLIENT_ID;
    const clientSecret = process.env.CASHFREE_CLIENT_SECRET;
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${process.env.CASHFREE_PUBLIC_KEY}\n-----END PUBLIC KEY-----`;

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = generateSignature(clientId, publicKey, timestamp);

    const headers = {
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      "X-Cf-Signature": signature,
      "X-Timestamp": timestamp.toString(),
      "Content-Type": "application/json",
    };

    const url =
      process.env.IS_DEV === "true"
        ? `https://sandbox.cashfree.com/verification/digilocker/document/AADHAAR?verification_id=${verificationId}`
        : `https://api.cashfree.com/verification/digilocker/document/AADHAAR?verification_id=${verificationId}`;

    const response = await axios.get(url, { headers });
    const data = response.data;

    // Based on Cashfree Secure ID V2 status for DigiLocker
    if (data.status === "SUCCESS" && vendor_id) {
      try {
        const vendor = await Vendor.findOne({ id: vendor_id });
        if (vendor) {
          // Store the original Aadhaar number sent from frontend
          if (originalAadhar) {
            vendor.aadharNumber = originalAadhar;
          }
          vendor.isAadharVerified = true;
          await vendor.save();
          console.log(
            `Updated Vendor ${vendor_id} with Aadhaar status from DigiLocker`
          );
        }
      } catch (vendorError) {
        console.error("Error updating vendor with DigiLocker data:", vendorError);
      }
    }

    res.status(200).json({
      status: "SUCCESS",
      message: "Fetched DigiLocker Document successfully",
      originalResponse: data,
    });
  } catch (error) {
    console.error(
      "Error fetching DigiLocker document:",
      error?.response?.data || error.message
    );
    res.status(error?.response?.status || 500).json({
      message: "Failed to fetch DigiLocker document",
      error: error?.response?.data || error.message,
    });
  }
};

export { verifyGSTIN, verifyPAN };
