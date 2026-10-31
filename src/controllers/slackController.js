import { createHmac, timingSafeEqual } from "crypto";
import axios from "axios";
import ChatEnquiry from "../models/ChatEnquiry.js";
import { postBlocks, slackConfigured } from "../services/chatSlackNotifier.js";
import { RESOLVE_ACTION_ID, TICKET_FIELDS, buildSlackPayload } from "../services/helpTicketSlack.js";

/**
 * Slack for the help panel, all server-side: the webhook
 * (SLACK_HELP_WEBHOOK_URL) and signing secret (SLACK_SIGNING_SECRET) come
 * from this server's env, which the deploy workflow writes from GitHub
 * Secrets — the frontend holds neither.
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
  const posted = await postBlocks(buildSlackPayload(input, { resolvable: Boolean(process.env.SLACK_SIGNING_SECRET) }));
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

/** The post as resolved: ✅ header, no resolve button, who and when. */
function resolvedBlocks(blocks, userId) {
  const ts = Math.floor(Date.now() / 1000);
  return [
    ...blocks
      .map((b) => (b.type === "header" && b.text ? { ...b, text: { ...b.text, text: b.text.text.replace(/^(🆘|🚨)/, "✅ Resolved:") } } : b))
      .map((b) => (b.type === "actions" ? { ...b, elements: b.elements?.filter((e) => e.action_id !== RESOLVE_ACTION_ID) } : b))
      .filter((b) => b.type !== "actions" || b.elements?.length),
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `✅ Resolved by <@${userId}> · <!date^${ts}^{date_short_pretty} at {time}|just now>` }],
    },
  ];
}

/**
 * @desc Slack's Interactivity Request URL: "Mark resolved" on a ticket post.
 * Verified with Slack's signature, then the ticket is closed here directly.
 * @route POST /api/slack/interactions
 */
export const slackInteractions = async (req, res) => {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) {
    console.error("[slack/interactions] SLACK_SIGNING_SECRET is not set");
    return res.status(500).json({ error: "Slack not configured" });
  }
  // The signature is over the raw body (app.js keeps it as req.rawBody).
  const raw = req.rawBody ? req.rawBody.toString("utf8") : "";
  if (!verified(secret, req.get("x-slack-request-timestamp"), req.get("x-slack-signature"), raw)) {
    return res.status(401).json({ error: "Bad signature" });
  }

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
    await enquiry.save();
    await reply({ replace_original: true, text: `✅ ${ticket} resolved`, blocks: resolvedBlocks(payload.message?.blocks ?? [], payload.user.id) });
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
