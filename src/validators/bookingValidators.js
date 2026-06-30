const VALID_PAYMENT_TYPES = ["FreeBooking", "AdvancePaid", "FullPaid"];
const VALID_MILESTONE_TYPES = ["Token", "Advanced1", "Advanced2", "FinalClearance"];

/**
 * Validate booking creation payload.
 */
export const validateCreateBooking = (body) => {
  const errors = [];

  // Customer
  if (!body.customer || !body.customer.name || !body.customer.name.trim()) {
    errors.push("customer.name is required");
  }

  // Package
  if (!body.packageId) {
    errors.push("packageId is required");
  }

  // Event date
  if (!body.eventDate) {
    errors.push("eventDate is required");
  } else if (isNaN(new Date(body.eventDate).getTime())) {
    errors.push("eventDate is not a valid date");
  }

  // Times
  if (!body.startTime) errors.push("startTime is required");
  if (!body.endTime) errors.push("endTime is required");

  // Payment type
  if (!body.paymentType) {
    errors.push("paymentType is required");
  } else if (!VALID_PAYMENT_TYPES.includes(body.paymentType)) {
    errors.push(
      `paymentType must be one of: ${VALID_PAYMENT_TYPES.join(", ")}`
    );
  }

  // Guest range (optional)
  if (body.guestRange) {
    const { min, max } = body.guestRange;
    if (min !== undefined && max !== undefined && Number(min) > Number(max)) {
      errors.push("guestRange.min must be less than or equal to guestRange.max");
    }
  }

  // Charges breakdown (optional)
  if (body.charges !== undefined) {
    if (!Array.isArray(body.charges)) {
      errors.push("charges must be an array");
    } else {
      body.charges.forEach((charge, i) => {
        if (!charge || typeof charge.label !== "string" || !charge.label.trim()) {
          errors.push(`charges[${i}].label is required`);
        }
        if (charge && typeof charge.amount !== "number") {
          errors.push(`charges[${i}].amount must be a number`);
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate enquiry creation payload.
 */
export const validateCreateEnquiry = (body) => {
  const errors = [];

  // Customer
  if (!body.customer || !body.customer.name || !body.customer.name.trim()) {
    errors.push("customer.name is required");
  }

  // Event date
  if (!body.eventDate) {
    errors.push("eventDate is required");
  } else if (isNaN(new Date(body.eventDate).getTime())) {
    errors.push("eventDate is not a valid date");
  }

  // Budget range
  if (
    body.budgetMin !== undefined &&
    body.budgetMax !== undefined &&
    body.budgetMin > body.budgetMax
  ) {
    errors.push("budgetMin must be less than or equal to budgetMax");
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate milestone status update payload.
 */
export const validateMilestoneUpdate = (body) => {
  const errors = [];

  if (!body.milestoneType) {
    errors.push("milestoneType is required");
  } else if (!VALID_MILESTONE_TYPES.includes(body.milestoneType)) {
    errors.push(
      `milestoneType must be one of: ${VALID_MILESTONE_TYPES.join(", ")}`
    );
  }

  if (!body.status) {
    errors.push("status is required (Received, PaymentDue, or Pending)");
  }

  return { valid: errors.length === 0, errors };
};
