import { S3Client } from "@aws-sdk/client-s3";

import { env } from "./env.js";

// WHEN_REQUIRED stops the SDK baking an empty-body CRC32 into presigned URLs,
// which makes every upload through them fail on a digest mismatch.
export const s3 = new S3Client({
  region: env.awsRegion,
  credentials: {
    accessKeyId: env.awsAccessKeyId,
    secretAccessKey: env.awsSecretAccessKey,
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
