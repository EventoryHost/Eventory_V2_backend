import mongoose from "mongoose";

/**
 * Every message in a help panel chat, one document each — the customer's,
 * the assistant's, the Event Manager's and the panel's system lines — so
 * the Event Manager side can read any chat, ticket or customer straight
 * from the database. HelpConversation keeps the panel's own replayable
 * thread; this is the record.
 *
 * Ids:
 *  - messageId      — this message ("HMSG…"), unique.
 *  - conversationId — the chat it's in (HelpConversation).
 *  - enquiryId / ticket — the help ticket it belongs to (ChatEnquiry), set
 *    once the chat has one. A ticket never leaves its chat: Event Manager
 *    replies land in the same conversationId.
 *  - customerId / anonId — who the chat belongs to (claimed on sign-in).
 */
export const HELP_MESSAGE_ROLES = ["customer", "assistant", "event_manager", "system"];

const HelpMessageSchema = new mongoose.Schema(
  {
    messageId: { type: String, unique: true, required: true },
    // The panel's own item id (a UUID), so re-saving the thread never
    // stores a message twice. Event Manager replies use their messageId.
    clientId: { type: String, required: true },
    conversationId: { type: String, default: null },
    enquiryId: { type: String, default: null },
    ticket: { type: String, default: null },

    customerId: { type: String, ref: "Customer", default: null },
    anonId: { type: String, default: null },

    role: { type: String, enum: HELP_MESSAGE_ROLES, required: true },
    // Event Manager's name (or id, once that side has accounts).
    senderId: { type: String, default: null },
    senderName: { type: String, default: null },
    text: { type: String, required: true },
    hasPhoto: { type: Boolean, default: false },
    tone: { type: String, default: null },

    // How it arrived: copied from the panel's saved thread, sent into the
    // ticket by the customer, or replied by the Event Manager team.
    via: { type: String, enum: ["transcript", "help_request", "admin"], required: true },
    sentAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "customer_help_messages",
  }
);

HelpMessageSchema.index({ conversationId: 1, clientId: 1 }, { unique: true });
HelpMessageSchema.index({ conversationId: 1, sentAt: 1 });
HelpMessageSchema.index({ enquiryId: 1, sentAt: 1 });
HelpMessageSchema.index({ customerId: 1, sentAt: -1 });
HelpMessageSchema.index({ anonId: 1, sentAt: -1 });

export default mongoose.model("HelpMessage", HelpMessageSchema);
