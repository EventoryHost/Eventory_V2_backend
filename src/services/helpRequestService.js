import mongoose from "mongoose";
import ChatEnquiry from "../models/ChatEnquiry.js";
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

/** What the help panel needs to render the thread and its status card. */
export function serializeHelpRequest(enquiry, { late }) {
  return {
    enquiryId: enquiry.enquiryId,
    ticket: enquiry.ticket || enquiry.enquiryId,
    createdAt: enquiry.createdAt,
    replyMode: enquiry.replyMode,
    offHours: enquiry.createdOffHours,
    late,
    replied: Boolean(enquiry.firstReplyAt),
    callBack: enquiry.callBack
      ? {
          requestId: enquiry.callBack.requestId,
          ticket: enquiry.callBack.ticket || enquiry.callBack.requestId,
          window: enquiry.callBack.window || null,
          callBy: enquiry.callBack.callBy,
        }
      : null,
    messages: (enquiry.helpMessages || []).map((m) => ({
      messageId: m.messageId,
      from: m.from,
      senderName: m.senderName,
      text: m.text,
      sentAt: m.sentAt,
    })),
  };
}
