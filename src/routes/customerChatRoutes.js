import express from "express";
import { initChat, sendMessage, getMessages, getChatStatus, resetChat } from "../controllers/customerChatController.js";

const router = express.Router();

/**
 * Mounted at /api/customer/chat (src/routes/index.js) — Anonymous Chat /
 * lead-gen chatbot. Public, no protectCustomer requirement on any route:
 * works for an anonymous homepage visitor by design (identity resolution
 * happens inside the controller — see resolveChatIdentity), and also
 * transparently upgrades to a logged-in customer's own identity if a
 * valid access token is present.
 */

/**
 * @swagger
 * /api/customer/chat/init:
 *   post:
 *     summary: Initialize (or resume) a chat session — sends the automated greeting once per session
 *     tags: [Customer Chat]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               anon_id: { type: string, description: "Client-generated/localStorage id for an anonymous visitor; omit if logged in" }
 *               source: { type: string, description: "e.g. homepage_widget, shared_link" }
 *     responses:
 *       200: { description: chatId + chatType + anonId (server-minted if none was supplied) }
 */
router.post("/init", initChat);

/**
 * @swagger
 * /api/customer/chat/send:
 *   post:
 *     summary: Send a message — saves it, broadcasts it, and advances the chatbot's reply
 *     tags: [Customer Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [chatId, message_content]
 *             properties:
 *               chatId: { type: string }
 *               message_content: { type: string }
 *               message_type: { type: string, enum: [text, options, date_picker, multi_select] }
 *     responses:
 *       201: { description: Saved user message; bot reply/replies arrive over the chat's socket room }
 *       400: { description: chatId and message_content are required }
 *       404: { description: Chat not found }
 */
router.post("/send", sendMessage);

/**
 * @swagger
 * /api/customer/chat/{chatId}/messages:
 *   get:
 *     summary: Paginated message history for a chat, oldest to newest
 *     tags: [Customer Chat]
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30, maximum: 100 }
 *     responses:
 *       200: { description: messages + hasMore + nextCursor }
 */
router.get("/:chatId/messages", getMessages);

/**
 * @swagger
 * /api/customer/chat/status:
 *   get:
 *     summary: Current chat status for this identity (ACTIVE / FINISHED / NONE)
 *     tags: [Customer Chat]
 *     parameters:
 *       - in: query
 *         name: anon_id
 *         schema: { type: string }
 *     responses:
 *       200: { description: status + chatId (if any) }
 */
router.get("/status", getChatStatus);

/**
 * @swagger
 * /api/customer/chat/reset:
 *   post:
 *     summary: End the current active chat and close any open enquiry, so the next /init starts fresh
 *     tags: [Customer Chat]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               anon_id: { type: string }
 *     responses:
 *       200: { description: Chat reset }
 *       404: { description: No active chat found to reset }
 */
router.post("/reset", resetChat);

export default router;
