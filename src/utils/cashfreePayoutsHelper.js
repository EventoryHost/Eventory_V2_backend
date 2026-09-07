import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

export function generateSignature(clientId, key, timestamp) {
  const publicKey = crypto.createPublicKey({
    key: key,
    format: "pem",
  });
  const data = `${clientId}.${timestamp}`;

  const encryptedData = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(data, "utf8"),
  );

  const signature = encryptedData.toString("base64");
  return signature;
}

export function buildPayoutsHeaders() {
  const payoutsClientId = process.env.CASHFREE_CLIENT_ID;
  const payoutsSecret = process.env.CASHFREE_CLIENT_SECRET;
  
  if (!payoutsClientId || !payoutsSecret) {
    throw new Error("Missing Cashfree Payouts credentials in environment variables");
  }

  const publicKeyString = process.env.CASHFREE_PUBLIC_KEY;
  if (!publicKeyString) {
      throw new Error("Missing Cashfree Public Key in environment variables");
  }

  const publicKey = `-----BEGIN PUBLIC KEY-----\n${publicKeyString}\n-----END PUBLIC KEY-----`;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateSignature(payoutsClientId, publicKey, timestamp);

  return {
    "Content-Type": "application/json",
    "x-api-version": "2024-01-01",
    "x-client-id": `${payoutsClientId}`,
    "x-client-secret": `${payoutsSecret}`,
    "x-cf-signature": `${signature}`,
  };
}

export function getPayoutsBaseUrl() {
  return process.env.IS_DEV === "true"
    ? "https://sandbox.cashfree.com/payout"
    : "https://api.cashfree.com/payout";
}
