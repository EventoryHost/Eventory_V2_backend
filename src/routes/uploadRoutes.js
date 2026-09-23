import express from "express";
const router = express.Router();
import {
  cancelMultipartUpload,
  deleteUpload,
  finishMultipartUpload,
  getCommercialCsv,
  presignUpload,
  startMultipartUpload,
} from "../controllers/uploadController.js";
import { uploadLimiter } from "../middlewares/rateLimiters.js";
import validateRequest from "../middlewares/validateRequest.js";
import {
  deleteSchema,
  multipartAbortSchema,
  multipartCompleteSchema,
  multipartCreateSchema,
  presignSchema,
} from "../validators/uploadValidators.js";

/**
 * @swagger
 * /api/uploads/presign:
 *   post:
 *     summary: Presign a single-PUT upload
 *     description: >
 *       Returns a short-lived presigned S3 URL the client PUTs the file bytes
 *       to directly. The client must send the returned contentType and the
 *       header `x-amz-acl: public-read`, both of which are part of the
 *       signature. Use the multipart endpoints for files over 10 MB.
 *     tags:
 *       - Uploads
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fileName, vendorType]
 *             properties:
 *               fileName:
 *                 type: string
 *                 example: "portfolio shot.jpg"
 *               vendorType:
 *                 type: string
 *                 example: "business-photos"
 *               size:
 *                 type: integer
 *                 example: 482913
 *     responses:
 *       200:
 *         description: Presigned upload URL, object key and final public URL
 *       400:
 *         description: Validation failed
 */
router.post("/presign", uploadLimiter, validateRequest(presignSchema), presignUpload);

/**
 * @swagger
 * /api/uploads/multipart/create:
 *   post:
 *     summary: Start a multipart upload and presign every part
 *     description: >
 *       Returns an uploadId plus one presigned URL per 5 MB part, derived from
 *       the declared size. Parts are PUT with no Content-Type and no ACL header
 *       — signing either on a part fails the signature. Collect each response's
 *       ETag and pass them to /multipart/complete.
 *     tags:
 *       - Uploads
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fileName, vendorType, size]
 *             properties:
 *               fileName:
 *                 type: string
 *                 example: "showreel.mp4"
 *               vendorType:
 *                 type: string
 *                 example: "DjArtist"
 *               size:
 *                 type: integer
 *                 example: 41943040
 *     responses:
 *       200:
 *         description: uploadId, key, publicUrl, partSize and partUrls
 *       400:
 *         description: Validation failed
 */
router.post(
  "/multipart/create",
  uploadLimiter,
  validateRequest(multipartCreateSchema),
  startMultipartUpload,
);

/**
 * @swagger
 * /api/uploads/multipart/complete:
 *   post:
 *     summary: Assemble the uploaded parts into the final object
 *     description: >
 *       ETags must be passed back exactly as S3 returned them, quotes included.
 *     tags:
 *       - Uploads
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [key, uploadId, parts]
 *             properties:
 *               key:
 *                 type: string
 *               uploadId:
 *                 type: string
 *               parts:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     partNumber:
 *                       type: integer
 *                     eTag:
 *                       type: string
 *     responses:
 *       200:
 *         description: The completed object's public URL
 */
router.post(
  "/multipart/complete",
  validateRequest(multipartCompleteSchema),
  finishMultipartUpload,
);

/**
 * @swagger
 * /api/uploads/multipart/abort:
 *   post:
 *     summary: Discard an incomplete multipart upload
 *     tags:
 *       - Uploads
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [key, uploadId]
 *             properties:
 *               key:
 *                 type: string
 *               uploadId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Upload aborted
 */
router.post("/multipart/abort", validateRequest(multipartAbortSchema), cancelMultipartUpload);

/**
 * @swagger
 * /api/uploads:
 *   delete:
 *     summary: Delete an uploaded object
 *     description: Accepts either the public URL returned at upload time or the raw object key.
 *     tags:
 *       - Uploads
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *               key:
 *                 type: string
 *     responses:
 *       200:
 *         description: File removed
 */
router.delete("/", uploadLimiter, validateRequest(deleteSchema), deleteUpload);

/**
 * @swagger
 * /api/uploads/commercial-csv/{fileName}:
 *   get:
 *     summary: Read one of the static commercial CSV tables
 *     description: >
 *       These datasets live in a private bucket, so they are read server-side
 *       and returned as text. Only the known eventory_s3_data_*.csv names are
 *       served.
 *     tags:
 *       - Uploads
 *     parameters:
 *       - in: path
 *         name: fileName
 *         required: true
 *         schema:
 *           type: string
 *         example: eventory_s3_data_vendor_commission_fees.csv
 *     responses:
 *       200:
 *         description: The CSV contents
 *       404:
 *         description: Unknown or missing dataset
 */
router.get("/commercial-csv/:fileName", getCommercialCsv);

export default router;
