import ChatEnquiry from "../models/ChatEnquiry.js";
import AreaWaitlist from "../models/AreaWaitlist.js";
import { generateISTId } from "../utils/idGenerator.js";
import { checkLate, serializeHelpRequest } from "../services/helpRequestService.js";

/**
 * Event Manager side of the help panel hand-off. The brief arrives on
 * Slack (chatSlackNotifier.notifyHelpRequest); these endpoints let the
 * team read open requests and reply into the customer's help thread, which
 * the panel polls (GET /api/customer/chat/help-request/:enquiryId).
 */

/**
 * @desc Help panel requests, newest first. ?open=true → no reply yet.
 * @route GET /api/admin/help-requests
 */
export const listHelpRequests = async (req, res) => {
  try {
    const filter = { source: "help_panel" };
    if (req.query.open === "true") filter.firstReplyAt = null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const enquiries = await ChatEnquiry.find(filter).sort({ createdAt: -1 }).limit(limit);
    const requests = await Promise.all(
      enquiries.map(async (e) => ({
        ...serializeHelpRequest(e, { late: await checkLate(e) }),
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
      }))
    );
    return res.json({ success: true, requests });
  } catch (error) {
    console.error("listHelpRequests error:", error);
    return res.status(500).json({ success: false, message: "Could not load help requests" });
  }
};

/**
 * @desc An Event Manager replies in the customer's help thread. The first
 * reply clears the status card on the customer's side.
 * @route POST /api/admin/help-requests/:enquiryId/reply (enquiry id or "TKT-…")
 */
export const replyToHelpRequest = async (req, res) => {
  try {
    const now = new Date();
    const message = {
      messageId: generateISTId("HMSG"),
      from: "event_manager",
      senderName: req.body.senderName,
      text: req.body.text,
      sentAt: now,
    };
    const enquiry = await ChatEnquiry.findOneAndUpdate(
      // Either id works: Slack shows both the ticket and the enquiry id.
      {
        source: "help_panel",
        $or: [{ enquiryId: req.params.enquiryId }, { ticket: req.params.enquiryId }],
      },
      { $push: { helpMessages: message } }
    );
    if (!enquiry) return res.status(404).json({ success: false, message: "Request not found" });
    await ChatEnquiry.updateOne({ _id: enquiry._id, firstReplyAt: null }, { $set: { firstReplyAt: now } });
    return res.status(201).json({ success: true, message });
  } catch (error) {
    console.error("replyToHelpRequest error:", error);
    return res.status(500).json({ success: false, message: "Could not send the reply" });
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
