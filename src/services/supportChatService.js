import crypto from "crypto";
import mongoose from "mongoose";
import SupportMessage from "../models/SupportMessage.js";
import { generateISTId } from "../utils/idGenerator.js";

/**
 * Shared pieces of the vendor ↔ Event Manager support chat, used by the
 * vendor routes (/api/support/chats), the EM routes
 * (/api/admin/support-chats) and the socket layer.
 *
 * Socket rooms and events (see config/socket.js for joining):
 *   support:<chatId>   — the vendor who owns the chat + any EM viewing it
 *     message:new      — a message from either side or the system
 *     chat:em_joined   — an EM joined; the vendor's text box can open
 *     chat:resolved    — the chat was closed
 *   support:queue      — every EM in the admin panel
 *     chat:waiting     — a chat was handed over and needs an EM
 */
export const chatRoom = (chatId) => `support:${chatId}`;
export const QUEUE_ROOM = "support:queue";

const randomSuffix = () => crypto.randomBytes(3).toString("hex");
export const newChatId = () => `${generateISTId("SC")}-${randomSuffix()}`;
const newMessageId = () => `${generateISTId("SM")}-${randomSuffix()}`;

/** "TKT-1001", "TKT-1002"… from this system's own counter. */
export async function nextTicketNumber() {
  const doc = await mongoose.connection
    .collection("support_counters")
    .findOneAndUpdate({ _id: "ticket" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return `TKT-${1000 + (doc?.seq ?? doc?.value?.seq ?? 0)}`;
}

export const serializeMessage = (m) => ({
  messageId: m.messageId,
  chatId: m.chatId,
  sender: m.sender,
  senderId: m.senderId ?? null,
  senderName: m.senderName ?? null,
  text: m.text ?? "",
  imageUrls: m.imageUrls ?? [],
  event: m.event ?? null,
  createdAt: m.createdAt,
});

export const serializeChat = (c) => ({
  chatId: c.chatId,
  vendorId: c.vendorId,
  topic: c.topic ?? "package_setup",
  packageId: c.packageId ?? null,
  step: c.step ?? null,
  bookingId: c.bookingId ?? null,
  status: c.status,
  ticketNumber: c.ticketNumber ?? null,
  emId: c.emId ?? null,
  emName: c.emName ?? null,
  transcript: (c.transcript ?? []).map(({ from, text, at }) => ({ from, text, at })),
  options: (c.options ?? []).map(({ id, label }) => ({ id, label })),
  context: c.context ?? {},
  handedOverAt: c.handedOverAt ?? null,
  callRequestedAt: c.callRequestedAt ?? null,
  resolvedAt: c.resolvedAt ?? null,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

export async function addMessage(
  chatId,
  { sender, text = "", imageUrls = [], senderId = null, senderName = null, event = null }
) {
  return SupportMessage.create({
    messageId: newMessageId(),
    chatId,
    sender,
    senderId,
    senderName,
    text,
    imageUrls,
    event,
  });
}

export async function listMessages(chatId) {
  const messages = await SupportMessage.find({ chatId }).sort({ createdAt: 1, _id: 1 }).lean();
  return messages.map(serializeMessage);
}

const io = (req) => req.app.get("io");

export function emitToChat(req, chatId, event, payload) {
  io(req)?.to(chatRoom(chatId)).emit(event, payload);
}

export function emitToQueue(req, event, payload) {
  io(req)?.to(QUEUE_ROOM).emit(event, payload);
}
