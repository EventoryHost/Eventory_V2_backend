import express from "express";
import {
  getReviewQueue,
  getReviewQueueCount,
  getPackageDetails,
  approvePackage,
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
router.get("/:packageId", getPackageDetails);
router.put("/:packageId/approve", approvePackage);
router.put("/:packageId/request-fix", requestFix);
router.put("/:packageId/reject", rejectPackage);
router.put("/:packageId/status", updatePackageStatus);
router.put("/:packageId/review-step", reviewPackageStep);

export default router;
