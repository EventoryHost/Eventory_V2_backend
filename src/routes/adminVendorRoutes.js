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
  assignEmToVendor,
  getSearchSuggestions,
  reviewVendorStep,
  editVendorStep,
  approveVendorGroup,
  requestVendorGroupChanges,
  rejectVendorGroup,
  getVerificationHistory,
  setVendorVisibility,
  initiateVendorPayout,
} from "../controllers/adminVendorController.js";
import {
  searchGoogleBusinesses,
  getGoogleBusinessPlace,
  resolveGoogleBusinessLink,
  getVendorGoogleBusiness,
  unlinkVendorGoogleBusiness,
  adminListPendingGoogleBusiness,
  adminLinkGoogleBusiness,
  adminApproveGoogleBusiness,
  adminRejectGoogleBusiness,
} from "../controllers/googleBusinessController.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import {
  googleBusinessSearchQuerySchema,
  googleBusinessPlaceQuerySchema,
  googleBusinessLinkSchema,
  googleBusinessResolveLinkSchema,
} from "../validators/googleBusinessValidators.js";

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
router.put("/:id/visibility", setVendorVisibility);
router.post("/:id/payout", initiateVendorPayout);

router.get("/google-business/pending", adminListPendingGoogleBusiness);
router.get(
  "/google-business/search",
  validateRequest(googleBusinessSearchQuerySchema, "query"),
  searchGoogleBusinesses
);
router.get(
  "/google-business/places/:placeId",
  validateRequest(googleBusinessPlaceQuerySchema, "query"),
  getGoogleBusinessPlace
);
router.post(
  "/google-business/resolve-link",
  validateRequest(googleBusinessResolveLinkSchema),
  resolveGoogleBusinessLink
);
router
  .route("/:id/google-business")
  .get(getVendorGoogleBusiness)
  .put(validateRequest(googleBusinessLinkSchema), adminLinkGoogleBusiness)
  .delete(unlinkVendorGoogleBusiness);
router.put("/:id/google-business/approve", adminApproveGoogleBusiness);
router.put("/:id/google-business/reject", adminRejectGoogleBusiness);

export default router;
