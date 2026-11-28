import express from "express";
import {
  assignHelpRequest,
  getHelpRequestThread,
  listAreaWaitlist,
  listHelpRequests,
  replyToHelpRequest,
  setHelpRequestStatus,
} from "../controllers/adminHelpRequestController.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import {
  helpRequestAssignSchema,
  helpRequestReplySchema,
  helpRequestStatusSchema,
} from "../validators/customerHelpValidators.js";

const router = express.Router();

/**
 * Mounted at /api/admin/help-requests (src/routes/index.js). Same access
 * model as the other /api/admin routers.
 */
router.get("/", listHelpRequests);
router.get("/area-waitlist", listAreaWaitlist);
router.get("/:enquiryId", getHelpRequestThread);
router.post("/:enquiryId/reply", validateRequest(helpRequestReplySchema), replyToHelpRequest);
// { status: "closed" } resolves the ticket (Your chats → Resolved); "open" reopens it.
router.post("/:enquiryId/status", validateRequest(helpRequestStatusSchema), setHelpRequestStatus);
// { emId, emName } assigns the ticket to an Event Manager; an empty emId clears it.
router.put("/:enquiryId/assign-em", validateRequest(helpRequestAssignSchema), assignHelpRequest);

export default router;
