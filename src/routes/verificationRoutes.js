import "dotenv/config";
import express from "express";
import multer from "multer";
const verificationRoutes = express.Router();

import { verifyGSTIN, verifyPAN, verifyBankDetails, generateDigilockerUrl, getDigilockerDocument, faceMatch } from "../controllers/verificationController.js";

// Multer config for Face Match
const faceMatchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type. Only JPEG, JPG, PNG allowed'), false);
  },
});

/**
 * @swagger
 * /api/verification/GSTIN/{gstIn}:
 *   get:
 *     summary: Verify GSTIN
 *     description: Verify a GSTIN using Cashfree API.
 *     tags:
 *       - Verification
 *     parameters:
 *       - in: path
 *         name: gstIn
 *         required: true
 *         schema:
 *           type: string
 *         description: The GSTIN to verify
 *     responses:
 *       200:
 *         description: GSTIN verified successfully
 *       400:
 *         description: Invalid GSTIN format
 */
verificationRoutes.get("/GSTIN/:gstIn", verifyGSTIN);
/**
 * @swagger
 * /api/verification/pan-gstin/{panNo}:
 *   get:
 *     summary: Verify PAN and fetch associated GSTINs
 *     description: Verify a PAN card and retrieve associated GSTINs.
 *     tags:
 *       - Verification
 *     parameters:
 *       - in: path
 *         name: panNo
 *         required: true
 *         schema:
 *           type: string
 *         description: The PAN number to verify
 *       - in: query
 *         name: vendor_id
 *         schema:
 *           type: string
 *         description: Optional vendor ID to update
 *     responses:
 *       200:
 *         description: PAN verified successfully
 *       400:
 *         description: Invalid PAN format
 */
verificationRoutes.get("/pan-gstin/:panNo", verifyPAN);
/**
 * @swagger
 * /api/verification/bank:
 *   post:
 *     summary: Verify Bank Account
 *     description: Verify bank account details and IFSC using Cashfree API.
 *     tags:
 *       - Verification
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bank_account
 *               - ifsc
 *               - name
 *             properties:
 *               bank_account:
 *                 type: string
 *                 example: "1234567890"
 *               ifsc:
 *                 type: string
 *                 example: "HDFC0001234"
 *               name:
 *                 type: string
 *                 example: "John Doe"
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *     responses:
 *       200:
 *         description: Bank account verification status
 *       400:
 *         description: Missing required fields
 */
verificationRoutes.post("/bank", verifyBankDetails);
/**
 * @swagger
 * /api/verification/digilocker/generate-url:
 *   post:
 *     summary: Generate DigiLocker URL
 *     description: Generates a DigiLocker consent URL for Aadhaar verification.
 *     tags:
 *       - Verification
 *     responses:
 *       200:
 *         description: DigiLocker URL generated successfully
 */
verificationRoutes.post("/digilocker/generate-url", generateDigilockerUrl);
/**
 * @swagger
 * /api/verification/digilocker/document/{verificationId}:
 *   get:
 *     summary: Fetch DigiLocker Document
 *     description: Retrieves the verified DigiLocker document (Aadhaar) using the verification ID.
 *     tags:
 *       - Verification
 *     parameters:
 *       - in: path
 *         name: verificationId
 *         required: true
 *         schema:
 *           type: string
 *         description: The verification ID returned during URL generation
 *       - in: query
 *         name: vendor_id
 *         schema:
 *           type: string
 *         description: Optional vendor ID to update
 *       - in: query
 *         name: aadhar_number
 *         schema:
 *           type: string
 *         description: Optional original Aadhaar number to store
 *     responses:
 *       200:
 *         description: Fetched DigiLocker Document successfully
 *       400:
 *         description: Missing verificationId
 */
verificationRoutes.get("/digilocker/document/:verificationId", getDigilockerDocument);

/**
 * @swagger
 * /api/verification/face-match:
 *   post:
 *     summary: Verify Face Match
 *     description: Verify facial match between two images.
 *     tags:
 *       - Verification
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - first_image
 *               - second_image
 *             properties:
 *               first_image:
 *                 type: string
 *                 format: binary
 *                 description: First image to compare (JPEG, PNG, max 5MB)
 *               second_image:
 *                 type: string
 *                 format: binary
 *                 description: Second image to compare (JPEG, PNG, max 5MB)
 *               verification_id:
 *                 type: string
 *                 description: Optional unique ID for the request
 *               threshold:
 *                 type: string
 *                 description: Optional threshold between 0 and 1 (default 0.75)
 *     parameters:
 *       - in: query
 *         name: vendor_id
 *         schema:
 *           type: string
 *         description: Optional vendor ID to update face match status
 *     responses:
 *       200:
 *         description: Face match completed successfully
 *       400:
 *         description: Missing files or invalid request
 *       500:
 *         description: Face match verification failed
 */
verificationRoutes.post(
  "/face-match",
  faceMatchUpload.fields([
    { name: 'first_image', maxCount: 1 },
    { name: 'second_image', maxCount: 1 },
  ]),
  faceMatch
);

export default verificationRoutes;