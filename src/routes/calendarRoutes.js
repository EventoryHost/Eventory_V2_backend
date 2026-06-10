import express from "express";
const router = express.Router();
import {
  getVendorSchedule,
  getCalendarOverview,
  createOfflineBooking,
  createHoliday,
  setDateAvailable,
  getBlockById,
  getVendorBlocks,
} from "../controllers/calendarController.js";

/**
 * @swagger
 * tags:
 *   name: Calendar
 *   description: |
 *     Vendor calendar management — view schedules, block dates for offline
 *     bookings, mark holidays, and manage date availability.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     CalendarBlock:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: Mongoose ObjectId
 *         vendorId:
 *           type: string
 *           description: ObjectId reference to the Vendor
 *         blockType:
 *           type: string
 *           enum: [OfflineBooking, Holiday]
 *         startDate:
 *           type: string
 *           format: date
 *         endDate:
 *           type: string
 *           format: date
 *         startTime:
 *           type: string
 *           description: "Time string, e.g. '04:00 AM' (OfflineBooking only)"
 *         endTime:
 *           type: string
 *           description: "Time string, e.g. '08:00 PM' (OfflineBooking only)"
 *         eventName:
 *           type: string
 *           description: "Name of the offline event (OfflineBooking only)"
 *         serviceType:
 *           type: string
 *           enum: [Caterer, Decorator, PAV, DJArtist, MakeupArtist, VenueProvider]
 *           description: "Vendor type for the offline event (OfflineBooking only)"
 *         description:
 *           type: string
 *         reason:
 *           type: string
 *           description: "Holiday reason (Holiday only)"
 *         isActive:
 *           type: boolean
 *           default: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

// ============================================================
//  VENDOR SCHEDULE & OVERVIEW
// ============================================================

/**
 * @swagger
 * /api/calendar/vendor/{vendorId}/schedule:
 *   get:
 *     summary: Get vendor schedule for a specific date
 *     description: |
 *       Returns all calendar blocks (offline bookings, holidays) for the given
 *       vendor on the specified date. Also returns a full list of all active blocks.
 *
 *       Used to power the "Today's Schedule" and "All Schedule" sections of the
 *       Calendar Home screen.
 *     tags: [Calendar]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *         description: The vendor ObjectId or custom ID (e.g. "VEN...")
 *       - in: query
 *         name: date
 *         required: false
 *         schema:
 *           type: string
 *           format: date
 *         description: "Date to query (YYYY-MM-DD). Defaults to today."
 *         example: "2026-04-02"
 *     responses:
 *       200:
 *         description: Schedule retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 date:
 *                   type: string
 *                   example: "2026-04-02"
 *                 todaySchedule:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: number
 *                     items:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/CalendarBlock'
 *                 allSchedule:
 *                   type: object
 *                   properties:
 *                     count:
 *                       type: number
 *                     items:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/CalendarBlock'
 *       404:
 *         description: Vendor not found
 *       500:
 *         description: Server error
 */
router.get("/vendor/:vendorId/schedule", getVendorSchedule);

/**
 * @swagger
 * /api/calendar/vendor/{vendorId}/overview:
 *   get:
 *     summary: Get calendar overview (dot indicators)
 *     description: |
 *       Returns a date-to-types map for rendering colored dot indicators on the
 *       calendar. Each date maps to an array of types present on that date:
 *       `OfflineBooking`, `Holiday`, `Booked`, `Conflict`.
 *
 *       - **OfflineBooking** (grey dot) — vendor blocked for an offline event
 *       - **Holiday** (yellow dot) — vendor marked as holiday
 *       - **Booked** (blue dot) — at least one package has status "Booked"
 *       - **Conflict** (red dot) — OfflineBooking AND Booked on the same date
 *
 *       Accepts either `month` + `year` OR `startDate` + `endDate` for multi-month ranges.
 *     tags: [Calendar]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *         description: "Month number (1-12)"
 *         example: 4
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: "Year (4-digit)"
 *         example: 2026
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: "Start of range (alternative to month/year)"
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: "End of range (alternative to month/year)"
 *     responses:
 *       200:
 *         description: Calendar overview retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 dates:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       type: string
 *                       enum: [OfflineBooking, Holiday, Booked, Conflict]
 *                   example:
 *                     "2026-04-02": ["OfflineBooking"]
 *                     "2026-04-10": ["Holiday"]
 *                     "2026-04-27": ["Booked", "OfflineBooking", "Conflict"]
 *       404:
 *         description: Vendor not found
 *       500:
 *         description: Server error
 */
router.get("/vendor/:vendorId/overview", getCalendarOverview);

// ============================================================
//  BLOCK CREATION
// ============================================================

/**
 * @swagger
 * /api/calendar/vendor/{vendorId}/block/offline:
 *   post:
 *     summary: Create an offline booking block
 *     description: |
 *       Blocks date(s) for an offline event. Creates a `CalendarBlock` with
 *       `blockType: "OfflineBooking"` and updates the `availabilityCalendar`
 *       of all matching vendor packages to "Blocked".
 *     tags: [Calendar]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [startDate, endDate, startTime, endTime, eventName, serviceType]
 *             properties:
 *               startDate:
 *                 type: string
 *                 format: date
 *                 example: "2026-04-10"
 *               endDate:
 *                 type: string
 *                 format: date
 *                 example: "2026-04-13"
 *               startTime:
 *                 type: string
 *                 example: "01:20 AM"
 *               endTime:
 *                 type: string
 *                 example: "04:01 PM"
 *               eventName:
 *                 type: string
 *                 example: "Haldi Event"
 *               serviceType:
 *                 type: string
 *                 enum: [Caterer, Decorator, PAV, DJArtist, MakeupArtist, VenueProvider]
 *                 example: "Decorator"
 *               description:
 *                 type: string
 *                 example: "Sharma ji ki beti ka haldi event"
 *     responses:
 *       201:
 *         description: Offline booking block created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 message:
 *                   type: string
 *                 block:
 *                   $ref: '#/components/schemas/CalendarBlock'
 *                 affectedPackages:
 *                   type: number
 *                   description: "Number of packages whose availability was updated"
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Vendor not found
 *       500:
 *         description: Server error
 */
router.post("/vendor/:vendorId/block/offline", createOfflineBooking);

/**
 * @swagger
 * /api/calendar/vendor/{vendorId}/block/holiday:
 *   post:
 *     summary: Mark date(s) as holiday
 *     description: |
 *       Creates holiday block(s) for the vendor.
 *
 *       **Single/range holiday**: Omit `recurringDays` to create one block
 *       spanning the full date range.
 *
 *       **Recurring holiday**: Provide `recurringDays` (e.g. `["Sun"]`) to
 *       create individual blocks for each matching day within the range.
 *       For example, `recurringDays: ["Sun"]` with April 1–30 creates 4–5
 *       blocks, one per Sunday.
 *
 *       Updates `availabilityCalendar` of all vendor packages to "Blocked"
 *       on affected dates.
 *     tags: [Calendar]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [startDate, endDate]
 *             properties:
 *               startDate:
 *                 type: string
 *                 format: date
 *                 example: "2026-04-11"
 *               endDate:
 *                 type: string
 *                 format: date
 *                 example: "2026-04-11"
 *               reason:
 *                 type: string
 *                 example: "Sick leave"
 *               recurringDays:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
 *                 description: "Optional. Day names for recurring holidays."
 *                 example: ["Sun"]
 *           examples:
 *             single_holiday:
 *               summary: "Mark a single day as holiday"
 *               value:
 *                 startDate: "2026-04-11"
 *                 endDate: "2026-04-11"
 *                 reason: "Sick leave"
 *             recurring_holiday:
 *               summary: "Mark every Sunday in April as holiday"
 *               value:
 *                 startDate: "2026-04-01"
 *                 endDate: "2026-04-30"
 *                 reason: "Weekly off"
 *                 recurringDays: ["Sun"]
 *     responses:
 *       201:
 *         description: Holiday block(s) created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 message:
 *                   type: string
 *                 blocks:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CalendarBlock'
 *                 count:
 *                   type: number
 *                   description: "Number of blocks created"
 *                 affectedPackages:
 *                   type: number
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Vendor not found
 *       500:
 *         description: Server error
 */
router.post("/vendor/:vendorId/block/holiday", createHoliday);

// ============================================================
//  BLOCK MANAGEMENT
// ============================================================

/**
 * @swagger
 * /api/calendar/block/{blockId}/unblock:
 *   put:
 *     summary: Set a blocked date as available
 *     description: |
 *       Deactivates a calendar block (`isActive: false`) and reverts the
 *       affected packages' `availabilityCalendar` entries back to "Available"
 *       — but only for dates not covered by another active block.
 *     tags: [Calendar]
 *     parameters:
 *       - in: path
 *         name: blockId
 *         required: true
 *         schema:
 *           type: string
 *         description: "The CalendarBlock ObjectId"
 *     responses:
 *       200:
 *         description: Date set as available
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 message:
 *                   type: string
 *                 block:
 *                   $ref: '#/components/schemas/CalendarBlock'
 *                 affectedPackages:
 *                   type: number
 *       400:
 *         description: Block is already inactive
 *       404:
 *         description: Block not found
 *       500:
 *         description: Server error
 */
router.put("/block/:blockId/unblock", setDateAvailable);

/**
 * @swagger
 * /api/calendar/block/{blockId}:
 *   get:
 *     summary: Get a single calendar block by ID
 *     description: Returns the full CalendarBlock document.
 *     tags: [Calendar]
 *     parameters:
 *       - in: path
 *         name: blockId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Block found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 block:
 *                   $ref: '#/components/schemas/CalendarBlock'
 *       404:
 *         description: Block not found
 *       500:
 *         description: Server error
 */
router.get("/block/:blockId", getBlockById);

/**
 * @swagger
 * /api/calendar/vendor/{vendorId}/blocks:
 *   get:
 *     summary: Get all blocks for a vendor (filtered, paginated)
 *     description: |
 *       Returns a paginated list of all active calendar blocks for the vendor.
 *       Supports filtering by blockType and date range.
 *     tags: [Calendar]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: blockType
 *         schema:
 *           type: string
 *           enum: [OfflineBooking, Holiday]
 *         description: "Filter by block type"
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: "Filter blocks that end on or after this date"
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: "Filter blocks that start on or before this date"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Blocks retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 count:
 *                   type: number
 *                 total:
 *                   type: number
 *                 page:
 *                   type: number
 *                 totalPages:
 *                   type: number
 *                 blocks:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CalendarBlock'
 *       404:
 *         description: Vendor not found
 *       500:
 *         description: Server error
 */
router.get("/vendor/:vendorId/blocks", getVendorBlocks);

export default router;
