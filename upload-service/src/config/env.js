import "dotenv/config";

const REQUIRED = [
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_S3_BUCKET_NAME",
];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

export const env = Object.freeze({
  port: Number(process.env.PORT) || 5100,
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS) || 0,
  awsRegion: process.env.AWS_REGION,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  bucket: process.env.AWS_S3_BUCKET_NAME,
  cloudFrontUrl: process.env.CLOUDFRONT_URL ?? "",
  csvBucket: process.env.S3_BUCKET ?? "",
});
