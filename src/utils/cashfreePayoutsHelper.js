import dotenv from "dotenv";
import { generateSignature } from "./generateId.js";

dotenv.config();

export function buildPayoutsHeaders() {
  const payoutsClientId = process.env.CASHFREE_CLIENT_ID;
  const payoutsSecret = process.env.CASHFREE_CLIENT_SECRET;
  const rawKey = process.env.CASHFREE_PUBLIC_KEY || process.env.CAHFREE_PUBLIC_KEY || "";
  const publicKey = rawKey.includes("-----BEGIN PUBLIC KEY-----")
    ? rawKey
    : `-----BEGIN PUBLIC KEY-----\n${rawKey}\n-----END PUBLIC KEY-----`;
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
