import mongoose from "mongoose";

/**
 * One message in a SupportChat, from the vendor, the Event Manager, or the
 * system ("Ticket #TKT-1001 opened", "Riya joined the chat", "Marked as
 * resolved"). System lines carry an `event` so clients can tell them apart
 * without matching on text.
 */
export const SUPPORT_MESSAGE_SENDERS = ["vendor", "em", "system"];
export const SUPPORT_SYSTEM_EVENTS = ["ticket_opened", "call_requested", "em_joined", "resolved"];

const SupportMessageSchema = new mongoose.Schema(
  {
    messageId: { type: String, unique: true, required: true },
    chatId: { type: String, required: true },
    sender: { type: String, enum: SUPPORT_MESSAGE_SENDERS, required: true },
    senderId: { type: String, default: null },
    senderName: { type: String, default: null },
    text: { type: String, default: "" },
    imageUrls: { type: [String], default: [] },
    event: { type: String, enum: SUPPORT_SYSTEM_EVENTS, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "support_messages",
  }
);

SupportMessageSchema.index({ chatId: 1, createdAt: 1 });

export default mongoose.model("SupportMessage", SupportMessageSchema);
