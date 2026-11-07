import express from "express";
import {
  getSupportChatMessages,
  handoverSupportChat,
  openSupportChat,
  requestSupportCall,
  resolveSupportChatByVendor,
  sendVendorSupportMessage,
} from "../controllers/supportChatController.js";
import { requireVendor } from "../middlewares/vendorAuth.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import {
  openSupportChatSchema,
  supportTranscriptSchema,
  vendorSupportMessageSchema,
} from "../validators/supportChatValidators.js";

const router = express.Router();

/**
 * Mounted at /api/support/chats. Chats hold vendor contact and business
 * details, so a valid vendor token is required here whatever
 * VENDOR_AUTH_MODE is set to.
 */
const requireVendorIdentity = [
  requireVendor(),
  (req, res, next) =>
    req.authVendorId
      ? next()
      : res.status(401).json({ success: false, status: "FAILED", message: "Authentication required. Please log in again." }),
];

router.use(requireVendorIdentity);

router.post("/", validateRequest(openSupportChatSchema), openSupportChat);
router.post("/:chatId/handover", validateRequest(supportTranscriptSchema), handoverSupportChat);
router.post("/:chatId/call-request", validateRequest(supportTranscriptSchema), requestSupportCall);
router.post("/:chatId/resolve", validateRequest(supportTranscriptSchema), resolveSupportChatByVendor);
router.get("/:chatId/messages", getSupportChatMessages);
router.post("/:chatId/messages", validateRequest(vendorSupportMessageSchema), sendVendorSupportMessage);

export default router;
