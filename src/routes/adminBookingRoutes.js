import express from "express";
import {
  getExceptionQueue,
  getExceptionQueueCount,
  getAllPending,
  getBookingDetails,
  getStats,
  getAllBookings,
  getTodaysBookings,
  assignEmToBooking,
  updateBooking,
  updateRefundStatus,
} from "../controllers/adminBookingController.js";
import {
  createAdminBooking,
  acknowledgeBooking,
  declineBooking,
  cancelBooking,
  respondToRequests,
  changeBookingDetails,
  reassignBooking,
  completeBooking,
  eventDayStep,
  setGroundContact,
  removeGroundContact,
  addDayRequest,
  updateDayRequest,
  updateIssue,
} from "../controllers/adminBookingOpsController.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import {
  adminUpdateBookingSchema,
  adminCreateBookingSchema,
  adminRespondSchema,
  adminChangeDetailsSchema,
  adminDeclineSchema,
  adminCancelSchema,
  adminReassignSchema,
  adminCompleteSchema,
  adminEventDayStepSchema,
  adminGroundContactSchema,
  adminDayRequestSchema,
  adminDayRequestUpdateSchema,
  adminIssueUpdateSchema,
} from "../validators/adminBookingValidators.js";

const router = express.Router();
const body = (schema) => validateRequest(schema, "body");

router.get("/exception-queue", getExceptionQueue);
router.get("/exception-queue/count", getExceptionQueueCount);
router.get("/pending", getAllPending);
router.get("/stats", getStats);
router.get("/all", getAllBookings);
router.get("/today", getTodaysBookings);
router.get("/:bookingId", getBookingDetails);

// The admin books a package for a customer.
router.post("/", body(adminCreateBookingSchema), createAdminBooking);

// Workflow actions on the vendor's or the customer's behalf
// (adminBookingOpsController.js). All accept the EVT... id or the Mongo _id.
router.put("/:bookingId/acknowledge", acknowledgeBooking);
router.put("/:bookingId/force-accept", acknowledgeBooking); // older admin screens
router.put("/:bookingId/decline", body(adminDeclineSchema), declineBooking);
router.put("/:bookingId/cancel", body(adminCancelSchema), cancelBooking);
router.post("/:bookingId/respond", body(adminRespondSchema), respondToRequests);
router.put("/:bookingId/details", body(adminChangeDetailsSchema), changeBookingDetails);
router.put("/:bookingId/reassign", body(adminReassignSchema), reassignBooking);
router.put("/:bookingId/complete", body(adminCompleteSchema), completeBooking);

// Event day
router.put("/:bookingId/event-day/ground-contact", body(adminGroundContactSchema), setGroundContact);
router.delete("/:bookingId/event-day/ground-contact", removeGroundContact);
router.post("/:bookingId/event-day/:step", body(adminEventDayStepSchema), eventDayStep);
router.post("/:bookingId/day-requests", body(adminDayRequestSchema), addDayRequest);
router.post(
  "/:bookingId/day-requests/:requestId/update",
  body(adminDayRequestUpdateSchema),
  updateDayRequest
);
router.put("/:bookingId/issues/:issueId", body(adminIssueUpdateSchema), updateIssue);

router.put("/:bookingId/assign-em", assignEmToBooking);
// The team processes a cancellation refund: { status: "started" | "completed", amount? }.
router.put("/:bookingId/refund", updateRefundStatus);
// Full admin edit — registered after the action routes above.
router.put("/:bookingId", body(adminUpdateBookingSchema), updateBooking);

export default router;
