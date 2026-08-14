import express from "express";
import {
  getAllTemplates,
  getTemplateStats,
  getTemplateDetails,
  deleteTemplate,
  toggleTemplateLive
} from "../controllers/adminTemplateController.js";

const router = express.Router();

router.get("/stats", getTemplateStats);
router.get("/", getAllTemplates);
router.get("/:id", getTemplateDetails);
router.put("/:id/toggle-live", toggleTemplateLive);
router.delete("/:id", deleteTemplate);

export default router;
