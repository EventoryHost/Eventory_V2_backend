/**
 * The Event Managers' Slack post for a new help ticket (booking request,
 * event-day report, call back) — moved here from the frontend's
 * /api/help-ticket/slack route so the webhook and signing secret live only
 * in the backend's env, which the deploy workflow writes from GitHub
 * Secrets. The post carries a WhatsApp link to the customer's own number
 * with a message pre-filled, and — when SLACK_SIGNING_SECRET is set — a
 * "Mark resolved" button handled by /api/slack/interactions.
 */

export const RESOLVE_ACTION_ID = "help_ticket_resolve";

/** Fields the panel may send, as strings, capped. */
export const TICKET_FIELDS = {
  ticket: 40,
  issue: 200,
  note: 1000,
  customerName: 200,
  customerPhone: 40,
  packageName: 200,
  packageId: 100,
  bookingId: 300,
  emName: 100,
  details: 1000,
};

const clean = (s) => (typeof s === "string" && s.trim()) || null;

/** "98180 30600" / "+91-9818030600" → "919818030600"; null if it can't be a number. */
export function toWhatsAppNumber(phone) {
  let d = String(phone ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** What the Event Manager sends the customer. No issue → the fallback. */
export function buildCustomerMessage(t) {
  const name = clean(t.customerName)?.split(/\s+/)[0];
  const hi = name ? `Hi ${name},` : "Hi,";
  const em = clean(t.emName);
  const from = em ? `this is ${em.split(/\s+/)[0]} from Eventory` : "this is the Eventory team";
  const issue = clean(t.issue);
  if (!issue) {
    return `${hi} ${from}. We've received the help request you just raised and we're on it. Could you tell us a little more about what's going wrong so we can resolve it for you quickly?`;
  }
  const pkg = clean(t.packageName);
  const booking = clean(t.bookingId);
  return `${hi} ${from}. You raised a help request regarding "${issue}"${pkg ? ` for ${pkg}` : ""}${booking ? ` (Booking ${booking})` : ""}. We're on it — could you share a little more detail so we can resolve this for you quickly?`;
}

export function buildCustomerWhatsAppLink(t) {
  const number = toWhatsAppNumber(t.customerPhone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(buildCustomerMessage(t))}` : null;
}

// Slack mrkdwn treats &, < and > as control characters.
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `resolvable`: show "Mark resolved" — only once Slack interactivity is set up, else the click errors. */
export function buildSlackPayload(t, { resolvable = false } = {}) {
  const issue = clean(t.issue);
  const name = clean(t.customerName);
  const pkg = clean(t.packageName);
  const pkgId = clean(t.packageId);
  const booking = clean(t.bookingId);
  const note = clean(t.note);
  const ticket = clean(t.ticket);
  const link = buildCustomerWhatsAppLink(t);
  // Header blocks cap plain text at 150 chars.
  const title = `${t.urgent ? "🚨 URGENT" : "🆘 New help ticket"}${issue ? ` — ${issue}` : ""}${ticket ? ` · ${ticket}` : ""}`.slice(0, 150);
  const details = (clean(t.details) ?? "").split("\n").map((d) => d.trim()).filter(Boolean);
  const lines = [
    `*Customer:* ${name ? esc(name) : "—"}`,
    `*Mobile:* ${clean(t.customerPhone) ? esc(t.customerPhone.trim()) : "Not on file"}`,
    `*Package:* ${pkg ? esc(pkg) : "Not sure / the venue"}${pkgId ? `  (ID: \`${esc(pkgId)}\`)` : ""}`,
    ...(booking ? [`*Booking:* \`${esc(booking)}\``] : []),
    ...(clean(t.emName) ? [`*Event Manager:* ${esc(t.emName.trim())}`] : []),
    ...(note && note !== issue ? [`*Note:* ${esc(note)}`] : []),
    ...details.map((d) => `• ${esc(d)}`),
  ];
  const firstName = name?.split(/\s+/)[0] ?? "the customer";
  const buttons = [
    ...(link
      ? [{ type: "button", style: "primary", text: { type: "plain_text", text: `💬 Message ${firstName} on WhatsApp`, emoji: true }, url: link }]
      : []),
    ...(resolvable && ticket
      ? [
          {
            type: "button",
            action_id: RESOLVE_ACTION_ID,
            value: ticket,
            text: { type: "plain_text", text: "✅ Mark resolved", emoji: true },
            confirm: {
              title: { type: "plain_text", text: "Resolve this ticket?" },
              text: { type: "mrkdwn", text: `${esc(ticket)} moves to Resolved in the customer's chats.` },
              confirm: { type: "plain_text", text: "Resolve" },
              deny: { type: "plain_text", text: "Cancel" },
            },
          },
        ]
      : []),
  ];
  return {
    text: title,
    blocks: [
      { type: "header", text: { type: "plain_text", text: title, emoji: true } },
      ...(t.urgent ? [{ type: "section", text: { type: "mrkdwn", text: "*Duty manager, please pick this up now.*" } }] : []),
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
      ...(link ? [] : [{ type: "context", elements: [{ type: "mrkdwn", text: "No mobile number on file, so there's no WhatsApp link." }] }]),
      ...(buttons.length ? [{ type: "actions", elements: buttons }] : []),
    ],
  };
}
