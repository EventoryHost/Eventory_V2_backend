import mongoose from "mongoose";

/**
 * A vendor's Help & Support chat with the Event Manager team, opened from a
 * Package Setup step (topic package_setup) or the publish screen
 * (topic publish_package) or a booking (topic booking) in the vendor app.
 *
 * Lifecycle (status):
 *   automated       — the app is running its quick-reply flow on the phone
 *   call_requested  — vendor tapped "Not quite, call me"; an EM should call
 *   waiting_for_em  — vendor tapped "Something else"; has a ticketNumber
 *   with_em         — an EM joined; vendor and EM chat in free text
 *   resolved        — closed by the vendor ("Yes, that helps") or an EM
 *
 * Free-text messages live in SupportMessage. The quick replies the vendor
 * tapped before handover are kept here in `transcript` so the EM can read
 * what was already tried.
 */
export const SUPPORT_CHAT_STATUSES = ["automated", "call_requested", "waiting_for_em", "with_em", "resolved"];
export const SUPPORT_CHAT_TOPICS = ["package_setup", "publish_package", "booking"];

const TranscriptLineSchema = new mongoose.Schema(
  {
    from: { type: String, enum: ["bot", "vendor"], required: true },
    text: { type: String, required: true },
    at: { type: Date, required: true },
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

    transcript: { type: [TranscriptLineSchema], default: [] },

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
