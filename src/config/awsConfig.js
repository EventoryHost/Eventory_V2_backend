import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config();

const credentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
};

export const cognito = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION,
  credentials,
});

// WHEN_REQUIRED disables the SDK's default CRC32 checksum. Left on, presigning
// bakes the checksum of an empty body into the URL as a query parameter, and
// every upload through that URL then fails on a digest mismatch.
export const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
