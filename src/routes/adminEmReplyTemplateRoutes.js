import express from "express";
import {
  createEmReplyTemplate,
  deleteEmReplyTemplate,
  listEmReplyTemplates,
  updateEmReplyTemplate,
  useEmReplyTemplate,
} from "../controllers/adminEmReplyTemplateController.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import {
  emTemplateCreateSchema,
  emTemplateListSchema,
  emTemplateOwnerSchema,
  emTemplateUpdateSchema,
} from "../validators/emReplyTemplateValidators.js";

const router = express.Router();

/**
 * Mounted at /api/admin/em-reply-templates (src/routes/index.js). An Event
 * Manager's saved replies for the Help & Support inbox, by V1 em_id. Same
 * access model as the other /api/admin routers.
 */
router.get("/", validateRequest(emTemplateListSchema, "query"), listEmReplyTemplates);
router.post("/", validateRequest(emTemplateCreateSchema), createEmReplyTemplate);
router.put("/:id", validateRequest(emTemplateUpdateSchema), updateEmReplyTemplate);
router.delete("/:id", validateRequest(emTemplateOwnerSchema, "query"), deleteEmReplyTemplate);
router.post("/:id/use", validateRequest(emTemplateOwnerSchema), useEmReplyTemplate);

export default router;
