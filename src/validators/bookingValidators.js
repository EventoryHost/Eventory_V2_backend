import {
  PAYMENT_TYPES,
  MILESTONE_STATUSES,
  CHANGE_TYPES,
  ITEM_KINDS,
  CHANGE_REQUEST_STATUSES,
} from "../models/Booking.js";
import { ENQUIRY_PRIORITIES, MATCH_STRENGTHS } from "../models/Enquiry.js";

const PRICING_AMOUNT_FIELDS = [
  "itemsAdded",
  "addonsAdded",
  "itemsRemoved",
  "addonsRemoved",
  "discountAmount",
];

// ─── Shared field validators ────────────────────────────────
// Bookings and enquiries negotiate over the same shapes, so the rules for the
// vendor's decisions, pricing rows and instalment plan are written once.

const checkChangeRequestDecisions = (changeRequests, errors) => {
  if (!Array.isArray(changeRequests)) {
    errors.push("changeRequests must be an array");
    return;
  }
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
};

const checkPricing = (pricing, errors) => {
  if (typeof pricing !== "object" || pricing === null) {
    errors.push("pricing must be an object");
    return;
  }
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
};

const checkPaymentMilestones = (paymentMilestones, errors) => {
  if (!Array.isArray(paymentMilestones)) {
    errors.push("paymentMilestones must be an array");
    return;
  }
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
};

const checkAttachments = (attachments, field, errors) => {
  if (!Array.isArray(attachments)) {
    errors.push(`${field} must be an array`);
    return;
  }
  attachments.forEach((attachment, i) => {
    // A bare URL string is accepted and normalised by the controller.
    if (typeof attachment === "string") return;
    if (!attachment || typeof attachment !== "object") {
      errors.push(`${field}[${i}] must be a string or an object`);
      return;
    }
    if (typeof attachment.name !== "string" || !attachment.name.trim()) {
      errors.push(`${field}[${i}].name is required`);
    }
    if (
      attachment.sizeBytes !== undefined &&
      attachment.sizeBytes !== null &&
      (typeof attachment.sizeBytes !== "number" || attachment.sizeBytes < 0)
    ) {
      errors.push(`${field}[${i}].sizeBytes must be a number >= 0`);
    }
  });
};

// ─── Bookings ───────────────────────────────────────────────

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
    checkChangeRequestDecisions(changeRequests, errors);
  }
  if (pricing !== undefined) checkPricing(pricing, errors);
  if (paymentMilestones !== undefined) {
    checkPaymentMilestones(paymentMilestones, errors);
  }

  return { valid: errors.length === 0, errors };
};

// ─── Enquiries ──────────────────────────────────────────────

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

  if (
    body.guestCountMin !== undefined &&
    body.guestCountMax !== undefined &&
    Number(body.guestCountMin) > Number(body.guestCountMax)
  ) {
    errors.push("guestCountMin must be less than or equal to guestCountMax");
  }

  if (body.matchStrength != null && !MATCH_STRENGTHS.includes(body.matchStrength)) {
    errors.push(`matchStrength must be one of: ${MATCH_STRENGTHS.join(", ")}`);
  }

  if (body.priority != null && !ENQUIRY_PRIORITIES.includes(body.priority)) {
    errors.push(`priority must be one of: ${ENQUIRY_PRIORITIES.join(", ")}`);
  }

  if (body.attachments !== undefined) {
    checkAttachments(body.attachments, "attachments", errors);
  }

  // An empty array is a customer who requested no changes, not a mistake.
  const hasChanges = Array.isArray(body.changes)
    ? body.changes.length > 0
    : body.changes !== undefined;
  if (hasChanges) {
    errors.push(...validateChangeRequests(body).errors);
  }

  if (body.priceEnquiry !== undefined) {
    const { answers } = body.priceEnquiry ?? {};
    if (answers !== undefined) {
      if (!Array.isArray(answers)) {
        errors.push("priceEnquiry.answers must be an array");
      } else {
        answers.forEach((answer, i) => {
          if (typeof answer?.question !== "string" || !answer.question.trim()) {
            errors.push(`priceEnquiry.answers[${i}].question is required`);
          }
        });
      }
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

/**
 * Validate the vendor's edits to an enquiry — the accept/reject decisions and
 * the pricing they were agreed at.
 */
export const validateEnquiryUpdate = (body) => {
  const errors = [];
  const { changeRequests, pricing, notes } = body;

  if (
    changeRequests === undefined &&
    pricing === undefined &&
    notes === undefined
  ) {
    return {
      valid: false,
      errors: ["nothing to update — send changeRequests, pricing or notes"],
    };
  }

  if (changeRequests !== undefined) {
    checkChangeRequestDecisions(changeRequests, errors);
  }
  if (pricing !== undefined) checkPricing(pricing, errors);

  return { valid: errors.length === 0, errors };
};

/**
 * Validate a proposal submission. Everything is optional except the shape:
 * a vendor can send a proposal that only re-prices the package, or one that
 * only adds custom add-ons.
 */
export const validateSendProposal = (body) => {
  const errors = [];
  const {
    customPrice,
    pricing,
    paymentMilestones,
    lineItems,
    customAddons,
    attachments,
    mediaUrls,
  } = body;

  if (
    customPrice !== undefined &&
    customPrice !== null &&
    (typeof customPrice !== "number" || customPrice < 0)
  ) {
    errors.push("customPrice must be a number >= 0");
  }

  if (pricing !== undefined) checkPricing(pricing, errors);

  if (paymentMilestones !== undefined) {
    checkPaymentMilestones(paymentMilestones, errors);
  }

  if (lineItems !== undefined && !Array.isArray(lineItems)) {
    errors.push("lineItems must be an array");
  }

  if (mediaUrls !== undefined && !Array.isArray(mediaUrls)) {
    errors.push("mediaUrls must be an array");
  }

  if (attachments !== undefined) {
    checkAttachments(attachments, "attachments", errors);
  }

  if (customAddons !== undefined) {
    if (!Array.isArray(customAddons)) {
      errors.push("customAddons must be an array");
    } else {
      customAddons.forEach((addon, i) => {
        if (typeof addon?.name !== "string" || !addon.name.trim()) {
          errors.push(`customAddons[${i}].name is required`);
        }
        if (
          addon?.qty !== undefined &&
          (typeof addon.qty !== "number" || addon.qty < 1)
        ) {
          errors.push(`customAddons[${i}].qty must be a number >= 1`);
        }
        if (
          addon?.price !== undefined &&
          (typeof addon.price !== "number" || addon.price < 0)
        ) {
          errors.push(`customAddons[${i}].price must be a number >= 0`);
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
};
