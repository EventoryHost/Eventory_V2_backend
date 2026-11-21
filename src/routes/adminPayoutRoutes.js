import express from "express";
import { listPayouts, approvePayout, reopenPayout } from "../controllers/adminPayoutController.js";

const router = express.Router();

// Vendor payout queue (Transaction due records) — see adminPayoutController.js.
router.get("/", listPayouts);
router.post("/:transactionId/approve", approvePayout);
router.put("/:transactionId/reopen", reopenPayout);

export default router;
