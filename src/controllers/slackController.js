import { createHmac, timingSafeEqual } from "crypto";
import axios from "axios";
import ChatEnquiry from "../models/ChatEnquiry.js";
import { postTicketParent, slackApi, slackBotConfigured, slackConfigured } from "../services/chatSlackNotifier.js";
import { RESOLVE_ACTION_ID, TICKET_FIELDS, buildSlackPayload, resolvedBlocks } from "../services/helpTicketSlack.js";
import { recordTicketMessage } from "../services/helpRequestService.js";

/**
 * Slack for the help panel, all server-side: the webhook
 * (SLACK_HELP_WEBHOOK_URL), signing secret (SLACK_SIGNING_SECRET), bot
 * token (SLACK_BOT_TOKEN) and channel (SLACK_HELP_CHANNEL_ID) come from
 * this server's env, which the deploy workflow writes from GitHub Secrets
 * — the frontend holds none of them.
 */

/**
 * @desc The panel's post for a new ticket. Fields only (no raw blocks), so
 * the endpoint can't be used to post arbitrary messages to the channel.
 * @route POST /api/customer/chat/slack/ticket
 */
export const postHelpTicketToSlack = async (req, res) => {
  const input = {};
  for (const [field, max] of Object.entries(TICKET_FIELDS)) {
    const v = req.body?.[field];
    if (typeof v === "string") input[field] = v.slice(0, max);
  }
  if (req.body?.urgent === true) input.urgent = true;
  if (!input.ticket && !input.issue) return res.status(400).json({ success: false, message: "ticket or issue required" });
  // The ticket's own record, so its later updates and replies thread under this post.
  const enquiry = input.ticket ? await ChatEnquiry.findOne({ source: "help_panel", ticket: input.ticket }) : null;
  const payload = buildSlackPayload(input, {
    resolvable: Boolean(process.env.SLACK_SIGNING_SECRET),
    threaded: Boolean(enquiry) && slackBotConfigured(),
  });
  const posted = await postTicketParent(enquiry, payload);
  if (!posted) {
    return res
      .status(slackConfigured() ? 502 : 503)
      .json({ success: false, message: slackConfigured() ? "Slack refused the post" : "Slack is not configured on this server" });
  }
  return res.json({ success: true });
};

/**
 * @desc Whether this server can post to Slack — check after a deploy. Says
 * only set / not set, never the values.
 * @route GET /api/customer/chat/slack/status
 */
export const slackStatus = (req, res) =>
  res.json({
    success: true,
    webhookConfigured: slackConfigured(),
    resolveButtonEnabled: Boolean(process.env.SLACK_SIGNING_SECRET),
    /** Bot token + channel: ticket threads, and replies there reach the customer. */
    threadsEnabled: slackBotConfigured(),
  });

const MAX_AGE_S = 60 * 5;

function verified(secret, timestamp, signature, body) {
  if (!timestamp || !signature || !Number.isFinite(Number(timestamp))) return false;
  // Old requests are replays.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_AGE_S) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Slack's signature check on a request this server received; false = reject it. */
const fromSlack = (req) =>
  verified(
    process.env.SLACK_SIGNING_SECRET,
    req.get("x-slack-request-timestamp"),
    req.get("x-slack-signature"),
    req.rawBody ? req.rawBody.toString("utf8") : ""
  );

/**
 * @desc Slack's Interactivity Request URL: "Mark resolved" on a ticket post.
 * Verified with Slack's signature, then the ticket is closed here directly.
 * @route POST /api/slack/interactions
 */
export const slackInteractions = async (req, res) => {
  if (!process.env.SLACK_SIGNING_SECRET) {
    console.error("[slack/interactions] SLACK_SIGNING_SECRET is not set");
    return res.status(500).json({ error: "Slack not configured" });
  }
  // The signature is over the raw body (app.js keeps it as req.rawBody).
  if (!fromSlack(req)) return res.status(401).json({ error: "Bad signature" });
  const raw = req.rawBody.toString("utf8");

  let payload;
  try {
    payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "");
  } catch {
    return res.status(400).json({ error: "Bad payload" });
  }
  const action = payload.type === "block_actions" ? payload.actions?.find((a) => a.action_id === RESOLVE_ACTION_ID) : null;
  // Slack wants a 200 within 3 seconds; the WhatsApp link button needs nothing more.
  res.status(200).end();
  if (!action?.value) return;

  const ticket = action.value;
  const reply = (body) => axios.post(payload.response_url, body).catch(() => {});
  try {
    const enquiry = await ChatEnquiry.findOne({ source: "help_panel", $or: [{ ticket }, { enquiryId: ticket }] });
    if (!enquiry) throw new Error("ticket not found");
    enquiry.ticketStatus = "closed";
    enquiry.resolvedAt = new Date();
    enquiry.resolvedBy = "team";
    await enquiry.save();
    await reply({
      replace_original: true,
      text: `✅ ${ticket} resolved`,
      blocks: resolvedBlocks(payload.message?.blocks ?? [], `✅ Resolved by <@${payload.user.id}>`),
    });
  } catch (error) {
    console.error(`[slack/interactions] resolving ${ticket} failed:`, error.message);
    // Only the clicker sees this; the post stays as it was.
    await reply({
      response_type: "ephemeral",
      replace_original: false,
      text: `Couldn't resolve ${ticket}. Try again, or close it from the admin panel.`,
    });
  }
};

// ---- Event Manager replies from the ticket's Slack thread ----

const slackNames = new Map();
/** Their Slack display name (users:read), for "{name} · Event Manager" in the chat. */
async function slackUserName(userId) {
  if (!userId) return "Event Manager";
  if (slackNames.has(userId)) return slackNames.get(userId);
  try {
    const { user } = await slackApi("users.info", { user: userId });
    const name = user?.profile?.display_name || user?.profile?.real_name || user?.real_name || user?.name || "Event Manager";
    slackNames.set(userId, name);
    return name;
  } catch {
    return "Event Manager";
  }
}

/** Slack's markup as the customer should read it: names, link labels, &, < and >. */
async function plainText(text) {
  const ids = [...new Set([...text.matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]))];
  const names = new Map(await Promise.all(ids.map(async (id) => [id, await slackUserName(id)])));
  return text
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id) => `@${names.get(id)}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<!(here|channel|everyone)>/g, "")
    .replace(/<(?:mailto:)?([^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(?:mailto:)?([^>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

// Plain replies only: no edits, deletions, joins or bot posts (ours included).
const REPLY_SUBTYPES = new Set([undefined, "file_share", "thread_broadcast"]);

/**
 * @desc Slack's Event Subscriptions Request URL (message.channels /
 * message.groups). A person's reply in a ticket's thread is saved as the
 * Event Manager's message on that ticket — the customer's panel shows it
 * on its next poll, like a reply from the admin panel. Replies starting
 * with "//" stay in Slack (team notes).
 * @route POST /api/slack/events
 */
export const slackEvents = async (req, res) => {
  if (!process.env.SLACK_SIGNING_SECRET) {
    console.error("[slack/events] SLACK_SIGNING_SECRET is not set");
    return res.status(500).json({ error: "Slack not configured" });
  }
  if (!fromSlack(req)) return res.status(401).json({ error: "Bad signature" });
  const body = req.body ?? {};
  // Slack checks the URL once, when it's saved in the app's settings.
  if (body.type === "url_verification") return res.json({ challenge: body.challenge });
  // Answered at once: Slack retries anything slower than 3 seconds.
  res.status(200).end();

  const e = body.event;
  if (body.type !== "event_callback" || e?.type !== "message") return;
  if (!e.thread_ts || e.thread_ts === e.ts || e.bot_id || !e.user || !REPLY_SUBTYPES.has(e.subtype)) return;
  const raw = (e.text ?? "").trim();
  if (raw.startsWith("//")) return;
  try {
    // A ts is unique within its channel, so the pair is the ticket.
    const enquiry = await ChatEnquiry.findOne({ source: "help_panel", slackChannel: e.channel, slackThreadTs: e.thread_ts });
    if (!enquiry) return;
    // Text only: Slack files are private to the workspace.
    const text = await plainText(raw);
    if (!text) return;
    // Keyed by Slack's ts, so a retried event is saved once — and it's the
    // panel's item id too, so its thread save doesn't store it again.
    const messageId = `HMSG-slack-${e.channel}-${e.ts.replace(".", "-")}`;
    const saved = await recordTicketMessage(enquiry, {
      role: "event_manager",
      text: text.slice(0, 4000),
      messageId,
      clientId: messageId,
      senderId: e.user,
      senderName: await slackUserName(e.user),
      via: "slack",
    });
    if (!saved.isRetry) {
      await ChatEnquiry.updateOne({ _id: enquiry._id, firstReplyAt: null }, { $set: { firstReplyAt: saved.sentAt } });
    }
  } catch (error) {
    console.error(`[slack/events] saving the reply in ${e.thread_ts} failed:`, error.message);
  }
};
