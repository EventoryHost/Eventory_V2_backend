import express from "express";
import {
  getExceptionQueue,
  getExceptionQueueCount,
  getAllPending,
  getBookingDetails,
  reassignBooking,
  forceAccept,
  getStats,
  getAllBookings,
  getTodaysBookings
} from "../controllers/adminBookingController.js";

const router = express.Router();

router.get("/exception-queue", getExceptionQueue);
router.get("/exception-queue/count", getExceptionQueueCount);
router.get("/pending", getAllPending);
router.get("/stats", getStats);
router.get("/all", getAllBookings);
router.get("/today", getTodaysBookings);
router.get("/:bookingId", getBookingDetails);
router.put("/:bookingId/reassign", reassignBooking);
router.put("/:bookingId/force-accept", forceAccept);

export default router;
