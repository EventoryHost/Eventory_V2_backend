import express from "express";
import {
  getRules,
  getRuleVersion,
  createRuleDraft,
  updateRuleDraft,
  activateRuleSet,
  seedRules,
  getPackageCommercial,
  updatePackageCommercial,
  reviewPackageGroup,
  getVendorCommercial,
  updateVendorCommercial,
  setVendorTierOverride,
  refreshVendorTierNow,
  refreshAllTiers,
  getPriceReviewQueue,
  getCommercialAnalytics,
  simulateEngine,
} from "../controllers/adminCommercialController.js";

const router = express.Router();

// Rule sets (versioned; one ACTIVE)
router.get("/rules", getRules);
router.post("/rules", createRuleDraft);
router.post("/rules/seed", seedRules);
router.get("/rules/:version", getRuleVersion);
router.put("/rules/:version", updateRuleDraft);
router.post("/rules/:version/activate", activateRuleSet);

// Engine simulator (hand-entered inputs, optional rule override; writes nothing)
router.post("/simulate", simulateEngine);

// Price-review queue and booking economics
router.get("/review-queue", getPriceReviewQueue);
router.get("/analytics", getCommercialAnalytics);

// Package commercial review
router.post("/packages/group/:packageGroupId/review", reviewPackageGroup);
router.get("/packages/:packageId", getPackageCommercial);
router.put("/packages/:packageId", updatePackageCommercial);

// Vendor demand / tier / trial
router.post("/vendors/refresh-all", refreshAllTiers);
router.get("/vendors/:vendorId", getVendorCommercial);
router.put("/vendors/:vendorId", updateVendorCommercial);
router.put("/vendors/:vendorId/tier-override", setVendorTierOverride);
router.post("/vendors/:vendorId/refresh-tier", refreshVendorTierNow);

export default router;
