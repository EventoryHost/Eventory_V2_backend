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
  getTodaysBookings,
  assignEmToBooking,
  updateBooking,
} from "../controllers/adminBookingController.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { adminUpdateBookingSchema } from "../validators/adminBookingValidators.js";

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
router.put("/:bookingId/assign-em", assignEmToBooking);
// Full admin edit — registered after the action routes above.
router.put("/:bookingId", validateRequest(adminUpdateBookingSchema, "body"), updateBooking);

export default router;
