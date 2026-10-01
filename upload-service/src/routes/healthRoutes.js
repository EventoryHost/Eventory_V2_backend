import express from "express";

import { checkBucketAccess } from "../services/uploadService.js";

const router = express.Router();

router.get("/", (req, res) => {
  res.status(200).json({ success: true, service: "upload-service", uptime: Math.round(process.uptime()) });
});

router.get("/ready", async (req, res, next) => {
  try {
    await checkBucketAccess();
    res.status(200).json({ success: true, buckets: "reachable" });
  } catch (error) {
    next(error);
  }
});

export default router;
