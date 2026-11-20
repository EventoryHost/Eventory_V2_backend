import express from "express";
import { z } from "zod";
import { protectCustomer } from "../middlewares/customerAuth.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { getWhatsAppConsent, updateWhatsAppConsent } from "../controllers/customerWhatsAppConsentController.js";
import { CONSENT_SOURCES } from "../services/whatsappConsentService.js";

const router = express.Router();

const consentSchema = z.object({
  optIn: z.boolean({ error: "optIn must be true or false" }),
  source: z.enum(CONSENT_SOURCES).optional(),
});

/**
 * @swagger
 * /api/customer/whatsapp-consent:
 *   get:
 *     summary: The logged-in customer's WhatsApp notification consent
 *     tags: [Customer WhatsApp]
 *     responses:
 *       200: { description: "{ optedIn, status, optedInAt, optedOutAt, source, phone, isPhoneVerified }" }
 *   put:
 *     summary: Opt in to or out of WhatsApp notifications (explicit customer action only)
 *     tags: [Customer WhatsApp]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [optIn]
 *             properties:
 *               optIn: { type: boolean }
 *               source: { type: string, enum: [signup, checkout, booking, profile, settings, support] }
 *     responses:
 *       200: { description: Consent recorded }
 */
router.get("/", protectCustomer, getWhatsAppConsent);
router.put("/", protectCustomer, validateRequest(consentSchema), updateWhatsAppConsent);

export default router;
