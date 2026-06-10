import CalendarBlock from "../models/CalendarBlock.js";
import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";
import {
  validateOfflineBooking,
  validateHoliday,
} from "../validators/calendarValidators.js";

// ─── Helpers ────────────────────────────────────────────────

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Resolve a human-readable vendor ID (e.g. "VEN...") to a MongoDB ObjectId.
 * Returns { _id, vendorDoc } or throws.
 */
const resolveVendorId = async (vendorId) => {
  if (typeof vendorId === "string" && vendorId.startsWith("VEN")) {
    const vendorDoc = await Vendor.findOne({ id: vendorId });
    if (!vendorDoc) return null;
    return vendorDoc._id;
  }
  return vendorId;
};

/**
 * Enumerate every date between start and end (inclusive) as Date objects at midnight UTC.
 */
const enumerateDates = (start, end) => {
  const dates = [];
  const current = new Date(start);
  current.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setUTCHours(0, 0, 0, 0);

  while (current <= endDate) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
};

/**
 * Sync Package.availabilityCalendar — mark dates as Blocked for all matching
 * packages owned by the vendor.
 * If serviceType is provided, only packages of that vendorType are affected.
 * Returns count of affected packages.
 */
const syncPackageAvailability = async (
  vendorId,
  dates,
  status,
  serviceType = null
) => {
  const query = { vendorId };
  if (serviceType) query.vendorType = serviceType;

  const packages = await Package.find(query);
  let affected = 0;

  for (const pkg of packages) {
    let changed = false;

    for (const date of dates) {
      const dateStr = date.toISOString().split("T")[0];
      const existing = pkg.availabilityCalendar.find((entry) => {
        const entryDate = new Date(entry.date);
        return entryDate.toISOString().split("T")[0] === dateStr;
      });

      if (existing) {
        if (existing.status !== status) {
          existing.status = status;
          changed = true;
        }
      } else {
        pkg.availabilityCalendar.push({ date, status });
        changed = true;
      }
    }

    if (changed) {
      await pkg.save();
      affected++;
    }
  }

  return affected;
};

/**
 * Before reverting a date to "Available", check that no OTHER active block
 * still covers that date for this vendor. Returns only the dates that are
 * truly free.
 */
const filterFreeDates = async (vendorId, dates, excludeBlockId) => {
  const freeDates = [];

  for (const date of dates) {
    const overlapping = await CalendarBlock.findOne({
      vendorId,
      isActive: true,
      _id: { $ne: excludeBlockId },
      startDate: { $lte: date },
      endDate: { $gte: date },
    });

    if (!overlapping) {
      freeDates.push(date);
    }
  }

  return freeDates;
};

// ─── Controllers ────────────────────────────────────────────

/**
 * @desc    Get vendor schedule for a specific date
 * @route   GET /api/calendar/vendor/:vendorId/schedule?date=2026-04-02
 */
export const getVendorSchedule = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { date } = req.query;

    const actualVendorId = await resolveVendorId(vendorId);
    if (!actualVendorId) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Vendor not found" });
    }

    // Default to today if no date provided
    const queryDate = date ? new Date(date) : new Date();
    queryDate.setUTCHours(0, 0, 0, 0);

    // Blocks that cover the queried date
    const todayBlocks = await CalendarBlock.find({
      vendorId: actualVendorId,
      isActive: true,
      startDate: { $lte: queryDate },
      endDate: { $gte: queryDate },
    }).sort({ startTime: 1 });

    // All active blocks (limited, sorted by upcoming first)
    const allBlocks = await CalendarBlock.find({
      vendorId: actualVendorId,
      isActive: true,
    })
      .sort({ startDate: 1 })
      .limit(50);

    return res.status(200).json({
      status: "SUCCESS",
      date: queryDate.toISOString().split("T")[0],
      todaySchedule: {
        count: todayBlocks.length,
        items: todayBlocks,
      },
      allSchedule: {
        count: allBlocks.length,
        items: allBlocks,
      },
    });
  } catch (error) {
    console.error("Get Vendor Schedule Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch vendor schedule",
      error: error.message,
    });
  }
};

/**
 * @desc    Get calendar overview (date → block types map) for dot indicators
 * @route   GET /api/calendar/vendor/:vendorId/overview?month=4&year=2026
 *          OR  /api/calendar/vendor/:vendorId/overview?startDate=2026-04-01&endDate=2026-06-30
 */
export const getCalendarOverview = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { month, year, startDate: qStart, endDate: qEnd } = req.query;

    const actualVendorId = await resolveVendorId(vendorId);
    if (!actualVendorId) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Vendor not found" });
    }

    // Determine date range
    let rangeStart, rangeEnd;
    if (qStart && qEnd) {
      rangeStart = new Date(qStart);
      rangeEnd = new Date(qEnd);
    } else if (month && year) {
      rangeStart = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, 1));
      rangeEnd = new Date(Date.UTC(parseInt(year), parseInt(month), 0)); // last day of month
    } else {
      // Default to current month
      const now = new Date();
      rangeStart = new Date(
        Date.UTC(now.getFullYear(), now.getMonth(), 1)
      );
      rangeEnd = new Date(
        Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)
      );
    }
    rangeStart.setUTCHours(0, 0, 0, 0);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    // Fetch active blocks overlapping the range
    const blocks = await CalendarBlock.find({
      vendorId: actualVendorId,
      isActive: true,
      startDate: { $lte: rangeEnd },
      endDate: { $gte: rangeStart },
    });

    // Fetch package availability (Booked entries) in range
    const packages = await Package.find({ vendorId: actualVendorId });
    const bookedDates = new Set();
    for (const pkg of packages) {
      for (const entry of pkg.availabilityCalendar || []) {
        if (entry.status === "Booked") {
          const entryDate = new Date(entry.date);
          if (entryDate >= rangeStart && entryDate <= rangeEnd) {
            bookedDates.add(entryDate.toISOString().split("T")[0]);
          }
        }
      }
    }

    // Build date map
    const dateMap = {};

    for (const block of blocks) {
      const dates = enumerateDates(
        block.startDate < rangeStart ? rangeStart : block.startDate,
        block.endDate > rangeEnd ? rangeEnd : block.endDate
      );
      for (const d of dates) {
        const key = d.toISOString().split("T")[0];
        if (!dateMap[key]) dateMap[key] = new Set();
        dateMap[key].add(block.blockType);
      }
    }

    // Add Booked entries and detect conflicts
    for (const dateStr of bookedDates) {
      if (!dateMap[dateStr]) dateMap[dateStr] = new Set();
      dateMap[dateStr].add("Booked");

      // Conflict = OfflineBooking + Booked on same date
      if (dateMap[dateStr].has("OfflineBooking")) {
        dateMap[dateStr].add("Conflict");
      }
    }

    // Convert Sets to arrays for JSON serialization
    const serializedMap = {};
    for (const [key, value] of Object.entries(dateMap)) {
      serializedMap[key] = [...value];
    }

    return res.status(200).json({
      status: "SUCCESS",
      month: month ? parseInt(month) : undefined,
      year: year ? parseInt(year) : undefined,
      dates: serializedMap,
    });
  } catch (error) {
    console.error("Get Calendar Overview Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch calendar overview",
      error: error.message,
    });
  }
};

/**
 * @desc    Create an offline booking block
 * @route   POST /api/calendar/vendor/:vendorId/block/offline
 */
export const createOfflineBooking = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { startDate, endDate, startTime, endTime, eventName, serviceType, description } = req.body;

    // Validate
    const validation = validateOfflineBooking(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        status: "FAILED",
        message: "Validation failed",
        errors: validation.errors,
      });
    }

    const actualVendorId = await resolveVendorId(vendorId);
    if (!actualVendorId) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Vendor not found" });
    }

    const block = new CalendarBlock({
      vendorId: actualVendorId,
      blockType: "OfflineBooking",
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      startTime,
      endTime,
      eventName: eventName.trim(),
      serviceType,
      description: description ? description.trim() : null,
    });

    await block.save();

    // Sync package availability
    const dates = enumerateDates(block.startDate, block.endDate);
    const affectedPackages = await syncPackageAvailability(
      actualVendorId,
      dates,
      "Blocked",
      serviceType
    );

    return res.status(201).json({
      status: "SUCCESS",
      message: "Offline booking block created",
      block,
      affectedPackages,
    });
  } catch (error) {
    console.error("Create Offline Booking Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to create offline booking block",
      error: error.message,
    });
  }
};

/**
 * @desc    Create a holiday block (single or recurring)
 * @route   POST /api/calendar/vendor/:vendorId/block/holiday
 */
export const createHoliday = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { startDate, endDate, reason, recurringDays } = req.body;

    // Validate
    const validation = validateHoliday(req.body);
    if (!validation.valid) {
      return res.status(400).json({
        status: "FAILED",
        message: "Validation failed",
        errors: validation.errors,
      });
    }

    const actualVendorId = await resolveVendorId(vendorId);
    if (!actualVendorId) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Vendor not found" });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const allDates = enumerateDates(start, end);
    const createdBlocks = [];

    if (recurringDays && recurringDays.length > 0) {
      // Expand: create one block per matching date
      for (const date of allDates) {
        const dayName = DAY_NAMES[date.getUTCDay()];
        if (recurringDays.includes(dayName)) {
          const block = new CalendarBlock({
            vendorId: actualVendorId,
            blockType: "Holiday",
            startDate: date,
            endDate: date,
            reason: reason ? reason.trim() : null,
          });
          await block.save();
          createdBlocks.push(block);
        }
      }
    } else {
      // Single block for the full range
      const block = new CalendarBlock({
        vendorId: actualVendorId,
        blockType: "Holiday",
        startDate: start,
        endDate: end,
        reason: reason ? reason.trim() : null,
      });
      await block.save();
      createdBlocks.push(block);
    }

    // Sync package availability — block all vendor packages for affected dates
    const affectedDates =
      recurringDays && recurringDays.length > 0
        ? allDates.filter((d) =>
            recurringDays.includes(DAY_NAMES[d.getUTCDay()])
          )
        : allDates;

    const affectedPackages = await syncPackageAvailability(
      actualVendorId,
      affectedDates,
      "Blocked"
    );

    return res.status(201).json({
      status: "SUCCESS",
      message: "Holiday block(s) created",
      blocks: createdBlocks,
      count: createdBlocks.length,
      affectedPackages,
    });
  } catch (error) {
    console.error("Create Holiday Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to create holiday block",
      error: error.message,
    });
  }
};

/**
 * @desc    Unblock a date (set block as inactive, revert package availability)
 * @route   PUT /api/calendar/block/:blockId/unblock
 */
export const setDateAvailable = async (req, res) => {
  try {
    const { blockId } = req.params;

    const block = await CalendarBlock.findById(blockId);
    if (!block) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Block not found" });
    }

    if (!block.isActive) {
      return res
        .status(400)
        .json({ status: "FAILED", message: "Block is already inactive" });
    }

    block.isActive = false;
    await block.save();

    // Revert package availability — only for dates not covered by other active blocks
    const allDates = enumerateDates(block.startDate, block.endDate);
    const freeDates = await filterFreeDates(block.vendorId, allDates, block._id);

    let affectedPackages = 0;
    if (freeDates.length > 0) {
      affectedPackages = await syncPackageAvailability(
        block.vendorId,
        freeDates,
        "Available",
        block.serviceType
      );
    }

    return res.status(200).json({
      status: "SUCCESS",
      message: "Date set as available",
      block,
      affectedPackages,
    });
  } catch (error) {
    console.error("Set Date Available Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to set date as available",
      error: error.message,
    });
  }
};

/**
 * @desc    Get a single block by ID
 * @route   GET /api/calendar/block/:blockId
 */
export const getBlockById = async (req, res) => {
  try {
    const { blockId } = req.params;
    const block = await CalendarBlock.findById(blockId);

    if (!block) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Block not found" });
    }

    return res.status(200).json({ status: "SUCCESS", block });
  } catch (error) {
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch block",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all blocks for a vendor (filtered, paginated)
 * @route   GET /api/calendar/vendor/:vendorId/blocks?blockType=Holiday&startDate=...&endDate=...&page=1&limit=20
 */
export const getVendorBlocks = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const {
      blockType,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = req.query;

    const actualVendorId = await resolveVendorId(vendorId);
    if (!actualVendorId) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Vendor not found" });
    }

    const query = { vendorId: actualVendorId, isActive: true };

    if (blockType) query.blockType = blockType;
    if (startDate || endDate) {
      if (startDate) query.endDate = { $gte: new Date(startDate) };
      if (endDate)
        query.startDate = {
          ...query.startDate,
          $lte: new Date(endDate),
        };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [blocks, total] = await Promise.all([
      CalendarBlock.find(query)
        .sort({ startDate: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      CalendarBlock.countDocuments(query),
    ]);

    return res.status(200).json({
      status: "SUCCESS",
      count: blocks.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      blocks,
    });
  } catch (error) {
    console.error("Get Vendor Blocks Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch vendor blocks",
      error: error.message,
    });
  }
};
