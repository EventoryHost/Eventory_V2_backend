import crypto from "crypto";
import mongoose from "mongoose";
import ChatEnquiry from "../models/ChatEnquiry.js";
import HelpConversation from "../models/HelpConversation.js";
import HelpMessage from "../models/HelpMessage.js";
import { generateISTId } from "../utils/idGenerator.js";
import { notifyHelpRequestLate } from "./chatSlackNotifier.js";

/**
 * Help panel hand-off thread (frontend src/features/customer-help) — shared
 * by the customer endpoints (customerChatController.js) and the Event
 * Manager reply endpoint (adminHelpRequestController.js). Event Managers
 * work 9 AM–9 PM IST and promise a reply within 30 minutes; a request with
 * no reply after that is "late" and flagged to the team lead once.
 */

export const REPLY_PROMISE_MINUTES = 30;
const OPEN_HOUR = 9;
const CLOSE_HOUR = 21;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const istHour = (date) => new Date(date.getTime() + IST_OFFSET_MS).getUTCHours();

export const isOffHours = (date = new Date()) => {
  const h = istHour(date);
  return h < OPEN_HOUR || h >= CLOSE_HOUR;
};

/** The next 9:30 AM IST — when the first Event Manager in calls back. */
export function nextMorningCall(from = new Date()) {
  const ist = new Date(from.getTime() + IST_OFFSET_MS);
  const target = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 9, 30) - IST_OFFSET_MS);
  return target > from ? target : new Date(target.getTime() + 24 * 60 * 60 * 1000);
}

/** `hour`:`minute` IST, `dayOffset` days after `from`'s IST date. */
function istAt(from, dayOffset, hour, minute = 0) {
  const ist = new Date(from.getTime() + IST_OFFSET_MS);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + dayOffset, hour, minute) - IST_OFFSET_MS
  );
}

/**
 * Latest time we promise to call, from the brief's call-time chip
 * (frontend HelpBriefCard CALL_TIMES_*). No chip — the status card's "Get a
 * call back" — means as soon as possible: within 30 min in hours, else
 * 9:30 AM next morning.
 */
export function callBackDeadline(window = null, from = new Date()) {
  switch (window) {
    case "In the next hour":
      return new Date(from.getTime() + 60 * 60 * 1000);
    case "This evening, 6–9 PM":
      return istAt(from, 0, 21);
    case "Tomorrow, 9–10 AM":
      return istAt(from, istHour(from) < OPEN_HOUR ? 0 : 1, 10);
    case "Tomorrow, 12–2 PM":
      return istAt(from, istHour(from) < OPEN_HOUR ? 0 : 1, 14);
    case "Tomorrow, 6–9 PM":
      return istAt(from, istHour(from) < OPEN_HOUR ? 0 : 1, 21);
    default:
      return isOffHours(from) ? nextMorningCall(from) : new Date(from.getTime() + REPLY_PROMISE_MINUTES * 60 * 1000);
  }
}

/**
 * No Event Manager reply or call back by the promised time — 30 min in
 * hours, 9:30 AM for a night request. Flags the team lead the first time
 * it's seen (fire-and-forget).
 */
export async function checkLate(enquiry) {
  // At night the promise is "the first person in will reply by 9:30 AM"
  // (Figma 10.2), so a night request is late from 9:30 AM, not 30 min.
  const due = enquiry.createdOffHours
    ? nextMorningCall(enquiry.createdAt).getTime()
    : enquiry.createdAt.getTime() + REPLY_PROMISE_MINUTES * 60 * 1000;
  const late =
    !enquiry.firstReplyAt &&
    !enquiry.resolvedAt &&
    !enquiry.callBack &&
    enquiry.replyMode !== "call-me" &&
    Date.now() >= due;
  if (late && !enquiry.lateFlaggedAt) {
    // Conditional update so two polls racing each other only flag once.
    const res = await ChatEnquiry.updateOne(
      { _id: enquiry._id, lateFlaggedAt: null },
      { $set: { lateFlaggedAt: new Date() } }
    );
    if (res.modifiedCount) {
      notifyHelpRequestLate(enquiry).catch((err) =>
        console.error("[helpRequestService] late notify failed:", err.message)
      );
    }
  }
  return late;
}

/**
 * Next short ticket ref, "TKT-1001" onwards — an atomic counter, so refs
 * never repeat. Own collection, like the rest of the chat models.
 */
export async function nextTicket() {
  const doc = await mongoose.connection
    .collection("customer_help_ticket_counters")
    .findOneAndUpdate({ _id: "ticket" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return `TKT-${1000 + (doc?.seq ?? doc?.value?.seq ?? 0)}`;
}

/** Event-day problem reports have their own refs: "GRV-4001" onwards. */
export async function nextGrievance() {
  const doc = await mongoose.connection
    .collection("customer_help_ticket_counters")
    .findOneAndUpdate({ _id: "grievance" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return `GRV-${4000 + (doc?.seq ?? doc?.value?.seq ?? 0)}`;
}

/**
 * "HMSG20261012173045123-9f3a1c" — timestamped like the other ids, plus a
 * random tail so two messages in the same millisecond never collide.
 */
export const newMessageId = () => `${generateISTId("HMSG")}-${crypto.randomBytes(3).toString("hex")}`;

/** The ticket's snapshot of who raised it (ChatEnquiry.customer). */
export function customerSnapshot(customer, phone = null) {
  if (!customer) return phone ? { code: null, name: null, email: null, phone } : null;
  return {
    code: customer.id ?? null,
    name: customer.name ?? null,
    email: customer.email ?? null,
    phone: customer.phone ?? phone ?? null,
  };
}

/**
 * A message sent into a ticket — by the customer or an Event Manager. Saved
 * before anything else happens (Slack is only told afterwards), in the
 * ticket's own chat. `clientId` is the panel's item id for a customer
 * message, so the thread's next save doesn't store it again.
 */
export async function recordTicketMessage(enquiry, { role, text, clientId, senderId = null, senderName = null, via }) {
  const messageId = newMessageId();
  const sentAt = new Date();
  const filter = { conversationId: enquiry.conversationId ?? null, clientId: clientId || messageId };
  const before = await HelpMessage.findOneAndUpdate(
    filter,
    {
      // A thread save can race ahead and store it as transcript first:
      // this claims it for the ticket either way.
      $set: { enquiryId: enquiry.enquiryId, ticket: enquiry.ticket, via, role, text },
      $setOnInsert: {
        messageId,
        customerId: enquiry.customerId ?? null,
        anonId: enquiry.anonId ?? null,
        senderId,
        senderName,
        sentAt,
      },
    },
    { upsert: true, returnDocument: "before", setDefaultsOnInsert: true }
  ).lean();
  const doc = await HelpMessage.findOne(filter).lean();
  // Already a ticket message (a retried send): count it once, and tell
  // the caller so Slack isn't told twice.
  if (before && before.via !== "transcript") return { ...doc, isRetry: true };

  await ChatEnquiry.updateOne(
    { _id: enquiry._id },
    {
      $set: {
        lastMessageAt: sentAt,
        lastMessageFrom: role,
        ...(role === "event_manager" ? { ticketStatus: "replied" } : {}),
      },
      $inc: { messageCount: 1 },
    }
  );
  if (enquiry.conversationId) {
    await HelpConversation.updateOne(
      { conversationId: enquiry.conversationId },
      { $set: { preview: text.slice(0, 200), lastMessageAt: sentAt } }
    );
  }
  return doc;
}

/**
 * The ticket's thread: its HelpMessage rows (customer follow-ups and Event
 * Manager replies), plus anything an older ticket still has inline.
 */
export async function loadTicketMessages(enquiry) {
  const rows = await HelpMessage.find({ enquiryId: enquiry.enquiryId, via: { $ne: "transcript" } })
    .sort({ sentAt: 1 })
    .lean();
  const ids = new Set(rows.map((m) => m.messageId));
  const legacy = (enquiry.helpMessages || [])
    .filter((m) => !ids.has(m.messageId))
    .map((m) => ({ ...m, role: m.from }));
  return [...legacy, ...rows].sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt));
}

/**
 * Every message of a chat as the panel showed it, from its saved thread.
 * Upserts by the panel's item id, so saving the same thread again (it's
 * saved after every change) adds only the new lines.
 */
const ITEM_ROLES = { me: "customer", assistant: "assistant", "event-manager": "event_manager", system: "system" };

export async function recordTranscript(conversation, items) {
  const savedAt = Date.now();
  const ops = items
    .filter((i) => ITEM_ROLES[i?.kind] && typeof i.id === "string" && typeof i.text === "string" && i.text.trim())
    .map((i, index) => ({
      updateOne: {
        filter: { conversationId: conversation.conversationId, clientId: i.id },
        update: {
          $setOnInsert: {
            messageId: i.kind === "event-manager" ? i.id : newMessageId(),
            clientId: i.id,
            conversationId: conversation.conversationId,
            enquiryId: conversation.enquiryId ?? null,
            ticket: conversation.ticket ?? null,
            customerId: conversation.customerId ?? null,
            anonId: conversation.anonId ?? null,
            role: ITEM_ROLES[i.kind],
            senderName: i.kind === "event-manager" ? i.senderName ?? null : null,
            text: i.text.slice(0, 4000),
            hasPhoto: Boolean(i.photoUrl),
            tone: i.tone ?? null,
            via: "transcript",
            // Lines first stored together keep the thread's order.
            sentAt: new Date(savedAt + index),
          },
        },
        upsert: true,
      },
    }));
  if (!ops.length) return;
  try {
    await HelpMessage.bulkWrite(ops, { ordered: false });
  } catch (err) {
    // Two saves racing on the same new line: one insert loses on the
    // unique index, which is fine — the line is stored.
    if (err?.code !== 11000 && !err?.writeErrors?.every?.((e) => e.code === 11000)) throw err;
  }
}

/**
 * Signing in claims what this browser did as a guest: its chats, tickets
 * and messages move to the customer, so all of one person's tickets list
 * together.
 */
export async function claimGuestHelpData(anonId, customer) {
  if (!anonId || !customer) return;
  const guest = { anonId, customerId: null };
  await Promise.all([
    HelpConversation.updateMany(guest, { $set: { customerId: customer._id } }),
    ChatEnquiry.updateMany(
      { ...guest, source: "help_panel" },
      { $set: { customerId: customer._id, customer: customerSnapshot(customer) } }
    ),
    HelpMessage.updateMany(guest, { $set: { customerId: customer._id } }),
  ]);
}

/** What the help panel needs to render the thread and its status card. */
export function serializeHelpRequest(enquiry, { late, messages = enquiry.helpMessages || [] }) {
  return {
    enquiryId: enquiry.enquiryId,
    ticket: enquiry.ticket || enquiry.enquiryId,
    createdAt: enquiry.createdAt,
    replyMode: enquiry.replyMode,
    offHours: enquiry.createdOffHours,
    late,
    replied: Boolean(enquiry.firstReplyAt),
    /** The team marked it resolved; Your chats lists it under Resolved. */
    resolved: enquiry.ticketStatus === "closed",
    whatsappAt: enquiry.whatsappAt ?? null,
    /** "request" or an event-day "report" (GRV ref). */
    kind: enquiry.kind ?? "request",
    report: enquiry.report ?? null,
    /** The customer said it's sorted; the team closes it after checking. */
    customerSortedAt: enquiry.customerSortedAt ?? null,
    callBack: enquiry.callBack
      ? {
          requestId: enquiry.callBack.requestId,
          ticket: enquiry.callBack.ticket || enquiry.callBack.requestId,
          window: enquiry.callBack.window || null,
          note: enquiry.callBack.note || null,
          callBy: enquiry.callBack.callBy,
        }
      : null,
    messages: messages.map((m) => ({
      messageId: m.messageId,
      from: m.role ?? m.from,
      senderName: m.senderName,
      text: m.text,
      sentAt: m.sentAt,
    })),
  };
}
