import Vendor from "../models/Vendor.js";

// GET /api/admin/vendors/review-queue
export const getReviewQueue = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const vendors = await Vendor.find({ isVerified: false, isDeactivated: false })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Vendor.countDocuments({ isVerified: false, isDeactivated: false });

    res.status(200).json({
      success: true,
      data: vendors,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/vendors/review-queue/count
export const getReviewQueueCount = async (req, res) => {
  try {
    const count = await Vendor.countDocuments({ isVerified: false, isDeactivated: false });
    res.status(200).json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/vendors/:id
export const getVendorDetails = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ id: req.params.id });
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });
    res.status(200).json({ success: true, data: vendor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/vendors/:id/verify
export const verifyVendor = async (req, res) => {
  try {
    const { notes } = req.body;

    // Auto-approve all 8 sections
    const adminReview = {
      businessProfile: { status: "Approved", notes, reviewedAt: new Date() },
      contactAndLocation: { status: "Approved", notes, reviewedAt: new Date() },
      experienceAndTeam: { status: "Approved", notes, reviewedAt: new Date() },
      photosAndBranding: { status: "Approved", notes, reviewedAt: new Date() },
      kycDocuments: { status: "Approved", notes, reviewedAt: new Date() },
      businessLicenses: { status: "Approved", notes, reviewedAt: new Date() },
      bankDetails: { status: "Approved", notes, reviewedAt: new Date() },
      agreement: { status: "Approved", notes, reviewedAt: new Date() },
    };

    const vendor = await Vendor.findOneAndUpdate(
      { id: req.params.id },
      { isVerified: true, isDeactivated: false, adminReview },
      { new: true }
    );
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    res.status(200).json({ success: true, data: vendor, notes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/vendors/:id/reject
export const rejectVendor = async (req, res) => {
  try {
    const { reason } = req.body;
    const vendor = await Vendor.findOneAndUpdate(
      { id: req.params.id },
      { isVerified: false, isDeactivated: true },
      { new: true }
    );
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    res.status(200).json({ success: true, data: vendor, reason });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/vendors/:id/request-changes
export const requestChanges = async (req, res) => {
  try {
    const { notes } = req.body;
    const vendor = await Vendor.findOneAndUpdate(
      { id: req.params.id },
      { isVerified: false, isDeactivated: false },
      { new: true }
    );
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    res.status(200).json({ success: true, data: vendor, notes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/vendors/:id/review-section
export const reviewSection = async (req, res) => {
  try {
    const { section, status, notes } = req.body;

    const validSections = [
      "businessProfile", "contactAndLocation", "experienceAndTeam",
      "photosAndBranding", "kycDocuments", "businessLicenses",
      "bankDetails", "agreement"
    ];

    if (!validSections.includes(section)) {
      return res.status(400).json({ success: false, message: "Invalid section name" });
    }

    const vendor = await Vendor.findOne({ id: req.params.id });
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    if (!vendor.adminReview) {
      vendor.adminReview = {};
    }

    vendor.adminReview[section] = {
      status,
      notes,
      reviewedAt: new Date()
    };

    // Check if ALL sections are now Approved
    let allApproved = true;
    for (const sec of validSections) {
      if (!vendor.adminReview[sec] || vendor.adminReview[sec].status !== "Approved") {
        allApproved = false;
        break;
      }
    }

    vendor.isVerified = allApproved;

    await vendor.save();

    res.status(200).json({ success: true, data: vendor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/vendors/all
export const getAllVendors = async (req, res) => {
  try {
    const { page = 1, limit = 10, vendorType, isVerified, search } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    if (vendorType) query.vendorType = vendorType;
    if (isVerified !== undefined) query.isVerified = isVerified === 'true';
    if (search) {
      query.businessName = { $regex: search, $options: 'i' };
    }

    const vendors = await Vendor.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Vendor.countDocuments(query);

    res.status(200).json({
      success: true,
      data: vendors,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
