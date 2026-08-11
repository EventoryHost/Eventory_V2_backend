import Enquiry from "../models/Enquiry.js";
import Booking from "../models/Booking.js";
import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";
import CalendarBlock from "../models/CalendarBlock.js";
import { generateISTId } from "../utils/idGenerator.js";
import { validateCreateEnquiry } from "../validators/bookingValidators.js";

// ─── Helpers ────────────────────────────────────────────────

const resolveVendorId = async (vendorId) => {
  if (typeof vendorId === "string" && vendorId.startsWith("VEN")) {
    const vendorDoc = await Vendor.findOne({ id: vendorId }).select('_id');
    if (!vendorDoc) return null;
    return vendorDoc._id;
  }
  return vendorId;
};

/**
 * Check if a date has conflicts for the vendor.
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
      status: { $in: ["Pending", "Accepted"] },
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

// ─── Controllers ────────────────────────────────────────────

/**
 * @desc    Create a new enquiry
 * @route   POST /api/enquiries/vendor/:vendorId
 */
export const createEnquiry = async (req, res) => {
  try {
    const { vendorId } = req.params;

    const validation = validateCreateEnquiry(req.body);
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

    const enquiry = new Enquiry({
      enquiryId: generateISTId("ENQ"),
      vendorId: actualVendorId,
      customer: {
        name: req.body.customer.name.trim(),
        phone: req.body.customer.phone || null,
        email: req.body.customer.email || null,
      },
      eventType: req.body.eventType || null,
      eventDate: req.body.eventDate ? new Date(req.body.eventDate) : null,
      startTime: req.body.startTime || null,
      endTime: req.body.endTime || null,
      budgetMin: req.body.budgetMin || null,
      budgetMax: req.body.budgetMax || null,
      requests: req.body.requests || [],
      matchStrength: req.body.matchStrength || null,
      notes: req.body.notes || null,
      receivedAt: new Date(),
    });

    await enquiry.save();

    return res.status(201).json({
      status: "SUCCESS",
      message: "Enquiry created",
      enquiry,
    });
  } catch (error) {
    console.error("Create Enquiry Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to create enquiry",
      error: error.message,
    });
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

    const actualVendorId = await resolveVendorId(vendorId);
    if (!actualVendorId) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Vendor not found" });
    }

    const query = { vendorId: actualVendorId };
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

    // Annotate with conflict detection
    for (const enquiry of enquiries) {
      enquiry.conflictDetected = await detectConflict(
        actualVendorId,
        enquiry.eventDate
      );
    }

    return res.status(200).json({
      status: "SUCCESS",
      count: enquiries.length,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      enquiries,
    });
  } catch (error) {
    console.error("Get Vendor Enquiries Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch vendor enquiries",
      error: error.message,
    });
  }
};

/**
 * @desc    Get a single enquiry by ID
 * @route   GET /api/enquiries/:enquiryId
 */
export const getEnquiryById = async (req, res) => {
  try {
    const { enquiryId } = req.params;

    let enquiry;
    if (enquiryId.startsWith("ENQ")) {
      enquiry = await Enquiry.findOne({ enquiryId }).populate("vendorId", "vendorType").populate("primaryPackage");
    } else {
      enquiry = await Enquiry.findById(enquiryId).populate("vendorId", "vendorType").populate("primaryPackage");
    }

    if (!enquiry) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Enquiry not found" });
    }

    const conflictDetected = await detectConflict(
      enquiry.vendorId,
      enquiry.eventDate
    );

    return res.status(200).json({
      status: "SUCCESS",
      enquiry,
      conflictDetected,
    });
  } catch (error) {
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to fetch enquiry",
      error: error.message,
    });
  }
};

/**
 * @desc    Update enquiry status
 * @route   PUT /api/enquiries/:enquiryId/status
 * @body    { status: "AwaitingResponse" | "ProposalSent" }
 */
export const updateEnquiryStatus = async (req, res) => {
  try {
    const { enquiryId } = req.params;
    const { status: newStatus } = req.body;

    const validStatuses = [
      "NewEnquiry",
      "AwaitingResponse",
      "ProposalSent",
      "Converted",
      "Declined",
    ];
    if (!newStatus || !validStatuses.includes(newStatus)) {
      return res.status(400).json({
        status: "FAILED",
        message: `status must be one of: ${validStatuses.join(", ")}`,
      });
    }

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
        message: `Cannot update enquiry with terminal status "${enquiry.status}"`,
      });
    }

    enquiry.status = newStatus;
    await enquiry.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: `Enquiry status updated to "${newStatus}"`,
      enquiry,
    });
  } catch (error) {
    console.error("Update Enquiry Status Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to update enquiry status",
      error: error.message,
    });
  }
};

/**
 * @desc    Convert an enquiry to a booking
 * @route   POST /api/enquiries/:enquiryId/convert
 * @body    { packageId, paymentType, totalAmount, paymentMilestones, ... }
 */
export const convertEnquiryToBooking = async (req, res) => {
  try {
    const { enquiryId } = req.params;

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

    if (enquiry.status === "Converted") {
      return res.status(400).json({
        status: "FAILED",
        message: "Enquiry already converted to a booking",
        bookingId: enquiry.convertedBookingId,
      });
    }

    if (enquiry.status === "Declined") {
      return res.status(400).json({
        status: "FAILED",
        message: "Cannot convert a declined enquiry",
      });
    }

    // Validate required booking fields
    if (!req.body.packageId) {
      return res.status(400).json({
        status: "FAILED",
        message: "packageId is required to convert enquiry to booking",
      });
    }

    const pkg = await Package.findById(req.body.packageId);
    if (!pkg) {
      return res
        .status(404)
        .json({ status: "FAILED", message: "Package not found" });
    }

    // Use customized proposal fields if available
    const hasProposal = enquiry.proposal && enquiry.proposal.customPrice != null;
    const finalAmount = req.body.totalAmount || 
                        (hasProposal ? enquiry.proposal.customPrice : null) || 
                        pkg.step3_policiesAndCharges?.packagePricing?.price || 0;

    const mapMilestones = (enqMilestones) => {
      return enqMilestones.map((m, index) => {
        let type = "Advanced1";
        if (index === 0) type = "Token";
        else if (index === enqMilestones.length - 1) type = "FinalClearance";
        else if (index === 2) type = "Advanced2";

        return {
          type,
          amount: m.amount,
          status: "Pending",
          dueDate: null,
        };
      });
    };

    let finalMilestones = [];
    if (req.body.paymentMilestones && req.body.paymentMilestones.length > 0) {
      finalMilestones = req.body.paymentMilestones;
    } else if (hasProposal && enquiry.proposal.paymentMilestones && enquiry.proposal.paymentMilestones.length > 0) {
      finalMilestones = mapMilestones(enquiry.proposal.paymentMilestones);
    }

    const finalNotes = req.body.notes || 
                       (hasProposal ? enquiry.proposal.vendorNotes : null) || 
                       enquiry.notes || null;

    // Create the booking from enquiry data
    const booking = new Booking({
      bookingId: generateISTId("EVT"),
      vendorId: enquiry.vendorId,
      packageId: pkg._id,
      customer: enquiry.customer,
      eventType: enquiry.eventType,
      eventDate: enquiry.eventDate,
      startTime: enquiry.startTime,
      endTime: enquiry.endTime,
      packageSnapshot: {
        name: pkg.step1_eventAndCrew?.packageName || "Untitled Package",
        price: pkg.step3_policiesAndCharges?.packagePricing?.price || 0,
        image: pkg.step4_sampleMedia?.media?.[0]?.url || null,
        vendorType: pkg.vendorType || null,
        variantType: pkg.variantType || "Premium",
      },
      paymentType: req.body.paymentType || "AdvancePaid",
      status: "Pending",
      paymentMilestones: finalMilestones,
      totalAmount: finalAmount,
      totalReceived: 0,
      notes: finalNotes,
    });

    await booking.save();

    // Link and update enquiry
    enquiry.status = "Converted";
    enquiry.convertedBookingId = booking._id;
    await enquiry.save();

    return res.status(201).json({
      status: "SUCCESS",
      message: "Enquiry converted to booking",
      booking,
      enquiry,
    });
  } catch (error) {
    console.error("Convert Enquiry Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to convert enquiry to booking",
      error: error.message,
    });
  }
};

/**
 * @desc    Decline an enquiry
 * @route   PUT /api/enquiries/:enquiryId/decline
 */
export const declineEnquiry = async (req, res) => {
  try {
    const { enquiryId } = req.params;

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

    if (enquiry.status === "Converted") {
      return res.status(400).json({
        status: "FAILED",
        message: "Cannot decline a converted enquiry",
      });
    }

    if (enquiry.status === "Declined") {
      return res.status(400).json({
        status: "FAILED",
        message: "Enquiry is already declined",
      });
    }

    enquiry.status = "Declined";
    await enquiry.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Enquiry declined",
      enquiry,
    });
  } catch (error) {
    console.error("Decline Enquiry Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to decline enquiry",
      error: error.message,
    });
  }
};

/**
 * @desc    Send proposal details for an enquiry
 * @route   PUT /api/enquiries/:enquiryId/proposal
 */
export const sendProposal = async (req, res) => {
  try {
    const { enquiryId } = req.params;
    const { customPrice, paymentMilestones, lineItems, vendorNotes, attachments, mediaUrls, customiseData, pricing, termsAndPolicies, termsAttachmentUrl } = req.body;

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

    if (enquiry.status === "Converted") {
      return res.status(400).json({
        status: "FAILED",
        message: "Cannot send proposal for a converted enquiry",
      });
    }

    if (enquiry.status === "Declined") {
      return res.status(400).json({
        status: "FAILED",
        message: "Cannot send proposal for a declined enquiry",
      });
    }

    // Update customiseData if provided
    if (customiseData) {
      enquiry.customiseData = customiseData;
    }

    // Update proposal fields and status
    enquiry.proposal = {
      ...enquiry.proposal,
      customPrice,
      paymentMilestones,
      lineItems,
      vendorNotes,
      attachments: attachments || [],
      mediaUrls: mediaUrls || [],
      pricing: pricing || enquiry.proposal?.pricing,
      termsAndPolicies: termsAndPolicies || enquiry.proposal?.termsAndPolicies,
      termsAndPolicies: termsAndPolicies || enquiry.proposal?.termsAndPolicies,
      termsAttachmentUrl: termsAttachmentUrl || enquiry.proposal?.termsAttachmentUrl,
    };
    enquiry.status = "ProposalSent";

    await enquiry.save();

    return res.status(200).json({
      status: "SUCCESS",
      message: "Proposal sent successfully",
      enquiry,
    });
  } catch (error) {
    console.error("Send Proposal Error:", error);
    return res.status(500).json({
      status: "ERROR",
      message: "Failed to send proposal",
      error: error.message,
    });
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
