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
} from "../controllers/adminVendorController.js";

const router = express.Router();

router.get("/review-queue", getReviewQueue);
router.get("/review-queue/count", getReviewQueueCount);
router.get("/all", getAllVendors);
router.get("/:id", getVendorDetails);
router.put("/:id/verify", verifyVendor);
router.put("/:id/reject", rejectVendor);
router.put("/:id/request-changes", requestChanges);
router.put("/:id/review-section", reviewSection);

export default router;
