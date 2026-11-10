import express from "express";
import {
  getSupportChat,
  joinSupportChat,
  listSupportChats,
  resolveSupportChatByEm,
  sendEmSupportMessage,
} from "../controllers/adminSupportChatController.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import {
  adminSupportChatListSchema,
  emJoinSchema,
  emMessageSchema,
  emResolveSchema,
} from "../validators/supportChatValidators.js";

const router = express.Router();

/**
 * Mounted at /api/admin/support-chats (src/routes/index.js). Same access
 * model as the other /api/admin routers.
 */
router.get("/", validateRequest(adminSupportChatListSchema, "query"), listSupportChats);
router.get("/:chatId", getSupportChat);
router.post("/:chatId/join", validateRequest(emJoinSchema), joinSupportChat);
router.post("/:chatId/messages", validateRequest(emMessageSchema), sendEmSupportMessage);
router.post("/:chatId/resolve", validateRequest(emResolveSchema), resolveSupportChatByEm);

export default router;
