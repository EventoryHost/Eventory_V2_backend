import express from "express";

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

const router = express.Router();

router.post("/presign", uploadLimiter, validateRequest(presignSchema), presignUpload);
router.post(
  "/multipart/create",
  uploadLimiter,
  validateRequest(multipartCreateSchema),
  startMultipartUpload,
);
router.post("/multipart/complete", validateRequest(multipartCompleteSchema), finishMultipartUpload);
router.post("/multipart/abort", validateRequest(multipartAbortSchema), cancelMultipartUpload);
router.delete("/", uploadLimiter, validateRequest(deleteSchema), deleteUpload);
router.get("/commercial-csv/:fileName", getCommercialCsv);

export default router;
