import mongoose from "mongoose";

/**
 * Help panel conversation (frontend customer-help), saved so the panel's
 * "Your chats" tab can list it and a reload resumes it. The assistant is
 * rule-based and runs in the browser, so the thread is stored as the
 * panel's own items (messages, chips, package cards, status cards) and
 * replayed as-is. Linked to the Event Manager request once a brief is
 * sent (ChatEnquiry, by enquiryId). Own collection, same anon-XOR-customer
 * ownership as ChatSession.
 */
const HelpConversationSchema = new mongoose.Schema(
  {
    // Made by the panel (a UUID) so it can save before any reply.
    conversationId: { type: String, unique: true, required: true },
    anonId: { type: String, default: null },
    customerId: { type: String, ref: "Customer", default: null },

    // First thing the customer asked; the chats list's row title.
    title: { type: String, default: null },
    // Last message in the thread, for the row's second line.
    preview: { type: String, default: null },
    items: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // Where the assistant was in the flow (what it understood so far).
    state: { type: mongoose.Schema.Types.Mixed, default: null },

    enquiryId: { type: String, default: null },
    ticket: { type: String, default: null },
    lastMessageAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "customer_help_conversations",
    minimize: false,
  }
);

HelpConversationSchema.index({ customerId: 1, lastMessageAt: -1 });
HelpConversationSchema.index({ anonId: 1, lastMessageAt: -1 });
HelpConversationSchema.index({ enquiryId: 1 }, { sparse: true });

export default mongoose.model("HelpConversation", HelpConversationSchema);
