import mongoose from "mongoose";

/**
 * A reply an Event Manager saved for reuse in the admin Help & Support inbox
 * (the "+" in the composer). Each EM has their own list, keyed by their V1
 * em_id — the same id tickets are assigned with — so no separate EM record
 * or sign-in is needed. Own collection; nothing else reads it.
 */
const EmReplyTemplateSchema = new mongoose.Schema(
  {
    emId: { type: String, required: true },
    emName: { type: String, default: null },
    title: { type: String, required: true, trim: true },
    text: { type: String, required: true },
    // How often it was put into a reply; the list puts the most used first.
    useCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "em_reply_templates" }
);

EmReplyTemplateSchema.index({ emId: 1, updatedAt: -1 });

export default mongoose.model("EmReplyTemplate", EmReplyTemplateSchema);
