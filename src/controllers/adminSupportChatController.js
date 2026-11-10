import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Package from "../models/Package.js";
import SupportChat from "../models/SupportChat.js";
import Vendor from "../models/Vendor.js";
import {
  addMessage,
  emitToChat,
  listMessages,
  serializeChat,
  serializeMessage,
} from "../services/supportChatService.js";

/**
 * Event Manager side of the vendor Help & Support chat, used by the admin
 * panel. Same access model as the other /api/admin routers; the EM says who
 * they are with emId / emName in each request, like the help-request replies.
 */

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const findChat = async (req, res) => {
  const chat = await SupportChat.findOne({ chatId: req.params.chatId });
  if (!chat) fail(res, 404, "Chat not found");
  return chat;
};

const vendorsById = async (vendorIds) => {
  const vendors = await Vendor.find({ id: { $in: [...new Set(vendorIds)] } })
    .select("id businessName pocName phone pocPhone")
    .lean();
  return new Map(
    vendors.map((v) => [
      v.id,
      { vendorId: v.id, businessName: v.businessName ?? null, name: v.pocName ?? null, phone: v.phone ?? v.pocPhone ?? null },
    ])
  );
};

const packagesById = async (packageIds) => {
  const ids = [...new Set(packageIds.filter((id) => id && mongoose.isValidObjectId(id)))];
  if (!ids.length) return new Map();
  const packages = await Package.find({ _id: { $in: ids } })
    .select("step1_eventAndCrew.packageName vendorType")
    .lean();
  return new Map(
    packages.map((p) => [
      String(p._id),
      { packageId: String(p._id), packageName: p.step1_eventAndCrew?.packageName ?? null, vendorType: p.vendorType ?? null },
    ])
  );
};

const bookingsById = async (bookingIds) => {
  const ids = [...new Set(bookingIds.filter((id) => id && mongoose.isValidObjectId(id)))];
  if (!ids.length) return new Map();
  const bookings = await Booking.find({ _id: { $in: ids } })
    .select("bookingId status eventType eventDate customer.name")
    .lean();
  return new Map(
    bookings.map((b) => [
      String(b._id),
      {
        bookingId: String(b._id),
        bookingNumber: b.bookingId,
        status: b.status ?? null,
        eventType: b.eventType ?? null,
        eventDate: b.eventDate ?? null,
        customerName: b.customer?.name ?? null,
      },
    ])
  );
};

/**
 * @desc Chats for the admin panel, newest activity first. Filter by status
 * (e.g. waiting_for_em, call_requested), ticket number or EM.
 * @route GET /api/admin/support-chats
 */
export const listSupportChats = async (req, res) => {
  try {
    const { status, topic, ticket, emId, page, limit } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (topic) filter.topic = topic;
    if (ticket) filter.ticketNumber = ticket.toUpperCase();
    if (emId) filter.emId = emId;

    const [chats, total] = await Promise.all([
      SupportChat.find(filter)
        .select("-transcript")
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      SupportChat.countDocuments(filter),
    ]);
    const [vendors, packages, bookings] = await Promise.all([
      vendorsById(chats.map((c) => c.vendorId)),
      packagesById(chats.map((c) => c.packageId)),
      bookingsById(chats.map((c) => c.bookingId)),
    ]);

    return res.json({
      success: true,
      data: {
        chats: chats.map((c) => ({
          ...serializeChat(c),
          vendor: vendors.get(c.vendorId) ?? null,
          package: packages.get(c.packageId) ?? null,
          booking: bookings.get(c.bookingId) ?? null,
        })),
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("listSupportChats error:", error);
    return fail(res, 500, "Could not load chats");
  }
};

/**
 * @desc One chat with the vendor, package or booking, quick-reply transcript and messages.
 * @route GET /api/admin/support-chats/:chatId
 */
export const getSupportChat = async (req, res) => {
  try {
    const chat = await findChat(req, res);
    if (!chat) return;
    const [vendors, packages, bookings, messages] = await Promise.all([
      vendorsById([chat.vendorId]),
      packagesById([chat.packageId]),
      bookingsById([chat.bookingId]),
      listMessages(chat.chatId),
    ]);
    return res.json({
      success: true,
      data: {
        chat: serializeChat(chat),
        vendor: vendors.get(chat.vendorId) ?? null,
        package: packages.get(chat.packageId) ?? null,
        booking: bookings.get(chat.bookingId) ?? null,
        messages,
      },
    });
  } catch (error) {
    console.error("getSupportChat error:", error);
    return fail(res, 500, "Could not load the chat");
  }
};

/**
 * @desc An EM joins a chat waiting for one. The vendor's text box opens.
 * @route POST /api/admin/support-chats/:chatId/join
 */
export const joinSupportChat = async (req, res) => {
  try {
    const chat = await findChat(req, res);
    if (!chat) return;
    const emId = req.body.emId ?? null;
    const { emName } = req.body;

    const updated = await SupportChat.findOneAndUpdate(
      { _id: chat._id, status: "waiting_for_em" },
      { $set: { status: "with_em", emId, emName } },
      { returnDocument: "after" }
    );
    if (!updated) {
      const current = await SupportChat.findById(chat._id);
      const sameEm = current?.status === "with_em" && (emId ? current.emId === emId : current.emName === emName);
      if (sameEm) return res.json({ success: true, data: { chat: serializeChat(current) } });
      if (current?.status === "with_em") return fail(res, 409, `${current.emName} has already joined this chat`);
      return fail(res, 409, "This chat is not waiting for an Event Manager");
    }

    const joined = serializeMessage(
      await addMessage(updated.chatId, {
        sender: "system",
        event: "em_joined",
        senderId: emId,
        senderName: emName,
        text: `${emName} joined the chat`,
      })
    );
    emitToChat(req, updated.chatId, "message:new", joined);
    emitToChat(req, updated.chatId, "chat:em_joined", { chatId: updated.chatId, emId, emName });
    return res.json({ success: true, data: { chat: serializeChat(updated), message: joined } });
  } catch (error) {
    console.error("joinSupportChat error:", error);
    return fail(res, 500, "Could not join the chat");
  }
};

/**
 * @route POST /api/admin/support-chats/:chatId/messages
 */
export const sendEmSupportMessage = async (req, res) => {
  try {
    const chat = await findChat(req, res);
    if (!chat) return;
    if (chat.status !== "with_em") return fail(res, 409, "Join the chat before replying");

    const saved = serializeMessage(
      await addMessage(chat.chatId, {
        sender: "em",
        senderId: req.body.emId ?? null,
        senderName: req.body.emName,
        text: req.body.text,
        imageUrls: req.body.imageUrls,
      })
    );
    await SupportChat.updateOne({ _id: chat._id }, { $set: { updatedAt: new Date() } });
    emitToChat(req, chat.chatId, "message:new", saved);
    return res.status(201).json({ success: true, data: { message: saved } });
  } catch (error) {
    console.error("sendEmSupportMessage error:", error);
    return fail(res, 500, "Message not sent");
  }
};

/**
 * @desc Close a chat — after chatting, or after making a requested call.
 * @route POST /api/admin/support-chats/:chatId/resolve
 */
export const resolveSupportChatByEm = async (req, res) => {
  try {
    const chat = await findChat(req, res);
    if (!chat) return;
    if (chat.status === "resolved") return res.json({ success: true, data: { chat: serializeChat(chat) } });

    const updated = await SupportChat.findOneAndUpdate(
      { _id: chat._id, status: { $ne: "resolved" } },
      {
        $set: {
          status: "resolved",
          resolvedAt: new Date(),
          resolvedBy: req.body.emId || req.body.emName || "em",
        },
      },
      { returnDocument: "after" }
    );
    if (!updated) return res.json({ success: true, data: { chat: serializeChat(await SupportChat.findById(chat._id)) } });

    const resolved = serializeMessage(
      await addMessage(updated.chatId, { sender: "system", event: "resolved", text: "Marked as resolved" })
    );
    emitToChat(req, updated.chatId, "message:new", resolved);
    emitToChat(req, updated.chatId, "chat:resolved", { chatId: updated.chatId });
    return res.json({ success: true, data: { chat: serializeChat(updated) } });
  } catch (error) {
    console.error("resolveSupportChatByEm error:", error);
    return fail(res, 500, "Could not close the chat");
  }
};
