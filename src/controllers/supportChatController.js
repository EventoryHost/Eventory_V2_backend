import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Package from "../models/Package.js";
import SupportChat from "../models/SupportChat.js";
import {
  addMessage,
  emitToChat,
  emitToQueue,
  listMessages,
  newChatId,
  nextTicketNumber,
  serializeChat,
  serializeMessage,
} from "../services/supportChatService.js";
import { OPTION_IDS, OUTCOMES, selectOption, startFlow } from "../services/supportFlows/supportFlowEngine.js";
import { resolveVendorRefId } from "../utils/resolveVendor.js";

/**
 * Vendor side of the Help & Support chat (vendor app → Help on a package step,
 * the publish screen or a booking).
 * Every route runs behind requireVendorIdentity, so req.authVendorId is the
 * calling vendor and a chat is only ever looked up together with it.
 */

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const ownChat = async (req, res) => {
  const chat = await SupportChat.findOne({ chatId: req.params.chatId, vendorId: req.authVendorId });
  if (!chat) fail(res, 404, "Chat not found");
  return chat;
};

const packageBelongsTo = async (packageId, vendorId) => {
  if (!mongoose.isValidObjectId(packageId)) return true;
  const pkg = await Package.findById(packageId).select("vendorId").lean();
  if (!pkg) return true;
  const owner = (await resolveVendorRefId(pkg.vendorId)) || String(pkg.vendorId);
  return owner === vendorId;
};

const bookingBelongsTo = async (bookingId, vendorId) => {
  if (!mongoose.isValidObjectId(bookingId)) return false;
  const booking = await Booking.findById(bookingId).select("vendorId").lean();
  if (!booking) return false;
  const owner = (await resolveVendorRefId(booking.vendorId)) || String(booking.vendorId);
  return owner === vendorId;
};

const freshFlow = (chat, now) => {
  const { lines, options } = startFlow(chat);
  return { transcript: lines.map((line) => ({ ...line, at: now })), options };
};

/**
 * @desc Open Help on a step, the publish screen or a booking: the vendor's
 * unresolved chat for it, or a new one. A chat still in the quick-reply stage
 * starts its flow again from the top.
 * @route POST /api/support/chats
 */
export const openSupportChat = async (req, res) => {
  try {
    const vendorId = req.authVendorId;
    const { topic, context } = req.body;
    const step = topic === "package_setup" ? req.body.step : null;
    const packageId = req.body.packageId ?? null;
    const bookingId = topic === "booking" ? req.body.bookingId : null;

    if (packageId && !(await packageBelongsTo(packageId, vendorId))) {
      return fail(res, 403, "You are not authorized to access this resource");
    }
    if (bookingId && !(await bookingBelongsTo(bookingId, vendorId))) {
      return fail(res, 403, "You are not authorized to access this resource");
    }

    const found = await SupportChat.findOne({
      vendorId,
      topic,
      packageId,
      step,
      bookingId,
      status: { $ne: "resolved" },
    }).sort({ createdAt: -1 });

    if (found && found.status !== "automated") {
      return res.json({
        success: true,
        data: { chat: serializeChat(found), messages: await listMessages(found.chatId) },
      });
    }

    const now = new Date();
    const fields = { topic, packageId, step, bookingId, context };
    const chat = found
      ? await SupportChat.findOneAndUpdate(
          { _id: found._id, status: "automated" },
          { $set: { context, ...freshFlow(fields, now) } },
          { returnDocument: "after" }
        )
      : await SupportChat.create({ chatId: newChatId(), vendorId, ...fields, ...freshFlow(fields, now) });
    if (!chat) return fail(res, 409, "This chat changed. Open Help again.");

    return res.status(found ? 200 : 201).json({ success: true, data: { chat: serializeChat(chat), messages: [] } });
  } catch (error) {
    console.error("openSupportChat error:", error);
    return fail(res, 500, "Could not open the chat");
  }
};

const OUTCOME_UPDATES = {
  [OUTCOMES.continue]: () => ({}),
  [OUTCOMES.resolved]: (now) => ({ status: "resolved", resolvedAt: now, resolvedBy: "vendor" }),
  [OUTCOMES.callRequested]: (now) => ({ status: "call_requested", callRequestedAt: now }),
  [OUTCOMES.ticket]: (now, ticketNumber) => ({ status: "waiting_for_em", ticketNumber, handedOverAt: now }),
};

const OUTCOME_EVENTS = {
  [OUTCOMES.resolved]: () => ({ event: "resolved", text: "Marked as resolved" }),
  [OUTCOMES.callRequested]: () => ({ event: "call_requested", text: "Support will call you" }),
  [OUTCOMES.ticket]: (ticketNumber) => ({ event: "ticket_opened", text: `Ticket #${ticketNumber} opened` }),
};

/**
 * @desc The vendor tapped a quick reply. The server runs the flow, saves the
 * reply and the bot's answer, and returns the chat with the next options.
 * "Something else" opens a ticket, "Not quite, call me" asks for a call and
 * "Yes, that helps" / "End Chat" close the chat.
 * @route POST /api/support/chats/:chatId/select
 */
export const selectSupportOption = async (req, res) => {
  try {
    const chat = await ownChat(req, res);
    if (!chat) return;
    const { optionId } = req.body;
    if (chat.status !== "automated") return fail(res, 409, "This chat has moved on. Open Help again.");
    if (!chat.options.some((o) => o.id === optionId)) return fail(res, 409, "That reply isn't available any more");

    const ticketNumber = optionId === OPTION_IDS.ticket ? await nextTicketNumber() : null;
    const step = selectOption(chat, optionId, { ticketNumber });
    if (!step) return fail(res, 409, "That reply isn't available any more");

    const now = new Date();
    const updated = await SupportChat.findOneAndUpdate(
      { _id: chat._id, status: "automated", transcript: { $size: chat.transcript.length } },
      {
        $set: { options: step.options, ...OUTCOME_UPDATES[step.outcome](now, ticketNumber) },
        $push: { transcript: { $each: step.lines.map((line) => ({ ...line, at: now })) } },
      },
      { returnDocument: "after" }
    );
    if (!updated) return fail(res, 409, "This chat changed. Open Help again.");

    const event = OUTCOME_EVENTS[step.outcome]?.(ticketNumber);
    if (event) await addMessage(updated.chatId, { sender: "system", ...event });
    if (step.outcome === OUTCOMES.ticket) emitToQueue(req, "chat:waiting", serializeChat(updated));

    const messages = updated.status === "automated" ? [] : await listMessages(updated.chatId);
    return res.json({ success: true, data: { chat: serializeChat(updated), messages } });
  } catch (error) {
    console.error("selectSupportOption error:", error);
    return fail(res, 500, "Could not send your reply");
  }
};

/**
 * @route GET /api/support/chats/:chatId/messages
 */
export const getSupportChatMessages = async (req, res) => {
  try {
    const chat = await ownChat(req, res);
    if (!chat) return;
    return res.json({ success: true, data: { chat: serializeChat(chat), messages: await listMessages(chat.chatId) } });
  } catch (error) {
    console.error("getSupportChatMessages error:", error);
    return fail(res, 500, "Could not load the chat");
  }
};

/**
 * @desc A vendor message. Only once an EM has joined.
 * @route POST /api/support/chats/:chatId/messages
 */
export const sendVendorSupportMessage = async (req, res) => {
  try {
    const chat = await ownChat(req, res);
    if (!chat) return;
    if (chat.status !== "with_em") return fail(res, 409, "You can message once a support specialist joins");

    const saved = serializeMessage(
      await addMessage(chat.chatId, {
        sender: "vendor",
        senderId: chat.vendorId,
        text: req.body.text,
        imageUrls: req.body.imageUrls,
      })
    );
    await SupportChat.updateOne({ _id: chat._id }, { $set: { updatedAt: new Date() } });
    emitToChat(req, chat.chatId, "message:new", saved);
    return res.status(201).json({ success: true, data: { message: saved } });
  } catch (error) {
    console.error("sendVendorSupportMessage error:", error);
    return fail(res, 500, "Message not sent");
  }
};
