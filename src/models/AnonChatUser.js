import mongoose from "mongoose";
import { generateISTId } from "../utils/idGenerator.js";

/**
 * Anonymous Chat / lead-gen chatbot — tracks a browser visitor before (or
 * without ever) creating a real Customer account, so the homepage chat
 * widget can work for a guest. Named/collectioned distinctly from
 * everything else in this codebase (own "anon_chat_users" collection,
 * checked live via listCollections() first, no collision) — this is NOT
 * the same concept as customerCartRoutes.js's guestId (an ephemeral
 * client-generated cart token); this is a persisted lead record the chat
 * flow accumulates against.
 *
 * Deliberately minimal compared to V1's anonymousUser.js (acquisition/
 * device/UTM tracking fields) — nothing in this engagement's scope reads
 * those, and fabricating that tracking surface wasn't asked for. Add
 * fields here if/when a real requirement needs them.
 */
const AnonChatUserSchema = new mongoose.Schema(
  {
    anonId: { type: String, unique: true, required: true, default: () => generateISTId("ANON") },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    // Set once/if this visitor later creates a real account and their
    // anon chat is migrated onto it — see chatBotEngine.js /
    // customerChatController.js's resolveChatIdentity for when this link
    // is made (best-effort, additive only, same philosophy as Booking.js's
    // own autoLinkCustomer hook).
    convertedCustomerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
  },
  {
    timestamps: true,
    collection: "anon_chat_users",
  }
);

export default mongoose.model("AnonChatUser", AnonChatUserSchema);
