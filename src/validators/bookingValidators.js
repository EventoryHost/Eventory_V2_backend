const VALID_PAYMENT_TYPES = ["FreeBooking", "AdvancePaid", "FullPaid"];
const VALID_MILESTONE_TYPES = ["Token", "Advanced1", "Advanced2", "FinalClearance"];
const VALID_BILLING_UNITS = ["Per Event", "Per Hour", "Per Day", "Per Guest"];
const VALID_LINE_ITEM_TYPES = ["Base", "Addon", "Fee", "Discount", "Tax"];

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
 * Validate customize package payload. All fields are optional (idempotent update).
 */
export const validateCustomizePackage = (body) => {
  const errors = [];

  if (body.packageName !== undefined && (typeof body.packageName !== "string" || !body.packageName.trim())) {
    errors.push("packageName must be a non-empty string");
  }

  if (body.basePrice !== undefined && (typeof body.basePrice !== "number" || body.basePrice < 0)) {
    errors.push("basePrice must be a number >= 0");
  }

  if (body.billingUnit !== undefined && !VALID_BILLING_UNITS.includes(body.billingUnit)) {
    errors.push(`billingUnit must be one of: ${VALID_BILLING_UNITS.join(", ")}`);
  }

  if (body.lineItems !== undefined) {
    if (!Array.isArray(body.lineItems)) {
      errors.push("lineItems must be an array");
    } else {
      body.lineItems.forEach((item, i) => {
        if (!item || typeof item.label !== "string" || !item.label.trim()) {
          errors.push(`lineItems[${i}].label is required`);
        }
        if (!item || typeof item.amount !== "number" || item.amount < 0) {
          errors.push(`lineItems[${i}].amount must be a number >= 0`);
        }
        if (item && item.type !== undefined && !VALID_LINE_ITEM_TYPES.includes(item.type)) {
          errors.push(`lineItems[${i}].type must be one of: ${VALID_LINE_ITEM_TYPES.join(", ")}`);
        }
      });
    }
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
