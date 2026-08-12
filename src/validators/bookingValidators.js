import {
  PAYMENT_TYPES,
  MILESTONE_STATUSES,
  CHANGE_TYPES,
  ITEM_KINDS,
  CHANGE_REQUEST_STATUSES,
} from "../models/Booking.js";

/**
 * Validate booking creation payload.
 */
export const validateCreateBooking = (body) => {
  const errors = [];

  if (!body.customer || !body.customer.name || !body.customer.name.trim()) {
    errors.push("customer.name is required");
  }

  if (!body.packageId) {
    errors.push("packageId is required");
  }

  if (!body.eventDate) {
    errors.push("eventDate is required");
  } else if (isNaN(new Date(body.eventDate).getTime())) {
    errors.push("eventDate is not a valid date");
  }

  if (!body.startTime) errors.push("startTime is required");
  if (!body.endTime) errors.push("endTime is required");

  if (!body.paymentType) {
    errors.push("paymentType is required");
  } else if (!PAYMENT_TYPES.includes(body.paymentType)) {
    errors.push(`paymentType must be one of: ${PAYMENT_TYPES.join(", ")}`);
  }

  if (body.guestRange) {
    const { min, max } = body.guestRange;
    if (min !== undefined && max !== undefined && Number(min) > Number(max)) {
      errors.push("guestRange.min must be less than or equal to guestRange.max");
    }
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Validate enquiry creation payload.
 */
export const validateCreateEnquiry = (body) => {
  const errors = [];

  if (!body.customer || !body.customer.name || !body.customer.name.trim()) {
    errors.push("customer.name is required");
  }

  if (!body.eventDate) {
    errors.push("eventDate is required");
  } else if (isNaN(new Date(body.eventDate).getTime())) {
    errors.push("eventDate is not a valid date");
  }

  if (
    body.budgetMin !== undefined &&
    body.budgetMax !== undefined &&
    body.budgetMin > body.budgetMax
  ) {
    errors.push("budgetMin must be less than or equal to budgetMax");
  }

  return { valid: errors.length === 0, errors };
};

export const validateChangeRequests = (body) => {
  const errors = [];
  const changes = body.changes;

  if (!Array.isArray(changes) || changes.length === 0) {
    return { valid: false, errors: ["changes must be a non-empty array"] };
  }

  changes.forEach((change, i) => {
    if (!change || typeof change !== "object") {
      errors.push(`changes[${i}] must be an object`);
      return;
    }

    if (!CHANGE_TYPES.includes(change.changeType)) {
      errors.push(`changes[${i}].changeType must be one of: ${CHANGE_TYPES.join(", ")}`);
    }

    if (typeof change.category !== "string" || !change.category.trim()) {
      errors.push(`changes[${i}].category is required`);
    }

    if (typeof change.item !== "string" || !change.item.trim()) {
      errors.push(`changes[${i}].item is required`);
    }

    if (change.itemKind !== undefined && !ITEM_KINDS.includes(change.itemKind)) {
      errors.push(`changes[${i}].itemKind must be one of: ${ITEM_KINDS.join(", ")}`);
    }

    if (
      change.qty !== undefined &&
      (typeof change.qty !== "number" || change.qty < 1)
    ) {
      errors.push(`changes[${i}].qty must be a number >= 1`);
    }
  });

  return { valid: errors.length === 0, errors };
};

const PRICING_AMOUNT_FIELDS = [
  "itemsAdded",
  "addonsAdded",
  "substituteItemsAdded",
  "itemsRemoved",
  "addonsRemoved",
  "discountAmount",
];

export const validateBookingUpdate = (body) => {
  const errors = [];
  const { changeRequests, pricing, paymentMilestones, calendarNote } = body;

  if (
    changeRequests === undefined &&
    pricing === undefined &&
    paymentMilestones === undefined &&
    calendarNote === undefined
  ) {
    return {
      valid: false,
      errors: [
        "nothing to update — send changeRequests, pricing, paymentMilestones or calendarNote",
      ],
    };
  }

  if (changeRequests !== undefined) {
    if (!Array.isArray(changeRequests)) {
      errors.push("changeRequests must be an array");
    } else {
      changeRequests.forEach((decision, i) => {
        if (!decision?.id) {
          errors.push(`changeRequests[${i}].id is required`);
        }
        if (
          decision?.status !== undefined &&
          !CHANGE_REQUEST_STATUSES.includes(decision.status)
        ) {
          errors.push(
            `changeRequests[${i}].status must be one of: ${CHANGE_REQUEST_STATUSES.join(", ")}`
          );
        }
        if (
          decision?.qty !== undefined &&
          (typeof decision.qty !== "number" || decision.qty < 1)
        ) {
          errors.push(`changeRequests[${i}].qty must be a number >= 1`);
        }
      });
    }
  }

  if (pricing !== undefined) {
    if (typeof pricing !== "object" || pricing === null) {
      errors.push("pricing must be an object");
    } else {
      if (
        pricing.basePrice !== undefined &&
        pricing.basePrice !== null &&
        (typeof pricing.basePrice !== "number" || pricing.basePrice < 0)
      ) {
        errors.push("pricing.basePrice must be a number >= 0");
      }
      for (const field of PRICING_AMOUNT_FIELDS) {
        if (
          pricing[field] !== undefined &&
          (typeof pricing[field] !== "number" || pricing[field] < 0)
        ) {
          errors.push(`pricing.${field} must be a number >= 0`);
        }
      }
      if (
        pricing.taxRatePct !== undefined &&
        (typeof pricing.taxRatePct !== "number" ||
          pricing.taxRatePct < 0 ||
          pricing.taxRatePct > 100)
      ) {
        errors.push("pricing.taxRatePct must be a number between 0 and 100");
      }
    }
  }

  if (paymentMilestones !== undefined) {
    if (!Array.isArray(paymentMilestones)) {
      errors.push("paymentMilestones must be an array");
    } else {
      const seen = new Set();
      paymentMilestones.forEach((milestone, i) => {
        const title = milestone?.title?.trim();
        if (!title) {
          errors.push(`paymentMilestones[${i}].title is required`);
        } else if (seen.has(title.toLowerCase())) {
          errors.push(`paymentMilestones[${i}].title "${title}" is duplicated`);
        } else {
          seen.add(title.toLowerCase());
        }

        if (typeof milestone?.amount !== "number" || milestone.amount < 0) {
          errors.push(`paymentMilestones[${i}].amount must be a number >= 0`);
        }

        if (
          milestone?.percentage !== undefined &&
          milestone.percentage !== null &&
          (typeof milestone.percentage !== "number" ||
            milestone.percentage < 0 ||
            milestone.percentage > 100)
        ) {
          errors.push(
            `paymentMilestones[${i}].percentage must be a number between 0 and 100`
          );
        }

        if (
          milestone?.status !== undefined &&
          !MILESTONE_STATUSES.includes(milestone.status)
        ) {
          errors.push(
            `paymentMilestones[${i}].status must be one of: ${MILESTONE_STATUSES.join(", ")}`
          );
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
};
