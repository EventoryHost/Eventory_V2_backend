import mongoose from "mongoose";
import { generateISTId } from "../utils/idGenerator.js";

/**
 * Anonymous Chat / lead-gen chatbot — one ChatSession per browser widget
 * conversation. Simplified from V1's chats.js (chat2 collection): no
 * vendor-admin/vendor-enquiry chat types (out of scope — vendor-side chat
 * is untouched, per the standing rule not to interfere with it), no
 * pinned_chat_messages/em_id (no EM/Admin inbox exists in this codebase to
 * assign a chat to — see info.txt PART 5 Flag #2, still open), no
 * anon->customer room-migration bookkeeping (this build uses one plain
 * socket room per chatId — see src/config/socket.js — not V1's dual-cast
 * room-per-chat-type scheme, so there's nothing to migrate).
 */
const ChatSessionSchema = new mongoose.Schema(
  {
    chatId: { type: String, unique: true, required: true, default: () => generateISTId("CHAT") },

    // Exactly one of these is set, matching which identity started the
    // chat — mirrors the same anon-XOR-customer pattern already used by
    // Booking.customerId/Cart guestId elsewhere in this codebase.
    anonId: { type: String, default: null, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null, index: true },

    chatType: { type: String, enum: ["anon-admin", "customer-admin"], required: true },
    chatStatus: { type: String, enum: ["ACTIVE", "FINISHED"], default: "ACTIVE" },

    // Where the chat was opened from (e.g. "homepage_widget", "shared_link")
    // — informational only, not read by any logic yet.
    source: { type: String, default: null },

    // Guards the one-time auto-greeting (see chatBotEngine.js) so a page
    // refresh / reconnect never re-sends "Hey there!" a second time.
    isAutoInitialised: { type: Boolean, default: false },

    lastMessageAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "customer_chat_sessions",
  }
);

ChatSessionSchema.index({ anonId: 1, chatStatus: 1 });
ChatSessionSchema.index({ customerId: 1, chatStatus: 1 });

export default mongoose.model("ChatSession", ChatSessionSchema);
