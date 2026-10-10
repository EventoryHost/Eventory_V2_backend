import express from "express";
import { z } from "zod";
import { createVendorLead } from "../controllers/customerBecomeVendorController.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { vendorLeadLimiter } from "../middlewares/rateLimiters.js";

// Public — no protectCustomer requirement. The "Contact Us" form on the
// Become a Vendor page is filled out by a prospective vendor who isn't a
// customer account at all, same "works for an anonymous visitor by design"
// reasoning as customerChatRoutes.js.
const router = express.Router();

const becomeVendorLeadSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  vendorType: z.string().trim().min(1, "Vendor type is required").max(60),
  // Indian mobile number, digits only (the form's own fixed +91 prefix is
  // not part of this value) — same 10-digit shape used elsewhere in this
  // codebase for phone fields.
  phone: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit phone number"),
});

router.post("/leads", vendorLeadLimiter, validateRequest(becomeVendorLeadSchema), createVendorLead);

export default router;
