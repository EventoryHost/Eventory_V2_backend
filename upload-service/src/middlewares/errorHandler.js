import { logger } from "../utils/logger.js";

const S3_CLIENT_ERRORS = {
  NoSuchUpload: { status: 404, message: "Upload not found or already finished" },
  NoSuchKey: { status: 404, message: "File not found" },
  InvalidPart: { status: 400, message: "One or more parts are missing or have a wrong ETag" },
  InvalidPartOrder: { status: 400, message: "Parts are not in ascending order" },
  EntityTooSmall: { status: 400, message: "A non-final part is smaller than 5 MB" },
};

function isS3Error(err) {
  return Boolean(err?.$metadata);
}

function resolve(err) {
  if (err.statusCode) return { status: err.statusCode, message: err.message };
  if (isS3Error(err)) {
    return S3_CLIENT_ERRORS[err.name] ?? { status: 502, message: "Storage service error" };
  }
  return { status: 500, message: "Internal Server Error" };
}

export function notFound(req, res) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

export function errorHandler(err, req, res, next) {
  const { status, message } = resolve(err);

  logger.error("request failed", {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    status,
    error: err.name,
    errorMessage: err.message,
    s3Status: err.$metadata?.httpStatusCode,
    s3RequestId: err.$metadata?.requestId,
    s3ExtendedRequestId: err.$metadata?.extendedRequestId,
    key: req.body?.key,
    uploadId: req.body?.uploadId,
    fileName: req.body?.fileName ?? req.params?.fileName,
    stack: status >= 500 ? err.stack : undefined,
  });

  res.status(status).json({
    success: false,
    message,
    requestId: req.id,
    ...(isS3Error(err) && { code: err.name }),
    detail: err.message,
  });
}
