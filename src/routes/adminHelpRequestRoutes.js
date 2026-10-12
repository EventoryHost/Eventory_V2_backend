import express from "express";
import { listAreaWaitlist, listHelpRequests, replyToHelpRequest } from "../controllers/adminHelpRequestController.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { helpRequestReplySchema } from "../validators/customerHelpValidators.js";

const router = express.Router();

/**
 * Mounted at /api/admin/help-requests (src/routes/index.js). Same access
 * model as the other /api/admin routers.
 */
router.get("/", listHelpRequests);
router.get("/area-waitlist", listAreaWaitlist);
router.post("/:enquiryId/reply", validateRequest(helpRequestReplySchema), replyToHelpRequest);

export default router;
