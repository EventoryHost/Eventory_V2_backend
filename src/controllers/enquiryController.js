import Enquiry, {
  ENQUIRY_STATUSES,
  PRE_PROPOSAL_STATUSES,
  TERMINAL_ENQUIRY_STATUSES,
} from "../models/Enquiry.js";
import Booking, { PAYMENT_TYPES } from "../models/Booking.js";
import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";
import CalendarBlock from "../models/CalendarBlock.js";
import { generateISTId } from "../utils/idGenerator.js";
import { snapshotDeliverables } from "../utils/packageDeliverables.js";
import {
  applyPricingBreakdown,
  withPricingBreakdown,
} from "../utils/pricingBreakdown.js";
import {
  validateCreateEnquiry,
  validateChangeRequests,
  validateEnquiryUpdate,
  validateSendProposal,
} from "../validators/bookingValidators.js";

// ─── Constants ──────────────────────────────────────────────

/** Default vendor response window when the caller does not supply one. */
const RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────

/**
 * Look an enquiry up by either its human-readable enquiryId (ENQ...) or its
 * MongoDB _id.
 */
const findEnquiry = async (enquiryId) =>
  enquiryId.startsWith("ENQ")
    ? Enquiry.findOne({ enquiryId })
    : Enquiry.findById(enquiryId);

const notFound = (res, message) =>
  res.status(404).json({ status: "FAILED", message });

const invalid = (res, errors) =>
  res
    .status(400)
    .json({ status: "FAILED", message: "Validation failed", errors });

const failed = (res, message, error) => {
  console.error(`${message}:`, error);
  return res.status(500).json({ status: "ERROR", message, error: error.message });
};

const terminal = (res, enquiry, verb) =>
  res.status(400).json({
    status: "FAILED",
    message: `Cannot ${verb} an enquiry with status "${enquiry.status}".`,
  });

/**
 * Check if a date has conflicts for the vendor (live bookings or calendar
 * blocks). Returns true if conflicting.
 */
const detectConflict = async (vendorId, eventDate) => {
  if (!eventDate) return false;

  const dateStart = new Date(eventDate);
  dateStart.setUTCHours(0, 0, 0, 0);
  const dateEnd = new Date(eventDate);
  dateEnd.setUTCHours(23, 59, 59, 999);

  const [otherBooking, calendarBlock] = await Promise.all([
    Booking.findOne({
      vendorId,
      eventDate: { $gte: dateStart, $lte: dateEnd },
      status: { $in: ["NewBooking", "Viewed", "InDiscussion", "Confirmed"] },
    }),
    CalendarBlock.findOne({
      vendorId,
      isActive: true,
      startDate: { $lte: dateEnd },
      endDate: { $gte: dateStart },
    }),
  ]);

  return !!(otherBooking || calendarBlock);
};

/**
 * Attachments may arrive as bare URLs from older clients. Normalise both forms
 * to the stored shape so the list can be rendered without fetching each file.
 */
const normaliseAttachments = (attachments) => {
  if (!Array.isArray(attachments)) return [];
  return attachments.map((attachment) => {
    if (typeof attachment === "string") {
      return {
        name: attachment.split("/").pop() || attachment,
        url: attachment,
      };
    }
    return {
      name: attachment.name.trim(),
      url: attachment.url ?? null,
      contentType: attachment.contentType ?? null,
      sizeBytes: attachment.sizeBytes ?? null,
    };
  });
};

/** Freeze a package onto the enquiry the same way a booking freezes it. */
const snapshotPackage = (pkg) => ({
  name: pkg.step1_eventAndCrew?.packageName || "Untitled Package",
  price: pkg.step3_policiesAndCharges?.packagePricing?.price || 0,
  image: pkg.step4_sampleMedia?.media?.[0]?.url || null,
  vendorType: pkg.vendorType || null,
  variantType: pkg.variantType || "Premium",
  gstRatePercent: pkg.step3_policiesAndCharges?.gstRatePercent ?? null,
  gstInclusive: pkg.step3_policiesAndCharges?.gstInclusive ?? false,
  deliverables: snapshotDeliverables(pkg),
});

/**
 * Shape an enquiry for the wire: the derived pricing breakdown, plus the
 * `primaryPackage` the package snapshot replaced, so clients reading the older
 * field keep working.
 */
const withEnquiryDetails = (enquiry) => {
  const plain = withPricingBreakdown(enquiry);
  if (!plain) return plain;
  const snapshot = plain.packageSnapshot;
  return {
    ...plain,
    primaryPackage: snapshot
      ? { name: snapshot.name, price: snapshot.price, image: snapshot.image }
      : null,
  };
};

/** A customer-side change is what opens the discussion, as on a booking. */
const markInDiscussion = (enquiry) => {
  if (PRE_PROPOSAL_STATUSES.includes(enquiry.status)) {
    enquiry.status = "InDiscussion";
  }
};

// ─── Controllers ────────────────────────────────────────────

/**
 * @desc    Create a new enquiry
 * @route   POST /api/enquiries/vendor/:vendorId
 */
export const createEnquiry = async (req, res) => {
  try {
    const { vendorId } = req.params;

    const validation = validateCreateEnquiry(req.body);
    if (!validation.valid) return invalid(res, validation.errors);

    if (!(await Vendor.exists({ id: vendorId }))) {
      return notFound(res, "Vendor not found");
    }

    let pkg = null;
    if (req.body.packageId) {
      pkg = await Package.findById(req.body.packageId);
      if (!pkg) return notFound(res, "Package not found");
    }

    const enquiry = new Enquiry({
      enquiryId: generateISTId("ENQ"),
      vendorId,
      vendorType: req.body.vendorType || pkg?.vendorType || null,
      customer: {
        name: req.body.customer.name.trim(),
        phone: req.body.customer.phone || null,
        email: req.body.customer.email || null,
      },
      eventType: req.body.eventType || null,
      eventDate: req.body.eventDate ? new Date(req.body.eventDate) : null,
      startTime: req.body.startTime || null,
      endTime: req.body.endTime || null,
      location: req.body.location || null,
      mapLink: req.body.mapLink || null,
      budgetMin: req.body.budgetMin ?? null,
      budgetMax: req.body.budgetMax ?? null,
      requests: req.body.requests || [],
      matchStrength: req.body.matchStrength || null,
      notes: req.body.notes || null,
      receivedAt: new Date(),
      respondByAt: req.body.respondByAt
        ? new Date(req.body.respondByAt)
        : new Date(Date.now() + RESPONSE_WINDOW_MS),
      venueName: req.body.venueName || null,
      guestCountMin: req.body.guestCountMin ?? null,
      guestCountMax: req.body.guestCountMax ?? null,
      mealType: req.body.mealType || null,
      specialInstructions: req.body.specialInstructions || [],
      customerMessage: req.body.customerMessage || null,
      packageId: pkg?._id ?? null,
      packageSnapshot: pkg ? snapshotPackage(pkg) : null,
      attachments: normaliseAttachments(req.body.attachments),
      priority: req.body.priority || null,
      eventImageUrl: req.body.eventImageUrl || null,
      changeRequests: (req.body.changes || []).map((change) => ({
        changeType: change.changeType,
        itemKind: change.itemKind ?? "Item",
        category: change.category?.trim(),
        item: change.item?.trim(),
        qty: change.qty ?? 1,
        status: "Pending",
        requestedAt: new Date(),
      })),
      priceEnquiry: req.body.priceEnquiry
        ? {
            answers: req.body.priceEnquiry.answers || [],
            customerNote: req.body.priceEnquiry.customerNote || null,
          }
        : undefined,
      pricing: {
        basePrice: req.body.basePrice ?? null,
        taxRatePct:
          req.body.taxRatePct ??
          pkg?.step3_policiesAndCharges?.gstRatePercent ??
          undefined,
      },
    });

    applyPricingBreakdown(enquiry);
    await enquiry.save();

    const conflictDetected = await detectConflict(vendorId, enquiry.eventDate);

    return res.status(201).json({
      status: "SUCCESS",
      message: "Enquiry created",
      enquiry: withEnquiryDetails(enquiry),
      conflictDetected,
    });
  } catch (error) {
    return failed(res, "Failed to create enquiry", error);
  }
};

/**
 * @desc    Get vendor enquiries (filtered, paginated)
 * @route   GET /api/enquiries/vendor/:vendorId?status=NewEnquiry&page=1&limit=20
 */
export const getVendorEnquiries = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { status, page = 1, limit = 20 } = req.query;

    const query = { vendorId };
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [enquiries, total] = await Promise.all([
      Enquiry.find(query)
        .sort({ receivedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Enquiry.countDocuments(query),
    ]);

    const results = [];
    for (const enquiry of enquiries) {
      results.push({
        ...withEnquiryDetails(enquiry),
        conflictDetected: await detectConflict(vendorId, enquiry.eventDate),
      });
    }

    return res.status(200).json({
      status: "SUCCESS",
      count: results.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      enquiries: results,
    });
  } catch (error) {
    return failed(res, "Failed to fetch vendor enquiries", error);
  }
};

/**
 * @desc    Get a single enquiry by ID
 * @route   GET /api/enquiries/:enquiryId
 */
export const getEnquiryById = async (req, res) => {
  try {
    const enquiry = await findEnquiry(req.params.enquiryId);
    if (!enquiry) return notFound(res, "Enquiry not found");

    const conflictDetected = await detectConflict(
      enquiry.vendorId,
      enquiry.eventDate
    );

    return res.status(200).json({
      status: "SUCCESS",
      enquiry: withEnquiryDetails(enquiry),
      conflictDetected,
    });
  } catch (error) {
    return failed(res, "Failed to fetch enquiry", error);
  }
};

/**
 * @desc    Update enquiry status
 * @route   PUT /api/enquiries/:enquiryId/status
 * @body    { status: "Viewed" | "InDiscussion" | "AwaitingResponse" | ... }
 */
export const updateEnquiryStatus = async (req, res) => {
  try {
    const { status: newStatus } = req.body;

    if (!newStatus || !ENQUIRY_STATUSES.includes(newStatus)) {
      return res.status(400).json({
        status: "FAILED",
        message: `status must be one of: ${ENQUIRY_STATUSES.join(", ")}`,
      });
    }

    const enquiry = await findEnquiry(req.params.enquiryId);
    if (!enquiry) return notFound(res, "Enquiry not found");

    if (TERMINAL_ENQUIRY_STATUSES.includes(enquiry.status)) {
      return terminal(res, enquiry, "update");
    }

    enquiry.status = newStatus;
    if (newStatus === "Viewed" && !enquiry.viewedAt) {
      enquiry.viewedAt = new Date();
    }
    await enquiry.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: `Enquiry status updated to "${newStatus}"`,
      enquiry: withEnquiryDetails(enquiry),
    });
  } catch (error) {
    return failed(res, "Failed to update enquiry status", error);
  }
};

/**
 * @desc    Submit the customer's requested package changes
 * @route   POST /api/enquiries/:enquiryId/change-requests
 * @body    { changes: [{ changeType, itemKind?, category, item, qty? }] }
 *
 * The mirror of the booking endpoint: each change points at a deliverable in
 * the package snapshot, lands as Pending, and carries no weight in the pricing
 * until the vendor accepts it on the customise-proposal screen.
 */
export const requestEnquiryChanges = async (req, res) => {
  try {
    const validation = validateChangeRequests(req.body);
    if (!validation.valid) return invalid(res, validation.errors);

    const enquiry = await findEnquiry(req.params.enquiryId);
    if (!enquiry) return notFound(res, "Enquiry not found");

    if (TERMINAL_ENQUIRY_STATUSES.includes(enquiry.status)) {
      return terminal(res, enquiry, "change");
    }

    const requests = req.body.changes.map((change) => ({
      changeType: change.changeType,
      itemKind: change.itemKind ?? "Item",
      category: change.category.trim(),
      item: change.item.trim(),
      qty: change.qty ?? 1,
      status: "Pending",
      requestedAt: new Date(),
    }));

    enquiry.changeRequests.push(...requests);
    markInDiscussion(enquiry);
    await enquiry.save();

    return res.status(201).json({
      status: "SUCCESS",
      message: `${requests.length} change request(s) submitted`,
      enquiry: withEnquiryDetails(enquiry),
    });
  } catch (error) {
    return failed(res, "Failed to submit change requests", error);
  }
};

const PRICING_FIELDS = [
  "basePrice",
  "itemsAdded",
  "addonsAdded",
  "itemsRemoved",
  "addonsRemoved",
  "discountAmount",
  "taxRatePct",
];

const applyPricingFields = (record, pricing) => {
  for (const field of PRICING_FIELDS) {
    if (pricing[field] !== undefined) record.pricing[field] = pricing[field];
  }
  if (pricing.discountLabel !== undefined) {
    record.pricing.discountLabel =
      pricing.discountLabel?.trim() || "Discount Allowed";
  }
  record.pricing.updatedAt = new Date();
};

/**
 * @desc    Apply the vendor's edits to an enquiry
 * @route   PUT /api/enquiries/:enquiryId
 * @body    { changeRequests?: [{ id, status?, qty? }], pricing?, notes? }
 *
 * Everything the vendor changes while customising the proposal is saved in one
 * call, so a half-applied edit is not reachable: the accept/reject decisions
 * and the price they were agreed at land together or not at all. Sending the
 * proposal is a separate, explicit step.
 */
export const updateEnquiry = async (req, res) => {
  try {
    const validation = validateEnquiryUpdate(req.body);
    if (!validation.valid) return invalid(res, validation.errors);

    const enquiry = await findEnquiry(req.params.enquiryId);
    if (!enquiry) return notFound(res, "Enquiry not found");

    if (TERMINAL_ENQUIRY_STATUSES.includes(enquiry.status)) {
      return terminal(res, enquiry, "change");
    }

    const { changeRequests, pricing, notes } = req.body;

    if (Array.isArray(changeRequests)) {
      for (const decision of changeRequests) {
        const request = enquiry.changeRequests.id(decision.id);
        if (!request) {
          return notFound(res, `Change request "${decision.id}" not found`);
        }
        if (decision.qty !== undefined) request.qty = decision.qty;
        if (decision.status !== undefined) {
          request.status = decision.status;
          request.respondedAt = new Date();
        }
      }
    }

    if (pricing) applyPricingFields(enquiry, pricing);

    if (notes !== undefined) enquiry.notes = notes || null;

    applyPricingBreakdown(enquiry);
    await enquiry.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Enquiry updated",
      enquiry: withEnquiryDetails(enquiry),
    });
  } catch (error) {
    return failed(res, "Failed to update enquiry", error);
  }
};

/**
 * @desc    Send proposal details for an enquiry
 * @route   PUT /api/enquiries/:enquiryId/proposal
 *
 * The proposal is the vendor's answer, so it closes the customise step: the
 * pricing rows are frozen into `totalAmount` and the enquiry moves to
 * ProposalSent.
 */
export const sendProposal = async (req, res) => {
  try {
    const validation = validateSendProposal(req.body);
    if (!validation.valid) return invalid(res, validation.errors);

    const enquiry = await findEnquiry(req.params.enquiryId);
    if (!enquiry) return notFound(res, "Enquiry not found");

    if (TERMINAL_ENQUIRY_STATUSES.includes(enquiry.status)) {
      return terminal(res, enquiry, "send a proposal for");
    }

    const {
      customPrice,
      pricing,
      paymentMilestones,
      lineItems,
      customAddons,
      vendorNotes,
      terms,
      attachments,
      mediaUrls,
    } = req.body;

    if (pricing) applyPricingFields(enquiry, pricing);
    const breakdown = applyPricingBreakdown(enquiry);

    enquiry.proposal = {
      // An explicit customPrice still wins, so a vendor can quote a round
      // figure that does not fall out of the rows.
      customPrice: customPrice ?? breakdown.finalAmount,
      paymentMilestones: (paymentMilestones || []).map((milestone) => ({
        title: milestone.title.trim(),
        percentage: milestone.percentage ?? null,
        amount: milestone.amount,
        dueDate: milestone.dueDate ? new Date(milestone.dueDate) : null,
        status: milestone.status === "PaymentDue" ? "PaymentDue" : "Pending",
      })),
      lineItems: lineItems || [],
      customAddons: (customAddons || []).map((addon) => ({
        name: addon.name.trim(),
        qty: addon.qty ?? 1,
        price: addon.price ?? 0,
      })),
      vendorNotes: vendorNotes || null,
      terms: terms || null,
      attachments: normaliseAttachments(attachments),
      mediaUrls: mediaUrls || [],
      submittedAt: new Date(),
    };
    enquiry.status = "ProposalSent";
    enquiry.proposalSentAt = new Date();

    await enquiry.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Proposal sent successfully",
      enquiry: withEnquiryDetails(enquiry),
    });
  } catch (error) {
    return failed(res, "Failed to send proposal", error);
  }
};

/**
 * @desc    Convert an enquiry to a booking
 * @route   POST /api/enquiries/:enquiryId/convert
 * @body    { packageId?, paymentType?, totalAmount?, paymentMilestones?, ... }
 *
 * The booking inherits the enquiry's snapshot, decisions and pricing, so the
 * price the customer accepted is the price the booking opens at.
 */
export const convertEnquiryToBooking = async (req, res) => {
  try {
    const enquiry = await findEnquiry(req.params.enquiryId);
    if (!enquiry) return notFound(res, "Enquiry not found");

    if (enquiry.status === "Converted") {
      return res.status(400).json({
        status: "FAILED",
        message: "Enquiry already converted to a booking",
        bookingId: enquiry.convertedBookingId,
      });
    }

    if (enquiry.status === "Declined") {
      return terminal(res, enquiry, "convert");
    }

    if (!enquiry.eventDate) {
      return res.status(400).json({
        status: "FAILED",
        message: "Enquiry has no eventDate, which a booking requires",
      });
    }

    const packageId = req.body.packageId || enquiry.packageId;
    if (!packageId) {
      return res.status(400).json({
        status: "FAILED",
        message: "packageId is required to convert enquiry to booking",
      });
    }

    const paymentType = req.body.paymentType || "AdvancePaid";
    if (!PAYMENT_TYPES.includes(paymentType)) {
      return invalid(res, [
        `paymentType must be one of: ${PAYMENT_TYPES.join(", ")}`,
      ]);
    }

    const pkg = await Package.findById(packageId);
    if (!pkg) return notFound(res, "Package not found");

    // The enquiry's own snapshot is the one the customer agreed to; re-snapshot
    // only when the enquiry never named a package.
    const packageSnapshot =
      enquiry.packageSnapshot?.toObject?.() ??
      enquiry.packageSnapshot ??
      snapshotPackage(pkg);

    const booking = new Booking({
      bookingId: generateISTId("EVT"),
      vendorId: enquiry.vendorId,
      packageId: pkg._id,
      customer: enquiry.customer,
      eventType: enquiry.eventType,
      eventDate: enquiry.eventDate,
      guestRange:
        enquiry.guestCountMin != null || enquiry.guestCountMax != null
          ? { min: enquiry.guestCountMin, max: enquiry.guestCountMax }
          : undefined,
      location: enquiry.location,
      mapLink: enquiry.mapLink,
      startTime: enquiry.startTime,
      endTime: enquiry.endTime,
      packageSnapshot,
      paymentType,
      status: "NewBooking",
      // Decisions carry over as made — an accepted addition stays accepted.
      changeRequests: enquiry.changeRequests.map((request) =>
        request.toObject ? request.toObject() : request
      ),
      pricing: {
        ...(enquiry.pricing?.toObject?.() ?? enquiry.pricing ?? {}),
        basePrice: enquiry.pricing?.basePrice ?? enquiry.proposal?.customPrice ?? null,
      },
      paymentMilestones:
        req.body.paymentMilestones?.length
          ? req.body.paymentMilestones
          : (enquiry.proposal?.paymentMilestones || []).map((milestone) =>
              milestone.toObject ? milestone.toObject() : milestone
            ),
      totalReceived: 0,
      notes: req.body.notes || enquiry.proposal?.vendorNotes || enquiry.notes || null,
    });

    applyPricingBreakdown(booking);
    if (req.body.totalAmount != null) booking.totalAmount = req.body.totalAmount;
    await booking.save();

    enquiry.status = "Converted";
    enquiry.convertedBookingId = booking._id;
    enquiry.convertedAt = new Date();
    await enquiry.save();

    return res.status(201).json({
      status: "SUCCESS",
      message: "Enquiry converted to booking",
      booking: withPricingBreakdown(booking),
      enquiry: withEnquiryDetails(enquiry),
    });
  } catch (error) {
    return failed(res, "Failed to convert enquiry to booking", error);
  }
};

/**
 * @desc    Decline an enquiry
 * @route   PUT /api/enquiries/:enquiryId/decline
 * @body    { reason? }
 */
export const declineEnquiry = async (req, res) => {
  try {
    const enquiry = await findEnquiry(req.params.enquiryId);
    if (!enquiry) return notFound(res, "Enquiry not found");

    if (TERMINAL_ENQUIRY_STATUSES.includes(enquiry.status)) {
      return terminal(res, enquiry, "decline");
    }

    enquiry.status = "Declined";
    enquiry.declinedAt = new Date();
    enquiry.declineReason = req.body?.reason?.trim() || null;
    await enquiry.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Enquiry declined",
      enquiry: withEnquiryDetails(enquiry),
    });
  } catch (error) {
    return failed(res, "Failed to decline enquiry", error);
  }
};

/**
 * @desc    Save proposal draft for an enquiry
 * @route   PUT /api/enquiries/:enquiryId/draft
 */
export const saveDraft = async (req, res) => {
  try {
    const { enquiryId } = req.params;
    const { customiseData, pricing, termsAndPolicies, attachments, termsAttachmentUrl } = req.body;

    let enquiry;
    if (enquiryId.startsWith("ENQ")) {
      enquiry = await Enquiry.findOne({ enquiryId });
    } else {
      enquiry = await Enquiry.findById(enquiryId);
    }

    if (!enquiry) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Enquiry not found" });
    }

    if (enquiry.status === "Converted" || enquiry.status === "Declined") {
      return res.status(400).json({
        status: "FAILED",
        message: "Cannot save draft for a converted or declined enquiry",
      });
    }

    if (customiseData) {
      enquiry.customiseData = customiseData;
    }

    enquiry.proposal = {
      ...enquiry.proposal,
      pricing: pricing || enquiry.proposal?.pricing,
      termsAndPolicies: termsAndPolicies || enquiry.proposal?.termsAndPolicies,
      termsAttachmentUrl: termsAttachmentUrl || enquiry.proposal?.termsAttachmentUrl,
      attachments: attachments || enquiry.proposal?.attachments || [],
    };

    await enquiry.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Draft saved successfully",
      enquiry,
    });
  } catch (error) {
    console.error("Save Draft Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to save draft",
      error: error.message,
    });
  }
};
