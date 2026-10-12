import jwt from "jsonwebtoken";
import Customer from "../models/Customer.js";
import AnonChatUser from "../models/AnonChatUser.js";
import ChatSession from "../models/ChatSession.js";
import ChatMessage from "../models/ChatMessage.js";
import ChatEnquiry from "../models/ChatEnquiry.js";
import { handleBotTurn } from "../services/chatBotEngine.js";
import { notifyHelpRequest, notifyHelpCallBack, notifyHelpMessage, notifyAreaWaitlist } from "../services/chatSlackNotifier.js";
import AreaWaitlist from "../models/AreaWaitlist.js";
import { lookupArea } from "../services/areaLookupService.js";
import { resolveArea } from "../utils/serviceability.js";
import {
  callBackDeadline,
  checkLate,
  isOffHours,
  nextTicket,
  serializeHelpRequest,
} from "../services/helpRequestService.js";
import { room } from "../config/socket.js";
import { generateISTId } from "../utils/idGenerator.js";

/**
 * Anonymous Chat / lead-gen chatbot — Phase 6. Public homepage widget,
 * works for both an anonymous visitor and an already-logged-in customer
 * (mirrors V1's anon_customer-admin / customer-admin split), reusing the
 * same "valid token wins, otherwise fall back to a client-supplied id"
 * soft-auth shape as customerAuth.js's identifyCartOwner — not that exact
 * middleware (its guest id comes from a header meant for the cart), but
 * the same underlying pattern, since the client's own spec has the
 * frontend hold anon_id in localStorage and send it in the request body.
 *
 * Deliberately excludes V1's admin-facing endpoints (getAllAnonymousChats,
 * getAnonymousChatDetails) — those back an admin inbox UI that doesn't
 * exist in this codebase (see info.txt PART 5 Flag #2, still open) and
 * this task is scoped to customer-side backend only.
 */

// Verifies a customer access token if present, WITHOUT ever 401ing — same
// soft-auth philosophy as identifyCartOwner, just checking the JWT
// directly here rather than importing that cart-specific middleware.
async function resolveLoggedInCustomer(req) {
  const authHeader = req.headers.authorization || "";
  const [scheme, headerToken] = authHeader.split(" ");
  const token = (scheme === "Bearer" && headerToken) || req.cookies?.accessToken;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "customer") return null;
    const customer = await Customer.findOne({ id: decoded.id }).lean();
    return customer && !customer.isDeactivated ? customer : null;
  } catch {
    return null;
  }
}

/**
 * Resolves who is chatting: a logged-in Customer (token wins) or an
 * anonymous visitor identified by the anon_id the frontend generated and
 * persisted in localStorage per the client's own spec (sent in the body
 * for /send and /init, as a query/param for the read endpoints). Never
 * throws/401s — an anon_id is minted server-side if none was supplied, so
 * the widget always has something to work with.
 */
async function resolveChatIdentity(req, bodyOrQuery) {
  const customer = await resolveLoggedInCustomer(req);
  if (customer) {
    return { chatType: "customer-admin", customerId: customer._id, customer };
  }

  let anonId = (bodyOrQuery.anon_id || bodyOrQuery.anonId || "").toString().trim();
  if (!anonId) {
    anonId = generateISTId("ANON");
  }

  await AnonChatUser.findOneAndUpdate(
    { anonId },
    { $setOnInsert: { anonId }, $set: { lastSeenAt: new Date() } },
    { upsert: true }
  );

  return { chatType: "anon-admin", anonId };
}

function toEnquiryFilter(identity) {
  return identity.chatType === "customer-admin"
    ? { customerId: identity.customerId }
    : { anonId: identity.anonId };
}

/**
 * @desc Initialize (or resume) a chat session, and send the automated
 * greeting exactly once per session (guarded by
 * ChatSession.isAutoInitialised — a page refresh / reconnect never
 * re-triggers it).
 * POST /api/customer/chat/init
 */
export const initChat = async (req, res) => {
  try {
    const identity = await resolveChatIdentity(req, req.body || {});
    const io = req.app.get("io");

    const findQuery = { chatStatus: "ACTIVE", ...toEnquiryFilter(identity) };
    let chat = await ChatSession.findOne(findQuery);
    let isNewChat = false;

    if (!chat) {
      isNewChat = true;
      chat = await ChatSession.create({
        chatId: generateISTId("CHAT"),
        chatType: identity.chatType,
        chatStatus: "ACTIVE",
        source: req.body?.source || null,
        ...(identity.chatType === "customer-admin" ? { customerId: identity.customerId } : { anonId: identity.anonId }),
      });
    }

    if (!chat.isAutoInitialised) {
      chat.isAutoInitialised = true;
      await chat.save();

      // Same two-message drip the client's spec/V1 uses — small delays so
      // the widget feels conversational rather than dumping both at once.
      setTimeout(async () => {
        const greeting = await ChatMessage.create({
          chatId: chat.chatId,
          sender: "bot",
          senderId: "bot",
          messageType: "text",
          messageContent:
            "Hey there! Welcome to Eventory - your personal event planning companion. Let's get your dream event rolling. It'll only take 2 minutes!",
        });
        if (io) io.to(room(chat.chatId)).emit("new_message", greeting.toObject());
      }, 500);

      setTimeout(async () => {
        const optionsMsg = await ChatMessage.create({
          chatId: chat.chatId,
          sender: "bot",
          senderId: "bot",
          messageType: "options",
          messageContent: "First things first - what are we celebrating?",
          options: [
            { label: "Birthday", value: "Birthday" },
            { label: "Anniversary", value: "Anniversary" },
            { label: "Social Gathering", value: "Social Gathering" },
            { label: "Corporate Event", value: "Corporate Event" },
            { label: "Something else", value: "Something else" },
          ],
        });
        if (io) io.to(room(chat.chatId)).emit("new_message", optionsMsg.toObject());
      }, 2500);
    }

    return res.status(200).json({
      success: true,
      chatId: chat.chatId,
      chatType: chat.chatType,
      anonId: identity.anonId || null,
      isNew: isNewChat,
    });
  } catch (error) {
    console.error("[customerChatController] initChat error:", error);
    return res.status(500).json({ success: false, message: "Failed to initialize chat" });
  }
};

/**
 * @desc Send a message — saves it, emits it over the chat's socket room,
 * and (for a real user message, not a bot-authored one) advances the
 * chatbot's state machine for a reply.
 * POST /api/customer/chat/send
 */
export const sendMessage = async (req, res) => {
  try {
    const { chatId, message_content: messageContent, message_type: messageType } = req.body;

    if (!chatId || !messageContent) {
      return res.status(400).json({ success: false, message: "chatId and message_content are required" });
    }

    const chat = await ChatSession.findOne({ chatId });
    if (!chat) {
      return res.status(404).json({ success: false, message: "Chat not found" });
    }

    const identity =
      chat.chatType === "customer-admin"
        ? { chatType: "customer-admin", customerId: chat.customerId }
        : { chatType: "anon-admin", anonId: chat.anonId };

    const sender = identity.chatType === "customer-admin" ? "customer" : "anonymous_customer";
    const senderId = identity.chatType === "customer-admin" ? String(identity.customerId) : identity.anonId;

    const userMsg = await ChatMessage.create({
      chatId,
      sender,
      senderId,
      messageType: messageType || "text",
      messageContent,
    });

    chat.lastMessageAt = new Date();
    await chat.save();

    const io = req.app.get("io");
    if (io) io.to(room(chatId)).emit("new_message", userMsg.toObject());

    if (identity.chatType === "anon-admin") {
      AnonChatUser.findOneAndUpdate({ anonId: identity.anonId }, { lastSeenAt: new Date() }).catch(() => {});
    }

    // Advance the bot state machine — fire-and-forget from the response's
    // perspective (bot replies stream in over the socket), but awaited
    // here so a synchronous test/poller can rely on messages existing
    // right after this call returns.
    await handleBotTurn(chatId, identity, messageContent, io);

    return res.status(201).json({ success: true, message: userMsg, chatId });
  } catch (error) {
    console.error("[customerChatController] sendMessage error:", error);
    return res.status(500).json({ success: false, message: "Failed to send message" });
  }
};

/**
 * @desc Paginated message history for a chat, oldest to newest.
 * GET /api/customer/chat/:chatId/messages?cursor=&limit=
 */
export const getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const { cursor } = req.query;

    const query = { chatId };
    if (cursor) query._id = { $lt: cursor };

    const messages = await ChatMessage.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();

    let hasMore = false;
    let nextCursor = null;
    if (messages.length > limit) {
      hasMore = true;
      nextCursor = messages[limit]._id;
      messages.pop();
    }

    return res.status(200).json({ success: true, messages: messages.reverse(), hasMore, nextCursor });
  } catch (error) {
    console.error("[customerChatController] getMessages error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch messages" });
  }
};

/**
 * @desc Current chat status for this identity (ACTIVE / FINISHED / NONE) —
 * lets the widget resume an in-progress chat on page load.
 * GET /api/customer/chat/status?anon_id=
 */
export const getChatStatus = async (req, res) => {
  try {
    const identity = await resolveChatIdentity(req, req.query || {});

    const active = await ChatSession.findOne({ chatStatus: "ACTIVE", ...toEnquiryFilter(identity) });
    if (active) {
      return res.status(200).json({ success: true, status: "ACTIVE", chatId: active.chatId, anonId: identity.anonId || null });
    }

    const finished = await ChatSession.findOne({ chatStatus: "FINISHED", ...toEnquiryFilter(identity) }).sort({ updatedAt: -1 });
    if (finished) {
      return res.status(200).json({ success: true, status: "FINISHED", chatId: finished.chatId, anonId: identity.anonId || null });
    }

    return res.status(200).json({ success: true, status: "NONE", anonId: identity.anonId || null });
  } catch (error) {
    console.error("[customerChatController] getChatStatus error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch chat status" });
  }
};

/**
 * @desc Ends the current active chat (e.g. widget "start over") and closes
 * any still-open ChatEnquiry so a later /init starts a genuinely fresh
 * conversation instead of resuming a half-finished one.
 * POST /api/customer/chat/reset
 */
export const resetChat = async (req, res) => {
  try {
    const identity = await resolveChatIdentity(req, req.body || {});

    const chat = await ChatSession.findOne({ chatStatus: "ACTIVE", ...toEnquiryFilter(identity) });
    if (!chat) {
      return res.status(404).json({ success: false, message: "No active chat found to reset" });
    }

    chat.chatStatus = "FINISHED";
    await chat.save();

    await ChatEnquiry.updateMany({ status: { $nin: ["CLOSED", "CONVERTED"] }, ...toEnquiryFilter(identity) }, { status: "CLOSED" });

    return res.status(200).json({ success: true, message: "Chat reset successfully", chatId: chat.chatId });
  } catch (error) {
    console.error("[customerChatController] resetChat error:", error);
    return res.status(500).json({ success: false, message: "Failed to reset chat" });
  }
};

/**
 * @desc Help panel hand-off — the customer's brief for an Event Manager
 * (frontend HelpBriefCard). Stored as a ChatEnquiry lead (source
 * "help_panel") and posted to the same Slack channel as chatbot leads.
 * Public: anonymous visitors can send one; a valid token links it to the
 * customer instead.
 * @route POST /api/customer/chat/help-request
 */
export const createHelpRequest = async (req, res) => {
  try {
    const identity = await resolveChatIdentity(req, req.body);
    const b = req.body;
    const ticket = await nextTicket();
    const enquiry = await ChatEnquiry.create({
      ticket,
      ...toEnquiryFilter(identity),
      source: "help_panel",
      eventType: b.occasion,
      guestCount: b.guests,
      budgetOption: "Yes",
      budgetRange: b.budget,
      servicesNeeded: [b.vendorType],
      city: b.area || null,
      eventDateRaw: b.date || null,
      replyMode: b.replyMode,
      bestTimeToCall: b.replyMode === "call-me" ? b.callTime || null : null,
      phoneNumber: b.replyMode === "call-me" ? b.phone : null,
      customerName: identity.customer?.name || null,
      pageUrl: b.pageUrl || null,
      hasReferencePhoto: Boolean(b.hasPhoto),
      // Figma 9.6: an unserved area still sends; the team checks travel.
      areaServed: b.area ? resolveArea(b.area).serviceable : null,
      transcript: b.transcript || [],
      status: b.replyMode === "call-me" ? "FLOW_COMPLETE" : "STEP_8_HANDOFF",
      createdOffHours: isOffHours(),
      // "Call me" is a call back from the start (Figma 07): one request, one
      // ref, and a promise that follows the call-time chip.
      callBack:
        b.replyMode === "call-me"
          ? {
              requestId: generateISTId("CB"),
              ticket,
              phone: b.phone,
              window: b.callTime && b.callTime !== "As soon as possible" ? b.callTime : null,
              callBy: callBackDeadline(b.callTime),
            }
          : null,
    });

    // Fire-and-forget, same as the chatbot's notifications: a Slack
    // failure must never fail the customer's request.
    notifyHelpRequest(enquiry)
      .then(() => ChatEnquiry.updateOne({ _id: enquiry._id }, { $set: { slackNotifiedAt: new Date() } }))
      .catch((err) => console.error("[createHelpRequest] Slack notify failed:", err.message));

    return res.status(201).json({
      success: true,
      enquiryId: enquiry.enquiryId,
      anonId: identity.anonId ?? null,
      request: serializeHelpRequest(enquiry, { late: false }),
    });
  } catch (error) {
    console.error("createHelpRequest error:", error);
    return res.status(500).json({ success: false, message: "Could not send your request" });
  }
};

/**
 * The caller's own help request, or null. Unlike resolveChatIdentity this
 * never mints an anon id: a request is only visible to the customer token
 * or anon_id that sent it.
 */
async function findOwnHelpRequest(req, input) {
  const customer = await resolveLoggedInCustomer(req);
  const anonId = (input.anon_id || "").toString().trim();
  if (!customer && !anonId) return null;
  return ChatEnquiry.findOne({
    enquiryId: req.params.enquiryId,
    source: "help_panel",
    ...(customer ? { customerId: customer._id } : { anonId }),
  });
}

/**
 * @desc Help panel thread after the brief: Event Manager replies, the
 * customer's own follow-ups, call back and whether it's now late (30 min,
 * no reply — flags the team lead once). Polled by the panel.
 * @route GET /api/customer/chat/help-request/:enquiryId?anon_id=
 */
export const getHelpRequest = async (req, res) => {
  try {
    const enquiry = await findOwnHelpRequest(req, req.query || {});
    if (!enquiry) return res.status(404).json({ success: false, message: "Request not found" });
    const late = await checkLate(enquiry);
    return res.json({ success: true, request: serializeHelpRequest(enquiry, { late }) });
  } catch (error) {
    console.error("getHelpRequest error:", error);
    return res.status(500).json({ success: false, message: "Could not load your request" });
  }
};

/**
 * @desc Customer writes again in the help thread; the team sees it on Slack.
 * @route POST /api/customer/chat/help-request/:enquiryId/messages
 */
export const postHelpRequestMessage = async (req, res) => {
  try {
    const enquiry = await findOwnHelpRequest(req, req.body);
    if (!enquiry) return res.status(404).json({ success: false, message: "Request not found" });
    const message = { messageId: generateISTId("HMSG"), from: "customer", text: req.body.text, sentAt: new Date() };
    await ChatEnquiry.updateOne({ _id: enquiry._id }, { $push: { helpMessages: message } });
    notifyHelpMessage(enquiry, message.text).catch((err) =>
      console.error("[postHelpRequestMessage] Slack notify failed:", err.message)
    );
    return res.status(201).json({ success: true, message });
  } catch (error) {
    console.error("postHelpRequestMessage error:", error);
    return res.status(500).json({ success: false, message: "Could not send your message" });
  }
};

/**
 * @desc "Get a call back" from the status card: within 30 min in hours,
 * 9:30 AM IST otherwise. One call back per request — asking again returns
 * the existing one.
 * @route POST /api/customer/chat/help-request/:enquiryId/call-back
 */
export const requestHelpCallBack = async (req, res) => {
  try {
    const enquiry = await findOwnHelpRequest(req, req.body);
    if (!enquiry) return res.status(404).json({ success: false, message: "Request not found" });
    if (!enquiry.callBack) {
      enquiry.callBack = {
        requestId: generateISTId("CB"),
        ticket: await nextTicket(),
        phone: req.body.phone,
        callBy: callBackDeadline(),
      };
      if (!enquiry.phoneNumber) enquiry.phoneNumber = req.body.phone;
      await enquiry.save();
      notifyHelpCallBack(enquiry).catch((err) =>
        console.error("[requestHelpCallBack] Slack notify failed:", err.message)
      );
    }
    return res.status(201).json({ success: true, request: serializeHelpRequest(enquiry, { late: false }) });
  } catch (error) {
    console.error("requestHelpCallBack error:", error);
    return res.status(500).json({ success: false, message: "Could not request a call back" });
  }
};

/**
 * @desc Help panel location step (Figma "09"): served, not served (with the
 * closest areas we cover), or ambiguous ("Sector 15" — which city?).
 * Public; no identity needed.
 * @route GET /api/customer/chat/area-check?area=
 */
export const checkHelpArea = async (req, res) => {
  try {
    const area = await lookupArea(req.query.area);
    return res.json({ success: true, area });
  } catch (error) {
    console.error("checkHelpArea error:", error);
    return res.status(500).json({ success: false, message: "Could not check that area" });
  }
};

/**
 * @desc "Notify me when Eventory begins serving {area}" — stores the lead
 * (one per phone + area; repeats refresh it) and posts it to Slack.
 * @route POST /api/customer/chat/area-waitlist
 */
export const joinAreaWaitlist = async (req, res) => {
  try {
    const identity = await resolveChatIdentity(req, req.body);
    const b = req.body;
    const phone = b.phone.replace(/\D/g, "").slice(-10);
    const area = resolveArea(b.area);
    const entry = await AreaWaitlist.findOneAndUpdate(
      { phone, areaKey: b.area.trim().toLowerCase() },
      {
        $set: {
          area: b.area.trim(),
          pincode: area.pincode,
          areaSource: b.areaSource || "typed",
          consent: true,
          customerId: identity.customerId ?? null,
          anonId: identity.anonId ?? null,
          // Only what this request says — a repeat sign-up never wipes
          // the plan an earlier one recorded.
          ...Object.fromEntries(
            Object.entries({
              customerName: identity.customer?.name,
              occasion: b.occasion,
              guests: b.guests,
              budget: b.budget,
              requestText: b.requestText,
              pageUrl: b.pageUrl,
            }).filter(([, v]) => v)
          ),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    notifyAreaWaitlist(entry).catch((err) => console.error("[joinAreaWaitlist] Slack notify failed:", err.message));
    return res.status(201).json({ success: true, anonId: identity.anonId ?? null });
  } catch (error) {
    console.error("joinAreaWaitlist error:", error);
    return res.status(500).json({ success: false, message: "Could not save that" });
  }
};
