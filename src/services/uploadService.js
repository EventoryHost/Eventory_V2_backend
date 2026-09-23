import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { s3 } from "../config/awsConfig.js";

export const PART_SIZE = 5 * 1024 * 1024;
export const SINGLE_UPLOAD_MAX_SIZE = 10 * 1024 * 1024;
// Not a product limit — the app enforces its own per-picker caps. This only
// bounds how many part URLs one request can ask us to sign.
export const MAX_UPLOAD_SIZE = 200 * 1024 * 1024;

const PUT_URL_TTL = 900;
const PART_URL_TTL = 3600;

const bucket = () => process.env.AWS_S3_BUCKET_NAME;

const COMMERCIAL_CSV_FILES = new Set([
  "eventory_s3_data_vendor_cancellation_charges.csv",
  "eventory_s3_data_customer_cancellation_charges.csv",
  "eventory_s3_data_vendor_commission_fees.csv",
  "eventory_s3_data_customer_convenience_fees.csv",
  "eventory_s3_data_vendor_score_calculation.csv",
  "eventory_s3_data_category_calculation.csv",
]);

const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function mimeTypeFromExtension(extension) {
  switch (String(extension ?? "").toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "mp4":
      return "video/mp4";
    case "mov":
      return "video/quicktime";
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

function mimeTypeFor(fileName) {
  const extension = fileName.includes(".") ? fileName.split(".").pop() : null;
  return mimeTypeFromExtension(extension);
}

function sanitizePathSegment(value) {
  const sanitized = String(value)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized === "" ? "general" : sanitized;
}

function folderFor(mimeType, vendorType) {
  let type;
  if (mimeType.startsWith("image/")) type = "images";
  else if (mimeType.startsWith("video/")) type = "videos";
  else if (DOCUMENT_MIME_TYPES.has(mimeType)) type = "documents";
  else type = "others";
  return `${sanitizePathSegment(vendorType)}/${type}/`;
}

function formatFileName(originalName) {
  const sanitized = originalName
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9.\-_]/g, "");
  return `${Date.now()}-${sanitized}`;
}

export function buildObjectKey(fileName, vendorType) {
  const contentType = mimeTypeFor(fileName);
  return {
    key: `${folderFor(contentType, vendorType)}${formatFileName(fileName)}`,
    contentType,
  };
}

export function buildPublicUrl(key) {
  const cloudFront = process.env.CLOUDFRONT_URL ?? "";
  if (cloudFront === "") {
    return `https://${bucket()}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  }
  return `${cloudFront.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

export function extractKey(fileUrl) {
  return decodeURIComponent(String(fileUrl).replace(/^https?:\/\/[^/]+\//, ""));
}

export async function createPresignedPut({ fileName, vendorType }) {
  const { key, contentType } = buildObjectKey(fileName, vendorType);
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
      ACL: "public-read",
    }),
    { expiresIn: PUT_URL_TTL },
  );
  return { uploadUrl, key, publicUrl: buildPublicUrl(key), contentType };
}

export async function createMultipart({ fileName, vendorType, size }) {
  const { key, contentType } = buildObjectKey(fileName, vendorType);

  const created = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
      ACL: "public-read",
    }),
  );

  const partCount = Math.ceil(size / PART_SIZE);
  // UploadPart carries neither ContentType nor ACL: signing either on a part
  // makes S3 reject the PUT with SignatureDoesNotMatch.
  const partUrls = await Promise.all(
    Array.from({ length: partCount }, (_, index) =>
      getSignedUrl(
        s3,
        new UploadPartCommand({
          Bucket: bucket(),
          Key: key,
          UploadId: created.UploadId,
          PartNumber: index + 1,
        }),
        { expiresIn: PART_URL_TTL },
      ),
    ),
  );

  return {
    uploadId: created.UploadId,
    key,
    publicUrl: buildPublicUrl(key),
    contentType,
    partSize: PART_SIZE,
    partUrls,
  };
}

export async function completeMultipart({ key, uploadId, parts }) {
  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: [...parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((part) => ({ PartNumber: part.partNumber, ETag: part.eTag })),
      },
    }),
  );
  return { key, publicUrl: buildPublicUrl(key) };
}

export function abortMultipart({ key, uploadId }) {
  return s3.send(
    new AbortMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
    }),
  );
}

export function deleteObject({ url, key }) {
  return s3.send(
    new DeleteObjectCommand({ Bucket: bucket(), Key: key ?? extractKey(url) }),
  );
}

export function isCommercialCsv(fileName) {
  return COMMERCIAL_CSV_FILES.has(fileName);
}

export async function readCommercialCsv(fileName) {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.CSV_S3_BUCKET,
      Key: `${process.env.CSV_S3_PREFIX ?? ""}${fileName}`,
    }),
  );
  return response.Body ? response.Body.transformToString("utf-8") : null;
}
