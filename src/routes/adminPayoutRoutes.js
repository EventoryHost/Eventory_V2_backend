import express from "express";
import { listPayouts, recordPayout, createPayout } from "../controllers/adminPayoutController.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { adminRecordPayoutSchema, adminCreatePayoutSchema } from "../validators/adminBookingValidators.js";

const router = express.Router();

// Vendor payout register — payouts are made offline and recorded here
// (see adminPayoutController.js). No money moves through these routes.
router.get("/", listPayouts);
router.post("/", validateRequest(adminCreatePayoutSchema, "body"), createPayout);
router.post("/:transactionId/record", validateRequest(adminRecordPayoutSchema, "body"), recordPayout);

export default router;
