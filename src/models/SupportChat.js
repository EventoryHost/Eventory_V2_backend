import mongoose from "mongoose";

/**
 * A vendor's Help & Support chat with the Event Manager team, opened from a
 * Package Setup step (topic package_setup), the publish screen
 * (topic publish_package), a booking (topic booking) or a Business profile
 * setup screen (topic business_profile) in the vendor app. A vendor has one
 * business_profile chat; Help on another profile screen restarts it there.
 *
 * Lifecycle (status):
 *   automated       — the server is running the quick-reply flow
 *   call_requested  — vendor tapped "Not quite, call me"; an EM should call
 *   waiting_for_em  — vendor tapped "Something else"; has a ticketNumber
 *   with_em         — an EM joined; vendor and EM chat in free text
 *   resolved        — closed by the vendor ("Yes, that helps") or an EM
 *
 * Free-text messages live in SupportMessage. The quick-reply conversation
 * (bot questions and the replies the vendor tapped) is kept here in
 * `transcript`, `options` are the replies offered next, and `context` holds
 * what the app showed when Help was opened (step name, booking facts…).
 */
export const SUPPORT_CHAT_STATUSES = ["automated", "call_requested", "waiting_for_em", "with_em", "resolved"];
export const SUPPORT_CHAT_TOPICS = ["package_setup", "publish_package", "booking", "business_profile"];

const TranscriptLineSchema = new mongoose.Schema(
  {
    from: { type: String, enum: ["bot", "vendor"], required: true },
    text: { type: String, required: true },
    at: { type: Date, required: true },
    tutorialId: { type: String, default: undefined },
  },
  { _id: false }
);

const ReplyOptionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
  },
  { _id: false }
);

const SupportChatSchema = new mongoose.Schema(
  {
    chatId: { type: String, unique: true, required: true },
    vendorId: { type: String, required: true },
    topic: { type: String, enum: SUPPORT_CHAT_TOPICS, default: "package_setup" },
    packageId: { type: String, default: null },
    step: { type: Number, default: null },
    bookingId: { type: String, default: null },

    status: { type: String, enum: SUPPORT_CHAT_STATUSES, default: "automated" },
    ticketNumber: { type: String, default: undefined },

    emId: { type: String, default: null },
    emName: { type: String, default: null },

    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    transcript: { type: [TranscriptLineSchema], default: [] },
    options: { type: [ReplyOptionSchema], default: [] },

    handedOverAt: { type: Date, default: null },
    callRequestedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: null },
  },
  {
    timestamps: true,
    collection: "support_chats",
  }
);

SupportChatSchema.index({ vendorId: 1, topic: 1, packageId: 1, step: 1, bookingId: 1, status: 1 });
SupportChatSchema.index({ status: 1, updatedAt: -1 });
SupportChatSchema.index({ ticketNumber: 1 }, { unique: true, sparse: true });

export default mongoose.model("SupportChat", SupportChatSchema);
