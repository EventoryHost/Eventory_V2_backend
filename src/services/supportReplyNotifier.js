import VendorNotification from "../models/VendorNotification.js";
import { chatRoom } from "./supportChatService.js";
import { notifyVendor } from "./vendorNotificationService.js";

/**
 * "Your Event Manager replied" for the vendor app: an inbox row (and a push)
 * when an Event Manager writes in a vendor's Help & Support chat while the
 * vendor isn't looking at it. Tapping it opens that chat.
 */

const TYPE = "support.emReplied";

const TOPIC_LABELS = {
  package_setup: "Package setup",
  publish_package: "Publishing",
  booking: "Booking",
  business_profile: "Business profile",
  personal_documents: "Personal documents",
};

const preview = (text, imageUrls) => {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (t) return t.length > 140 ? `${t.slice(0, 139)}…` : t;
  return imageUrls?.length ? "Sent a photo." : null;
};

/** Whether the vendor has this chat open right now (their socket is in its room). */
export async function vendorIsWatching(io, chatId) {
  if (!io) return false;
  try {
    const sockets = await io.in(chatRoom(chatId)).fetchSockets();
    return sockets.some((s) => s.data?.supportVendorId);
  } catch {
    return false;
  }
}

/**
 * After an Event Manager's message. Never throws: the reply itself has
 * already been sent.
 */
export async function notifyVendorOfEmReply(io, chat, message) {
  try {
    if (!chat?.vendorId || (await vendorIsWatching(io, chat.chatId))) return null;
    // Already told and not read yet: one row per chat, no repeat pushes.
    const unread = await VendorNotification.exists({
      vendorId: String(chat.vendorId),
      type: TYPE,
      "target.id": chat.chatId,
      readAt: null,
    });
    if (unread) return null;
    const label = TOPIC_LABELS[chat.topic] || "Help & Support";
    return await notifyVendor(TYPE, {
      vendorId: chat.vendorId,
      chatId: chat.chatId,
      emName: message?.senderName || chat.emName,
      replyPreview: preview(message?.text, message?.imageUrls),
      serviceLabel: chat.ticketNumber ? `${label} · Ticket #${chat.ticketNumber}` : label,
    });
  } catch (error) {
    console.error("[supportReplyNotifier] failed:", error.message);
    return null;
  }
}

/** The vendor opened the chat: its "replied" rows are read. Never throws. */
export async function markSupportRepliesRead(vendorId, chatId) {
  try {
    if (!vendorId || !chatId) return;
    await VendorNotification.updateMany(
      { vendorId: String(vendorId), type: TYPE, "target.id": chatId, readAt: null },
      { $set: { readAt: new Date() } }
    );
  } catch (error) {
    console.error("[supportReplyNotifier] mark read failed:", error.message);
  }
}
