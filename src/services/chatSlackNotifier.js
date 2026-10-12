import axios from "axios";

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
function isConfigured() {
  return Boolean(process.env.SLACK_CHAT_WEBHOOK_URL);
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

async function post(text) {
  if (!isConfigured()) {
    console.log(`[chatSlackNotifier] SLACK_CHAT_WEBHOOK_URL not set — skipping (would have posted):\n${text}`);
    return;
  }
  try {
    await axios.post(process.env.SLACK_CHAT_WEBHOOK_URL, { text });
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

/** @desc Help panel brief sent to the Event Manager team. */
export async function notifyHelpRequest(enquiry) {
  const reach =
    enquiry.replyMode === "call-me"
      ? `📞 *Call back:* ${enquiry.phoneNumber || "—"} (${enquiry.bestTimeToCall || "Anytime"})`
      : "💬 *Reply in the help chat* (customer chose Reply here)";
  const text =
    `🆘 *Help panel request ${enquiry.ticket || ""}* (enquiry ${enquiry.enquiryId})\n` +
    `${reach}\n` +
    `*Date:* ${enquiry.eventDateRaw || "Not given"}\n` +
    `${formatEnquiryBlock(enquiry)}\n` +
    `*Page:* ${enquiry.pageUrl || "—"}` +
    (enquiry.areaServed === false
      ? "\n⚠️ *Area not served yet* — check whether a vendor travels there."
      : "") +
    (enquiry.hasReferencePhoto
      ? "\n📷 *Has a reference photo* — not uploaded; ask the customer to share it on WhatsApp."
      : "") +
    (enquiry.transcript?.length ? `\n*Chat so far:*\n> ${enquiry.transcript.join("\n> ")}` : "");
  await post(text);
}

const istTime = (date) =>
  new Date(date).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });

/** @desc Help panel request with no reply after 30 min — for the team lead. */
export async function notifyHelpRequestLate(enquiry) {
  await post(
    `⚠️ *Help panel request ${enquiry.ticket || ""} waiting 30+ min* (enquiry ${enquiry.enquiryId}) — team lead, please pick this up.\n` +
      `${formatEnquiryBlock(enquiry)}`
  );
}

/** @desc Customer asked for a call back from the help panel thread. */
export async function notifyHelpCallBack(enquiry) {
  await post(
    `📞 *Call back requested ${enquiry.callBack.ticket || ""}* (request ${enquiry.ticket || enquiry.enquiryId})\n` +
      `*Phone:* ${enquiry.callBack.phone}\n*Call by:* ${istTime(enquiry.callBack.callBy)}\n` +
      `${formatEnquiryBlock(enquiry)}`
  );
}

/** @desc Out-of-area "Notify me" lead from the help panel. */
export async function notifyAreaWaitlist(entry) {
  const plan = [entry.occasion, entry.guests && `${entry.guests} guests`, entry.budget].filter(Boolean).join(" · ");
  await post(
    `📍 *Out-of-area lead:* ${entry.area}${entry.pincode ? ` (${entry.pincode})` : ""}` +
      `${entry.areaSource === "location_tag" ? " — from their location tag" : ""}\n` +
      `*Phone:* ${entry.phone}${entry.customerName ? ` · ${entry.customerName}` : ""}\n` +
      (plan ? `*Planning:* ${plan}\n` : "") +
      (entry.requestText ? `> ${entry.requestText}\n` : "") +
      `Wants one WhatsApp message when we start serving ${entry.area}.`
  );
}

/** @desc Customer wrote again in the help panel thread. */
export async function notifyHelpMessage(enquiry, text) {
  await post(`💬 *New message on help request ${enquiry.ticket || enquiry.enquiryId}*\n> ${text}`);
}

export default {
  notifyNewLead,
  notifyHandoffStarted,
  notifyFlowComplete,
  notifyHelpRequest,
  notifyHelpRequestLate,
  notifyHelpCallBack,
  notifyHelpMessage,
  notifyAreaWaitlist,
};
