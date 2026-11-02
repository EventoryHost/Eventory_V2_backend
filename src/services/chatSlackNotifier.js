import axios from "axios";
import ChatEnquiry from "../models/ChatEnquiry.js";
import Booking from "../models/Booking.js";
import { buildSlackPayload, resolvedBlocks } from "./helpTicketSlack.js";

/**
 * Anonymous Chat / lead-gen chatbot — Slack notification. Deliberately the
 * SIMPLE "post a formatted message to a channel" version, not V1's full
 * Slack Lists ticket-tracking system (utils/slackLists.js) — checked with
 * the user first: that system is hardcoded against V1's own Slack
 * workspace ids (list_id "F09RT5WG6Q5", column ids, per-event-type option
 * ids like "OptJUWLBAPN") which don't exist for this project's workspace,
 * so porting it verbatim would silently fail every call. This posts via a
 * Slack Incoming Webhook (SLACK_CHAT_WEBHOOK_URL — new env var, see
 * info.txt for what you need to set up) instead — no ticket/column mapping
 * to configure, works with any workspace.
 *
 * Fires at the same 3 milestones the client's own spec implies (new lead /
 * requirements gathered / handoff complete), but never blocks or fails the
 * conversation itself — every call is fire-and-forget from the caller's
 * perspective (chatBotEngine.js awaits it just to log failures, never lets
 * a Slack error interrupt the bot's reply).
 */
// The webhook, for posts with no thread (and when the bot isn't set up).
// SLACK_CHAT_WEBHOOK_URL is the original name, still honoured.
const webhookUrl = () => process.env.SLACK_HELP_WEBHOOK_URL || process.env.SLACK_CHAT_WEBHOOK_URL;

function isConfigured() {
  return Boolean(webhookUrl());
}

function formatEnquiryBlock(enquiry) {
  const lines = [
    `*Event Type:* ${enquiry.eventType || "—"}`,
    `*Event Date:* ${enquiry.eventDateRaw || (enquiry.eventDate ? new Date(enquiry.eventDate).toDateString() : "Not decided")}`,
    `*City:* ${enquiry.city || "—"}`,
    `*Venue:* ${enquiry.venueSetting || "—"}`,
    `*Services:* ${(enquiry.servicesNeeded || []).join(", ") || "—"}`,
    `*Guests:* ${enquiry.guestCount || "—"}`,
    `*Budget:* ${enquiry.budgetRange || (enquiry.budgetOption === "No" ? "Not decided" : "—")}`,
  ];
  return lines.join("\n");
}

/**
 * Help tickets as threads: with a bot token (SLACK_BOT_TOKEN, xoxb-…) and
 * the channel's id (SLACK_HELP_CHANNEL_ID, C…), a ticket is posted with
 * chat.postMessage and its ts kept on the ChatEnquiry; everything after
 * goes into that thread, and Event Manager replies there come back to the
 * customer (POST /api/slack/events). Without them, the webhook as before.
 */
const botToken = () => process.env.SLACK_BOT_TOKEN;
const helpChannel = () => process.env.SLACK_HELP_CHANNEL_ID;
export const slackBotConfigured = () => Boolean(botToken() && helpChannel());

/** Whether the webhook or the bot is set — GET /api/customer/chat/slack/status reports it. */
export const slackConfigured = () => isConfigured() || slackBotConfigured();

/** A Slack Web API call with the bot token; throws on Slack's `ok: false`. */
export async function slackApi(method, body) {
  // SLACK_API_URL: only to point tests at a stand-in Slack.
  const { data } = await axios.post(`${process.env.SLACK_API_URL || "https://slack.com/api"}/${method}`, body, {
    headers: { Authorization: `Bearer ${botToken()}`, "Content-Type": "application/json; charset=utf-8" },
  });
  if (!data.ok) throw new Error(`${method}: ${data.error}`);
  return data;
}

/**
 * Posts a ticket's first message. With the bot, the post's ts is kept on
 * the ticket so its updates thread under it. Once per ticket: a retried
 * call finds the thread already there and posts nothing. Returns false
 * when nothing could be posted.
 */
export async function postTicketParent(enquiry, payload) {
  if (enquiry?.slackThreadTs) return true;
  if (enquiry && slackBotConfigured()) {
    try {
      const sent = await slackApi("chat.postMessage", { channel: helpChannel(), unfurl_links: false, ...payload });
      // Two posts racing for one ticket: the first to save wins; the other is removed.
      const claimed = await ChatEnquiry.updateOne(
        { _id: enquiry._id, slackThreadTs: null },
        { $set: { slackChannel: sent.channel, slackThreadTs: sent.ts } }
      );
      if (!claimed.modifiedCount) {
        await slackApi("chat.delete", { channel: sent.channel, ts: sent.ts }).catch(() => {});
      } else {
        enquiry.slackChannel = sent.channel;
        enquiry.slackThreadTs = sent.ts;
      }
      return true;
    } catch (err) {
      console.error("[chatSlackNotifier] Slack bot post failed, trying the webhook:", err.response?.data || err.message);
    }
  }
  return postBlocks(payload);
}

/**
 * Whether the ticket has a Slack thread, waiting a few seconds for a new
 * ticket's own post: the panel posts booking tickets just after creating
 * them, and an update in that gap (a call back, a quick follow-up) would
 * otherwise land outside the thread. Fills in the enquiry's thread fields.
 */
async function awaitThread(enquiry) {
  if (enquiry?.slackThreadTs) return true;
  if (!enquiry?._id || !slackBotConfigured()) return false;
  // Older tickets that never got a thread (posted by webhook) aren't waited on.
  if (!enquiry.createdAt || Date.now() - new Date(enquiry.createdAt).getTime() > 60_000) return false;
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const fresh = await ChatEnquiry.findById(enquiry._id, { slackChannel: 1, slackThreadTs: 1 }).lean();
    if (fresh?.slackThreadTs) {
      enquiry.slackChannel = fresh.slackChannel;
      enquiry.slackThreadTs = fresh.slackThreadTs;
      return true;
    }
  }
  return false;
}

/**
 * A ticket with no thread yet (raised before the bot was set up, or its
 * post failed): with the bot, it gets its parent post now, so this update
 * and everything after thread under it. Without the bot: false, and the
 * update is a channel post as before.
 */
async function startLegacyThread(enquiry) {
  if (!slackBotConfigured() || !enquiry?._id || enquiry.source !== "help_panel") return false;
  // Only an old ticket says so; a new one whose post failed just gets it now.
  const legacy = !enquiry.createdAt || Date.now() - new Date(enquiry.createdAt).getTime() > 60_000;
  await postTicketParent(enquiry, await parentPayloadFor(enquiry, { legacy }));
  return Boolean(enquiry.slackThreadTs);
}

/**
 * An update on a ticket: into its thread when it has one (`broadcast` also
 * shows it in the channel, for things the team lead must see), else a
 * channel post as before.
 */
async function postToTicket(enquiry, text, { broadcast = false } = {}) {
  if ((await awaitThread(enquiry)) || (await startLegacyThread(enquiry))) {
    try {
      await slackApi("chat.postMessage", {
        channel: enquiry.slackChannel || helpChannel(),
        thread_ts: enquiry.slackThreadTs,
        reply_broadcast: broadcast,
        unfurl_links: false,
        text,
      });
      return;
    } catch (err) {
      console.error("[chatSlackNotifier] Slack thread post failed, trying the webhook:", err.response?.data || err.message);
    }
  }
  await post(text);
}

/**
 * The ticket's Slack post as resolved — header ✅, no "Mark resolved"
 * button, a line saying who — when the ticket was resolved outside Slack
 * (the customer did it in the help panel).
 */
export async function markTicketPostResolved(enquiry, byLine) {
  if (!enquiry?.slackThreadTs || !botToken()) return;
  const channel = enquiry.slackChannel || helpChannel();
  const { messages } = await slackApi("conversations.history", {
    channel,
    latest: enquiry.slackThreadTs,
    inclusive: true,
    limit: 1,
  });
  const parent = messages?.find((m) => m.ts === enquiry.slackThreadTs);
  if (!parent) return;
  await slackApi("chat.update", {
    channel,
    ts: enquiry.slackThreadTs,
    text: `✅ ${enquiry.ticket || enquiry.enquiryId} resolved`,
    blocks: resolvedBlocks(parent.blocks ?? [{ type: "section", text: { type: "mrkdwn", text: parent.text || " " } }], byLine),
  });
}

/** Posts a Block Kit message (help ticket posts). Returns false when not configured or Slack refused. */
export async function postBlocks(payload) {
  if (!isConfigured()) {
    console.log(`[chatSlackNotifier] SLACK_HELP_WEBHOOK_URL not set — skipping (would have posted): ${payload.text}`);
    return false;
  }
  try {
    await axios.post(webhookUrl(), payload);
    return true;
  } catch (err) {
    console.error("[chatSlackNotifier] Slack webhook post failed (non-blocking):", err.response?.data || err.message);
    return false;
  }
}

async function post(text) {
  if (!isConfigured()) {
    console.log(`[chatSlackNotifier] SLACK_HELP_WEBHOOK_URL not set — skipping (would have posted):\n${text}`);
    return;
  }
  try {
    await axios.post(webhookUrl(), { text });
  } catch (err) {
    console.error("[chatSlackNotifier] Slack webhook post failed (non-blocking):", err.response?.data || err.message);
  }
}

/** @desc New lead — event type just captured, conversation just started. */
export async function notifyNewLead(enquiry) {
  await post(`🆕 *New Eventory chat lead* (enquiry ${enquiry.enquiryId})\n${formatEnquiryBlock(enquiry)}`);
}

/** @desc Requirements gathered, about to collect contact details for handoff. */
export async function notifyHandoffStarted(enquiry) {
  await post(`📋 *Chat lead ready for handoff* (enquiry ${enquiry.enquiryId})\n${formatEnquiryBlock(enquiry)}`);
}

/** @desc Full flow complete — name/phone collected, ready for an Event Manager to call. */
export async function notifyFlowComplete(enquiry) {
  const text =
    `✅ *New Eventory lead — ready to call*\n` +
    `*Name:* ${enquiry.customerName || "—"}\n` +
    `*Phone:* ${enquiry.phoneNumber || "—"}\n` +
    `*Best time to call:* ${enquiry.bestTimeToCall || "Anytime"}\n` +
    `${formatEnquiryBlock(enquiry)}`;
  await post(text);
}

/**
 * A ticket's parent post (the message its thread hangs off), built from
 * the ticket itself: a booking ticket names its packages and bookings, a
 * planning brief lists what they asked for. `note`/`details`: the request's
 * own words and lines, when the caller has them. `legacy`: a ticket from
 * before threads, getting its post on its next update.
 */
async function parentPayloadFor(enquiry, { note = null, details = [], legacy = false } = {}) {
  const c = enquiry.customer ?? {};
  const base = {
    ticket: enquiry.ticket || enquiry.enquiryId,
    customerName: c.name || enquiry.customerName,
    customerEmail: c.email,
    customerCode: c.code || (enquiry.anonId ? `Guest ${enquiry.anonId}` : null),
    createdAt: enquiry.createdAt ?? new Date(),
    status: enquiry.ticketStatus === "closed" ? "✅ Resolved" : "🟡 Open",
    note,
  };
  const opts = { resolvable: Boolean(process.env.SLACK_SIGNING_SECRET), threaded: slackBotConfigured() };
  const legacyLine = legacy ? ["↩️ Raised before Slack threads: its earlier updates are separate posts above."] : [];

  if (enquiry.bookingRefs?.length) {
    const bookings = await Booking.find(
      { bookingId: { $in: enquiry.bookingRefs } },
      { bookingId: 1, packageId: 1, packageSnapshot: 1, customer: 1 }
    ).lean();
    // A report about one package names that one; else every package asked about.
    const about = enquiry.report?.packageRef ? bookings.filter((b) => b.bookingId === enquiry.report.packageRef) : bookings;
    const contact = (about[0] ?? bookings[0])?.customer ?? {};
    return buildSlackPayload(
      {
        ...base,
        issue: enquiry.report?.label || enquiry.topic,
        customerName: base.customerName || contact.name,
        customerEmail: base.customerEmail || contact.email,
        customerPhone: c.phone || contact.phone,
        packageName: about.map((b) => b.packageSnapshot?.name).filter(Boolean).join(", ") || null,
        packageId: about.length === 1 ? String(about[0].packageId ?? "") || null : null,
        bookingId: (enquiry.report?.packageRef ? [enquiry.report.packageRef] : enquiry.bookingRefs).join(", "),
        emName: enquiry.assignedEmName,
        urgent: Boolean(enquiry.report?.urgent),
        details: [...details, ...legacyLine].join("\n").slice(0, 3000),
      },
      opts
    );
  }

  const phone = enquiry.phoneNumber || c.phone || null;
  const brief = [
    enquiry.replyMode === "call-me"
      ? `📞 Call back: ${phone || "—"} (${enquiry.bestTimeToCall || "Anytime"})`
      : "💬 Reply in the help chat (customer chose Reply here)",
    `Occasion: ${enquiry.eventType || "—"}`,
    `Service: ${(enquiry.servicesNeeded || []).join(", ") || "—"}`,
    `Guests: ${enquiry.guestCount || "—"}`,
    `Budget: ${enquiry.budgetRange || "—"}`,
    `Area: ${enquiry.city || "—"}`,
    `Date: ${enquiry.eventDateRaw || "Not given"}`,
    ...(enquiry.areaServed === false ? ["⚠️ Area not served yet — check whether a vendor travels there."] : []),
    ...(enquiry.hasReferencePhoto ? ["📷 Has a reference photo — not uploaded; ask them to share it on WhatsApp."] : []),
    ...(enquiry.pageUrl ? [`Page: ${enquiry.pageUrl}`] : []),
    ...legacyLine,
    ...(enquiry.transcript?.length ? ["Chat so far:", ...enquiry.transcript.map((l) => `  ${l}`)] : []),
  ];
  // The WhatsApp message's version: only what they told us, in their terms.
  const plan = [
    ["Looking for", (enquiry.servicesNeeded || []).join(", ")],
    ["Guests", enquiry.guestCount],
    ["Budget", enquiry.budgetRange],
    ["Area", enquiry.city],
    ["Date", enquiry.eventDateRaw],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  return buildSlackPayload(
    {
      ...base,
      issue: `Planning help · ${enquiry.eventType || "Event"}`,
      customerIssue: `Help planning your ${enquiry.eventType ? enquiry.eventType.toLowerCase() : "event"}`,
      customerDetails: [
        ...plan,
        ...(enquiry.hasReferencePhoto ? ["You have a reference photo — please send it here"] : []),
      ],
      customerPhone: phone,
      details: brief.join("\n").slice(0, 3000),
    },
    { ...opts, withPackage: false }
  );
}

/**
 * @desc Help panel brief sent to the Event Manager team — the ticket's
 * parent post: WhatsApp to the customer (when there's a number) and
 * "Mark resolved" (when interactivity is set up).
 */
export async function notifyHelpRequest(enquiry) {
  await postTicketParent(enquiry, await parentPayloadFor(enquiry));
}

/**
 * @desc A request or event-day report from a booking page — the ticket's
 * parent post, with the request's own words (`text`) and its lines
 * (new guest count, missing items, photo…).
 */
export async function notifyBookingTicket(enquiry, { text, details = [] } = {}) {
  await postTicketParent(enquiry, await parentPayloadFor(enquiry, { note: text, details }));
}

const istTime = (date) =>
  new Date(date).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });

/** @desc Help panel request with no reply after 30 min — for the team lead. */
export async function notifyHelpRequestLate(enquiry) {
  // In the thread, and shown in the channel too: the team lead must see it.
  if ((await awaitThread(enquiry)) || (await startLegacyThread(enquiry))) {
    await postToTicket(enquiry, `⚠️ *${enquiry.ticket || enquiry.enquiryId} waiting 30+ min with no reply* — team lead, please pick this up.`, {
      broadcast: true,
    });
    return;
  }
  await post(
    `⚠️ *Help panel request ${enquiry.ticket || ""} waiting 30+ min* (enquiry ${enquiry.enquiryId}) — team lead, please pick this up.\n` +
      `${formatEnquiryBlock(enquiry)}`
  );
}

/** @desc Customer asked for a call back from the help panel thread. */
export async function notifyHelpCallBack(enquiry) {
  await postToTicket(enquiry,
    `📞 *Call back requested ${enquiry.callBack.ticket || ""}* (request ${enquiry.ticket || enquiry.enquiryId})\n` +
      `*Phone:* ${enquiry.callBack.phone}\n` +
      `*When:* ${enquiry.callBack.window || "As soon as possible"} · call by ${istTime(enquiry.callBack.callBy)}\n` +
      (enquiry.callBack.note ? `*About:* ${enquiry.callBack.note}\n` : "") +
      `${formatEnquiryBlock(enquiry)}`
  );
}

/** @desc Out-of-area "Notify me" lead from the help panel. */
export async function notifyAreaWaitlist(entry) {
  const plan = [entry.occasion, entry.guests && `${entry.guests} guests`, entry.budget].filter(Boolean).join(" · ");
  await post(
    `📍 *Out-of-area lead:* ${entry.area}${entry.pincode ? ` (${entry.pincode})` : ""}` +
      `${{ location_tag: " — from their location tag", current_location: " — their current location" }[entry.areaSource] ?? ""}\n` +
      `*Phone:* ${entry.phone}${entry.customerName ? ` · ${entry.customerName}` : ""}\n` +
      (plan ? `*Planning:* ${plan}\n` : "") +
      (entry.requestText ? `> ${entry.requestText}\n` : "") +
      `Wants one WhatsApp message when we start serving ${entry.area}.`
  );
}

/** @desc Customer moved a help ticket to WhatsApp — reply there with the ticket in hand. */
export async function notifyHelpWhatsApp(enquiry) {
  await postToTicket(enquiry,
    `📱 *${enquiry.ticket || enquiry.enquiryId} continued on WhatsApp* — the customer opened WhatsApp from the help panel. ` +
      `Reply there; the chat so far is on the ticket.`
  );
}

/** @desc A customer cancelled a booking (help panel or booking page) — the refund to process. */
export async function notifyBookingCancelled(booking) {
  const r = booking.refund;
  const refund = !r
    ? "—"
    : r.status === "team_review"
      ? `to be decided by the team (₹${r.paid} paid, ${r.policy} policy)`
      : r.status === "none"
        ? `nothing (₹${r.paid} paid, ${r.policy} policy)`
        : `₹${r.amount} of ₹${r.paid} paid (${r.policy} policy) — process it, then mark it started/completed`;
  await post(
    `❌ *Booking ${booking.bookingId} cancelled by the customer*\n` +
      `*For:* ${booking.assignedEmName || "Event Manager team (no Event Manager assigned)"}\n` +
      `*Package:* ${booking.packageSnapshot?.name || "—"} · ${booking.eventType || "—"} on ${booking.eventDate ? new Date(booking.eventDate).toDateString() : "—"}\n` +
      `*Reason:* ${booking.cancellationReason || "Not given"}\n` +
      `*Refund:* ${refund}`
  );
}

/** @desc Event day: the customer is contacting a vendor's on-ground person directly. */
export async function notifyVendorContact(booking, customer) {
  await post(
    `📞 *${customer.name || "The customer"} is contacting the vendor directly* on the event day\n` +
      `*For:* ${booking.assignedEmName || "Event Manager team"}\n` +
      `*Booking:* ${booking.bookingId} · ${booking.packageSnapshot?.name || "—"}` +
      (booking.groundStaff ? ` · on-ground: ${booking.groundStaff.name} ${booking.groundStaff.phone}` : "")
  );
}

/** @desc The customer says an event-day report is sorted — check with the vendor, then close it. */
export async function notifyHelpSorted(enquiry) {
  await postToTicket(enquiry, `✅ *${enquiry.ticket}: the customer says it's sorted* — check with the vendor, then resolve the ticket.`);
}

/** @desc Customer wrote again in the help panel thread (`reopened`: on a resolved ticket). */
export async function notifyHelpMessage(enquiry, text, { reopened = false } = {}) {
  const quote = text.replace(/\n/g, "\n> ");
  if ((await awaitThread(enquiry)) || (await startLegacyThread(enquiry))) {
    await postToTicket(
      enquiry,
      `💬 *Customer:*\n> ${quote}` + (reopened ? "\n🔄 _They wrote after it was resolved, so the ticket is open again._" : ""),
      { broadcast: reopened }
    );
    return;
  }
  await post(`💬 *New message on help request ${enquiry.ticket || enquiry.enquiryId}*${reopened ? " (reopened)" : ""}\n> ${quote}`);
}

/** @desc The customer marked their ticket resolved in the help panel. */
export async function notifyHelpResolvedByCustomer(enquiry) {
  await postToTicket(enquiry, `✅ *${enquiry.ticket || enquiry.enquiryId}: the customer marked this resolved* in the help panel.`);
  await markTicketPostResolved(enquiry, "✅ Resolved by the customer").catch((err) =>
    console.error("[chatSlackNotifier] marking the Slack post resolved failed:", err.message)
  );
}

export default {
  notifyNewLead,
  notifyHandoffStarted,
  notifyFlowComplete,
  notifyHelpRequest,
  notifyBookingTicket,
  notifyHelpRequestLate,
  notifyHelpCallBack,
  notifyHelpMessage,
  notifyHelpWhatsApp,
  notifyAreaWaitlist,
  notifyBookingCancelled,
  notifyVendorContact,
  notifyHelpSorted,
  notifyHelpResolvedByCustomer,
};
