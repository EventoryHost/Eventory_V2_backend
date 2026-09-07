import express from "express";
import {
  getReviewQueue,
  getReviewQueueCount,
  getPackageDetails,
  approvePackage,
  raiseAction,
  reviewItem,
  deleteReviewItem,
  requestFix,
  rejectPackage,
  getPackageGroup,
  getAllPackages,
  updatePackageStatus,
  reviewPackageStep,
} from "../controllers/adminPackageController.js";

const router = express.Router();

router.get("/review-queue", getReviewQueue);
router.get("/review-queue/count", getReviewQueueCount);
router.get("/all", getAllPackages);
router.get("/group/:packageGroupId", getPackageGroup);

// A review decision applies to the whole package. These are the endpoints the
// EM panel should call; the per-packageId ones below resolve to the same group.
router.put("/group/:packageGroupId/approve", approvePackage);
router.put("/group/:packageGroupId/review-item", reviewItem);
router.delete("/group/:packageGroupId/review-item/:itemId", deleteReviewItem);
router.put("/group/:packageGroupId/raise-action", raiseAction);
router.put("/group/:packageGroupId/request-fix", requestFix);
router.put("/group/:packageGroupId/reject", rejectPackage);

router.get("/:packageId", getPackageDetails);
router.put("/:packageId/approve", approvePackage);
router.put("/:packageId/review-item", reviewItem);
router.delete("/:packageId/review-item/:itemId", deleteReviewItem);
router.put("/:packageId/raise-action", raiseAction);
router.put("/:packageId/request-fix", requestFix);
router.put("/:packageId/reject", rejectPackage);
router.put("/:packageId/status", updatePackageStatus);
router.put("/:packageId/review-step", reviewPackageStep);

export default router;
