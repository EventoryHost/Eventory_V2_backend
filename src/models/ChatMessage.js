import mongoose from "mongoose";

/**
 * Anonymous Chat / lead-gen chatbot — one document per message. message_type
 * values match the client's own spec exactly (text/options/date_picker/
 * multi_select), since that's the literal contract the (not-yet-built) v2
 * frontend's MessageBubble.tsx will switch on — see info.txt for the full
 * writeup on which parts of this feature were scoped down and why.
 *
 * Simplified from V1's message2.js: no image/video/pdf/file/vendor_card/
 * order_summary/login_prompt/review_prompt message types, no card_data/
 * parent_message_id/is_edited — none of those are exercised by this
 * lead-gen flow's own state machine (chatBotEngine.js), and fabricating
 * unused message kinds wasn't asked for. Add them if a real requirement
 * needs them later.
 */
const ChatMessageSchema = new mongoose.Schema(
  {
    chatId: { type: String, required: true, index: true },
    sender: { type: String, enum: ["anonymous_customer", "customer", "bot"], required: true },
    senderId: { type: String, required: true }, // anonId, Customer.id, or "bot"

    messageType: {
      type: String,
      enum: ["text", "options", "date_picker", "multi_select", "flow_complete"],
      default: "text",
    },
    messageContent: { type: String, required: true },
    // Present for options/multi_select/date_picker — the clickable
    // choices the frontend renders alongside messageContent.
    options: [{ label: String, value: String }],

    sentAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "customer_chat_messages",
  }
);

ChatMessageSchema.index({ chatId: 1, sentAt: 1 });

export default mongoose.model("ChatMessage", ChatMessageSchema);
