import ChatEnquiry from "../models/ChatEnquiry.js";
import AreaWaitlist from "../models/AreaWaitlist.js";
import HelpMessage from "../models/HelpMessage.js";
import {
  checkLate,
  loadTicketMessages,
  recordTicketMessage,
  serializeHelpRequest,
} from "../services/helpRequestService.js";

/**
 * Event Manager side of the help panel hand-off. The brief arrives on
 * Slack (chatSlackNotifier.notifyHelpRequest); these endpoints let the
 * team read open requests and reply into the customer's help thread, which
 * the panel polls (GET /api/customer/chat/help-request/:enquiryId).
 */

/** A ticket for the team: the panel's view plus who raised it and the brief. */
async function adminView(e) {
  const late = await checkLate(e);
  return {
    ...serializeHelpRequest(e, { late, messages: await loadTicketMessages(e) }),
    conversationId: e.conversationId,
    customerId: e.customerId,
    anonId: e.anonId,
    customer: e.customer,
    status: e.ticketStatus ?? (e.firstReplyAt ? "replied" : "open"),
    lastMessageAt: e.lastMessageAt,
    lastMessageFrom: e.lastMessageFrom,
    messageCount: e.messageCount,
    brief: {
      occasion: e.eventType,
      guests: e.guestCount,
      budget: e.budgetRange,
      vendorType: e.servicesNeeded?.[0] ?? null,
      area: e.city,
      date: e.eventDateRaw,
      phone: e.phoneNumber,
      callTime: e.bestTimeToCall,
      customerName: e.customerName,
      pageUrl: e.pageUrl,
      hasReferencePhoto: e.hasReferencePhoto,
      areaServed: e.areaServed,
      transcript: e.transcript,
    },
  };
}

// "TKT-1042" or the enquiry id — Slack shows both.
const ticketFilter = (ref) => ({ source: "help_panel", $or: [{ enquiryId: ref }, { ticket: ref }] });

/**
 * @desc Help panel tickets, newest first. ?open=true → no reply yet;
 * ?customerId= / ?anonId= → one person's tickets; ?status=open|replied|closed.
 * @route GET /api/admin/help-requests
 */
export const listHelpRequests = async (req, res) => {
  try {
    const filter = { source: "help_panel" };
    if (req.query.open === "true") filter.firstReplyAt = null;
    if (req.query.customerId) filter.customerId = String(req.query.customerId);
    if (req.query.anonId) filter.anonId = String(req.query.anonId);
    if (req.query.status) filter.ticketStatus = String(req.query.status);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const enquiries = await ChatEnquiry.find(filter).sort({ createdAt: -1 }).limit(limit);
    const requests = await Promise.all(enquiries.map(adminView));
    return res.json({ success: true, requests });
  } catch (error) {
    console.error("listHelpRequests error:", error);
    return res.status(500).json({ success: false, message: "Could not load help requests" });
  }
};

/**
 * @desc One ticket with its whole chat: every message from the start —
 * the assistant part before the brief, then the ticket thread.
 * @route GET /api/admin/help-requests/:enquiryId (enquiry id or "TKT-…")
 */
export const getHelpRequestThread = async (req, res) => {
  try {
    const enquiry = await ChatEnquiry.findOne(ticketFilter(req.params.enquiryId));
    if (!enquiry) return res.status(404).json({ success: false, message: "Request not found" });
    const chat = enquiry.conversationId
      ? await HelpMessage.find({ conversationId: enquiry.conversationId }).sort({ sentAt: 1, createdAt: 1 }).lean()
      : [];
    return res.json({
      success: true,
      request: await adminView(enquiry),
      conversation: chat.map((m) => ({
        messageId: m.messageId,
        role: m.role,
        senderId: m.senderId,
        senderName: m.senderName,
        text: m.text,
        hasPhoto: m.hasPhoto,
        ticket: m.ticket,
        sentAt: m.sentAt,
      })),
    });
  } catch (error) {
    console.error("getHelpRequestThread error:", error);
    return res.status(500).json({ success: false, message: "Could not load the request" });
  }
};

/**
 * @desc An Event Manager replies in the customer's help thread — the same
 * chat the ticket was raised in. Saved first; the panel picks it up on its
 * next poll. The first reply clears the status card on the customer's side.
 * @route POST /api/admin/help-requests/:enquiryId/reply (enquiry id or "TKT-…")
 */
export const replyToHelpRequest = async (req, res) => {
  try {
    const enquiry = await ChatEnquiry.findOne(ticketFilter(req.params.enquiryId));
    if (!enquiry) return res.status(404).json({ success: false, message: "Request not found" });
    const saved = await recordTicketMessage(enquiry, {
      role: "event_manager",
      text: req.body.text,
      senderId: req.body.senderId ?? null,
      senderName: req.body.senderName,
      via: "admin",
    });
    await ChatEnquiry.updateOne({ _id: enquiry._id, firstReplyAt: null }, { $set: { firstReplyAt: saved.sentAt } });
    return res.status(201).json({
      success: true,
      message: {
        messageId: saved.messageId,
        from: "event_manager",
        senderName: saved.senderName,
        text: saved.text,
        sentAt: saved.sentAt,
      },
    });
  } catch (error) {
    console.error("replyToHelpRequest error:", error);
    return res.status(500).json({ success: false, message: "Could not send the reply" });
  }
};

/**
 * @desc The team resolves a ticket (or reopens it). Resolved tickets move
 * to Resolved in the customer's Your chats and are never flagged late.
 * @route POST /api/admin/help-requests/:enquiryId/status (enquiry id or "TKT-…")
 */
export const setHelpRequestStatus = async (req, res) => {
  try {
    const enquiry = await ChatEnquiry.findOne(ticketFilter(req.params.enquiryId));
    if (!enquiry) return res.status(404).json({ success: false, message: "Request not found" });
    const closing = req.body.status === "closed";
    enquiry.ticketStatus = closing ? "closed" : enquiry.firstReplyAt ? "replied" : "open";
    enquiry.resolvedAt = closing ? new Date() : null;
    await enquiry.save();
    return res.json({ success: true, request: await adminView(enquiry) });
  } catch (error) {
    console.error("setHelpRequestStatus error:", error);
    return res.status(500).json({ success: false, message: "Could not update the request" });
  }
};

/**
 * @desc Out-of-area "Notify me" leads, newest first, with a count per area
 * — who to message once Eventory reaches each one. ?area= filters (case-
 * insensitive), ?pending=true hides people already messaged.
 * @route GET /api/admin/help-requests/area-waitlist
 */
export const listAreaWaitlist = async (req, res) => {
  try {
    const filter = {};
    if (req.query.area) filter.areaKey = String(req.query.area).trim().toLowerCase();
    if (req.query.pending === "true") filter.notifiedAt = null;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const [entries, byArea] = await Promise.all([
      AreaWaitlist.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      AreaWaitlist.aggregate([
        { $match: { notifiedAt: null } },
        { $group: { _id: "$areaKey", area: { $first: "$area" }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);
    return res.json({
      success: true,
      byArea: byArea.map(({ area, count }) => ({ area, count })),
      entries,
    });
  } catch (error) {
    console.error("listAreaWaitlist error:", error);
    return res.status(500).json({ success: false, message: "Could not load the waitlist" });
  }
};
