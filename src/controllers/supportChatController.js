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
import { resolveVendorRefId } from "../utils/resolveVendor.js";

/**
 * Vendor side of the Help & Support chat (vendor app → Package Setup → Help).
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

/**
 * @desc Open Help on a step: the vendor's unresolved chat for that package
 * and step, or a new one. Messages are returned once the chat has left the
 * automated stage, so the app can redraw it.
 * @route POST /api/support/chats
 */
export const openSupportChat = async (req, res) => {
  try {
    const vendorId = req.authVendorId;
    const { topic } = req.body;
    const step = topic === "package_setup" ? req.body.step : null;
    const packageId = req.body.packageId ?? null;
    const bookingId = topic === "booking" ? req.body.bookingId : null;

    if (packageId && !(await packageBelongsTo(packageId, vendorId))) {
      return fail(res, 403, "You are not authorized to access this resource");
    }
    if (bookingId && !(await bookingBelongsTo(bookingId, vendorId))) {
      return fail(res, 403, "You are not authorized to access this resource");
    }

    let chat = await SupportChat.findOne({
      vendorId,
      topic,
      packageId,
      step,
      bookingId,
      status: { $ne: "resolved" },
    }).sort({ createdAt: -1 });
    const created = !chat;
    if (created) chat = await SupportChat.create({ chatId: newChatId(), vendorId, topic, packageId, step, bookingId });

    const messages = chat.status === "automated" ? [] : await listMessages(chat.chatId);
    return res.status(created ? 201 : 200).json({ success: true, data: { chat: serializeChat(chat), messages } });
  } catch (error) {
    console.error("openSupportChat error:", error);
    return fail(res, 500, "Could not open the chat");
  }
};

/**
 * @desc "Something else": the chat gets a ticket number and waits for an EM.
 * Repeating the call after it succeeded returns the same ticket.
 * @route POST /api/support/chats/:chatId/handover
 */
export const handoverSupportChat = async (req, res) => {
  try {
    const chat = await ownChat(req, res);
    if (!chat) return;
    if (chat.ticketNumber) return res.json({ success: true, data: { chat: serializeChat(chat) } });
    if (chat.status !== "automated") return fail(res, 409, "This chat can no longer be handed over");

    const ticketNumber = await nextTicketNumber();
    const updated = await SupportChat.findOneAndUpdate(
      { _id: chat._id, status: "automated" },
      {
        $set: {
          status: "waiting_for_em",
          ticketNumber,
          handedOverAt: new Date(),
          transcript: req.body.transcript,
        },
      },
      { returnDocument: "after" }
    );
    if (!updated) {
      const current = await SupportChat.findById(chat._id);
      if (current?.ticketNumber) return res.json({ success: true, data: { chat: serializeChat(current) } });
      return fail(res, 409, "This chat can no longer be handed over");
    }

    await addMessage(updated.chatId, {
      sender: "system",
      event: "ticket_opened",
      text: `Ticket #${ticketNumber} opened`,
    });
    emitToQueue(req, "chat:waiting", serializeChat(updated));
    return res.json({ success: true, data: { chat: serializeChat(updated) } });
  } catch (error) {
    console.error("handoverSupportChat error:", error);
    return fail(res, 500, "Could not open a ticket");
  }
};

/**
 * @desc "Not quite, call me": the admin panel lists the chat so an EM calls.
 * @route POST /api/support/chats/:chatId/call-request
 */
export const requestSupportCall = async (req, res) => {
  try {
    const chat = await ownChat(req, res);
    if (!chat) return;
    if (chat.status === "call_requested") return res.json({ success: true, data: { chat: serializeChat(chat) } });

    const updated = await SupportChat.findOneAndUpdate(
      { _id: chat._id, status: "automated" },
      { $set: { status: "call_requested", callRequestedAt: new Date(), transcript: req.body.transcript } },
      { returnDocument: "after" }
    );
    if (!updated) return fail(res, 409, "A call can't be requested on this chat");
    return res.json({ success: true, data: { chat: serializeChat(updated) } });
  } catch (error) {
    console.error("requestSupportCall error:", error);
    return fail(res, 500, "Could not request a call");
  }
};

/**
 * @desc "Yes, that helps" during the automated stage.
 * @route POST /api/support/chats/:chatId/resolve
 */
export const resolveSupportChatByVendor = async (req, res) => {
  try {
    const chat = await ownChat(req, res);
    if (!chat) return;
    if (chat.status === "resolved") return res.json({ success: true, data: { chat: serializeChat(chat) } });

    const updated = await SupportChat.findOneAndUpdate(
      { _id: chat._id, status: "automated" },
      {
        $set: {
          status: "resolved",
          resolvedAt: new Date(),
          resolvedBy: "vendor",
          transcript: req.body.transcript,
        },
      },
      { returnDocument: "after" }
    );
    if (!updated) return fail(res, 409, "This chat can't be resolved from the app");

    await addMessage(updated.chatId, { sender: "system", event: "resolved", text: "Marked as resolved" });
    return res.json({ success: true, data: { chat: serializeChat(updated) } });
  } catch (error) {
    console.error("resolveSupportChatByVendor error:", error);
    return fail(res, 500, "Could not close the chat");
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
