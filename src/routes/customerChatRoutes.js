import express from "express";
import {
  initChat,
  sendMessage,
  getMessages,
  getChatStatus,
  resetChat,
  createHelpRequest,
  getHelpRequest,
  postHelpRequestMessage,
  requestHelpCallBack,
  checkHelpArea,
  joinAreaWaitlist,
} from "../controllers/customerChatController.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import {
  createHelpRequestSchema,
  helpRequestCallBackSchema,
  helpRequestMessageSchema,
  areaCheckQuerySchema,
  areaWaitlistSchema,
} from "../validators/customerHelpValidators.js";

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

/**
 * @swagger
 * /api/customer/chat/help-request:
 *   post:
 *     summary: Send the help panel brief to the Event Manager team (stored as a ChatEnquiry lead + Slack post)
 *     tags: [Customer Chat]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [occasion, guests, budget, vendorType, replyMode]
 *             properties:
 *               anon_id: { type: string }
 *               occasion: { type: string }
 *               guests: { type: string }
 *               budget: { type: string }
 *               vendorType: { type: string }
 *               area: { type: string }
 *               date: { type: string }
 *               replyMode: { type: string, enum: [reply-here, call-me] }
 *               callTime: { type: string }
 *               phone: { type: string, description: "Required when replyMode is call-me" }
 *               pageUrl: { type: string }
 *               transcript: { type: array, items: { type: string } }
 *     responses:
 *       201: { description: "{ enquiryId, anonId }" }
 *       400: { description: Validation failed }
 */
router.post("/help-request", validateRequest(createHelpRequestSchema), createHelpRequest);

/**
 * @swagger
 * /api/customer/chat/help-request/{enquiryId}:
 *   get:
 *     summary: Help panel thread after the brief — Event Manager replies, call back, late flag (polled)
 *     tags: [Customer Chat]
 *     parameters:
 *       - in: path
 *         name: enquiryId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: anon_id
 *         schema: { type: string, description: "The anon id the request was sent with; omit if logged in" }
 *     responses:
 *       200: { description: "{ request: { enquiryId, createdAt, replyMode, offHours, late, replied, callBack, messages } }" }
 *       404: { description: Not this caller's request }
 */
router.get("/help-request/:enquiryId", getHelpRequest);

/**
 * @swagger
 * /api/customer/chat/help-request/{enquiryId}/messages:
 *   post:
 *     summary: Customer follow-up message in the help thread (posted to Slack)
 *     tags: [Customer Chat]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               anon_id: { type: string }
 *               text: { type: string }
 *     responses:
 *       201: { description: "{ message }" }
 */
router.post("/help-request/:enquiryId/messages", validateRequest(helpRequestMessageSchema), postHelpRequestMessage);

/**
 * @swagger
 * /api/customer/chat/help-request/{enquiryId}/call-back:
 *   post:
 *     summary: Request a call back on a help request (within 30 min, or 9:30 AM IST after hours)
 *     tags: [Customer Chat]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               anon_id: { type: string }
 *               phone: { type: string }
 *     responses:
 *       201: { description: "{ request } with callBack set" }
 */
router.post("/help-request/:enquiryId/call-back", validateRequest(helpRequestCallBackSchema), requestHelpCallBack);

/**
 * @swagger
 * /api/customer/chat/area-check:
 *   get:
 *     summary: Help panel location step — is this free-text area / pincode served? Closest served areas if not; city choices if ambiguous
 *     tags: [Customer Chat]
 *     parameters:
 *       - in: query
 *         name: area
 *         required: true
 *         schema: { type: string, example: "Sector 15" }
 *     responses:
 *       200: { description: "{ area: { label, serviceable, city, pincode, matchedBy, ambiguous[], closest[] } }" }
 */
router.get("/area-check", validateRequest(areaCheckQuerySchema, "query"), checkHelpArea);

/**
 * @swagger
 * /api/customer/chat/area-waitlist:
 *   post:
 *     summary: Out-of-area "Notify me" lead — one WhatsApp message when Eventory starts serving the area
 *     tags: [Customer Chat]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [area, phone, consent]
 *             properties:
 *               anon_id: { type: string }
 *               area: { type: string }
 *               areaSource: { type: string, enum: [typed, location_tag] }
 *               phone: { type: string }
 *               consent: { type: boolean, enum: [true] }
 *               occasion: { type: string }
 *               guests: { type: string }
 *               budget: { type: string }
 *               requestText: { type: string }
 *               pageUrl: { type: string }
 *     responses:
 *       201: { description: Saved }
 */
router.post("/area-waitlist", validateRequest(areaWaitlistSchema), joinAreaWaitlist);

export default router;
