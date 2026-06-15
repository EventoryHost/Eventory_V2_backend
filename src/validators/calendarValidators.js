const VALID_SERVICE_TYPES = [
  "Caterer",
  "Decorator",
  "PAV",
  "DJArtist",
  "MakeupArtist",
  "VenueProvider",
];

const VALID_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Validate date range — endDate must be >= startDate and both must be valid dates.
 */
const validateDateRange = (startDate, endDate) => {
  const errors = [];

  if (!startDate) errors.push("startDate is required");
  if (!endDate) errors.push("endDate is required");

  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime())) errors.push("startDate is not a valid date");
    if (isNaN(end.getTime())) errors.push("endDate is not a valid date");

    if (!errors.length && end < start) {
      errors.push("endDate must be greater than or equal to startDate");
    }
  }

  return errors;
};

/**
 * Validate offline booking block creation.
 * Requires: startDate, endDate, startTime, endTime, eventName, serviceType.
 */
export const validateOfflineBooking = (body) => {
  const errors = [];

  // Date range
  errors.push(...validateDateRange(body.startDate, body.endDate));

  // Time fields
  if (!body.startTime) errors.push("startTime is required");
  if (!body.endTime) errors.push("endTime is required");

  // Event details
  if (!body.eventName || !body.eventName.trim()) {
    errors.push("eventName is required");
  }

  if (!body.serviceType) {
    errors.push("serviceType is required");
  } else if (!VALID_SERVICE_TYPES.includes(body.serviceType)) {
    errors.push(
      `serviceType must be one of: ${VALID_SERVICE_TYPES.join(", ")}`
    );
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate holiday block creation.
 * Requires: startDate, endDate. Optional: reason, recurringDays.
 */
export const validateHoliday = (body) => {
  const errors = [];

  // Date range
  errors.push(...validateDateRange(body.startDate, body.endDate));

  // Recurring days (optional)
  if (body.recurringDays) {
    if (!Array.isArray(body.recurringDays)) {
      errors.push("recurringDays must be an array");
    } else {
      const invalid = body.recurringDays.filter(
        (d) => !VALID_DAY_NAMES.includes(d)
      );
      if (invalid.length) {
        errors.push(
          `Invalid day name(s): ${invalid.join(", ")}. Valid values: ${VALID_DAY_NAMES.join(", ")}`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
};
