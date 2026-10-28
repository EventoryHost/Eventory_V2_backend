import express from "express";
import {
  getHelpRequestThread,
  listAreaWaitlist,
  listHelpRequests,
  replyToHelpRequest,
  setHelpRequestStatus,
} from "../controllers/adminHelpRequestController.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { helpRequestReplySchema, helpRequestStatusSchema } from "../validators/customerHelpValidators.js";

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

export default router;
