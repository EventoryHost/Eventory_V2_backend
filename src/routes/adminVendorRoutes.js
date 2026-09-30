import express from "express";
import {
  getReviewQueue,
  getReviewQueueCount,
  getVendorDetails,
  verifyVendor,
  rejectVendor,
  requestChanges,
  getAllVendors,
  reviewSection,
  makePayout,
  getPayoutHistory,
  assignEmToVendor,
  getSearchSuggestions,
  reviewVendorStep,
  editVendorStep,
  approveVendorGroup,
  requestVendorGroupChanges,
  rejectVendorGroup,
  getVerificationHistory,
} from "../controllers/adminVendorController.js";

const router = express.Router();

router.get("/review-queue", getReviewQueue);
router.get("/review-queue/count", getReviewQueueCount);
router.get("/all", getAllVendors);
// Before "/:id" so it isn't read as a vendor id.
router.get("/search-suggestions", getSearchSuggestions);
router.get("/:id", getVendorDetails);
router.put("/:id/verify", verifyVendor);
router.put("/:id/reject", rejectVendor);
router.put("/:id/request-changes", requestChanges);
router.put("/:id/review-section", reviewSection); // legacy, until the admin panel ships step review
router.put("/:id/review-step", reviewVendorStep);
router.put("/:id/edit-step/:stepKey", editVendorStep);
router.put("/:id/groups/:group/approve", approveVendorGroup);
router.put("/:id/groups/:group/request-changes", requestVendorGroupChanges);
router.put("/:id/groups/:group/reject", rejectVendorGroup);
router.get("/:id/verification-history", getVerificationHistory);
router.put("/:id/assign-em", assignEmToVendor);
router.post("/:id/payout", makePayout);
router.get("/:id/payout-history", getPayoutHistory);

export default router;
