import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";

// GET /api/admin/packages/review-queue
export const getReviewQueue = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const packagesRaw = await Package.find({ packageStatus: "Under Review" })
      .sort({ updatedAt: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const vendorIds = [...new Set(packagesRaw.map(p => p.vendorId))];
    const vendors = await Vendor.find({ id: { $in: vendorIds } })
      .select("id businessName city phone isVerified vendorType")
      .lean();
    
    const vendorMap = {};
    vendors.forEach(v => vendorMap[v.id] = v);

    const packages = packagesRaw.map(p => ({
      ...p,
      vendorId: vendorMap[p.vendorId] || p.vendorId
    }));

    const total = await Package.countDocuments({ packageStatus: "Under Review" });

    res.status(200).json({
      success: true,
      data: packages,
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

// GET /api/admin/packages/review-queue/count
export const getReviewQueueCount = async (req, res) => {
  try {
    const count = await Package.countDocuments({ packageStatus: "Under Review" });
    res.status(200).json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/packages/:packageId
export const getPackageDetails = async (req, res) => {
  try {
    const pkgRaw = await Package.findById(req.params.packageId).lean();
    if (!pkgRaw) return res.status(404).json({ success: false, message: "Package not found" });

    const vendor = await Vendor.findOne({ id: pkgRaw.vendorId }).lean();
    const pkg = { ...pkgRaw, vendorId: vendor || pkgRaw.vendorId };

    res.status(200).json({ success: true, data: pkg });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/packages/:packageId/approve
export const approvePackage = async (req, res) => {
  try {
    const adminReview = {
      step1: { status: "Approved", notes: "", reviewedAt: new Date() },
      step2: { status: "Approved", notes: "", reviewedAt: new Date() },
      step3: { status: "Approved", notes: "", reviewedAt: new Date() },
      step4: { status: "Approved", notes: "", reviewedAt: new Date() },
    };

    const pkg = await Package.findByIdAndUpdate(
      req.params.packageId,
      { packageStatus: "Live", adminReview },
      { new: true }
    );
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found" });
    
    res.status(200).json({ success: true, data: pkg });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/packages/:packageId/request-fix
export const requestFix = async (req, res) => {
  try {
    const { notes } = req.body;
    const pkg = await Package.findByIdAndUpdate(
      req.params.packageId,
      { packageStatus: "Draft" },
      { new: true }
    );
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found" });
    
    // Returning notes just for UI reference, vendor doesn't see these currently without a model change
    res.status(200).json({ success: true, data: pkg, notes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/packages/:packageId/reject
export const rejectPackage = async (req, res) => {
  try {
    const pkg = await Package.findByIdAndUpdate(
      req.params.packageId,
      { packageStatus: "Deleted" },
      { new: true }
    );
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found" });
    res.status(200).json({ success: true, data: pkg });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/packages/group/:packageGroupId
export const getPackageGroup = async (req, res) => {
  try {
    const packagesRaw = await Package.find({ packageGroupId: req.params.packageGroupId }).lean();
    
    const vendorIds = [...new Set(packagesRaw.map(p => p.vendorId))];
    const vendors = await Vendor.find({ id: { $in: vendorIds } }).lean();
    
    const vendorMap = {};
    vendors.forEach(v => vendorMap[v.id] = v);

    const packages = packagesRaw.map(p => ({
      ...p,
      vendorId: vendorMap[p.vendorId] || p.vendorId
    }));

    res.status(200).json({ success: true, data: packages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/packages/all
export const getAllPackages = async (req, res) => {
  try {
    const { page = 1, limit = 10, packageStatus, vendorType, vendorId } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    if (packageStatus) query.packageStatus = packageStatus;
    if (vendorType) query.vendorType = vendorType;
    if (vendorId) query.vendorId = vendorId;

    const packagesRaw = await Package.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const vendorIds = [...new Set(packagesRaw.map(p => p.vendorId))];
    const vendors = await Vendor.find({ id: { $in: vendorIds } })
      .select("id businessName")
      .lean();
    
    const vendorMap = {};
    vendors.forEach(v => vendorMap[v.id] = v);

    const packages = packagesRaw.map(p => ({
      ...p,
      vendorId: vendorMap[p.vendorId] || p.vendorId
    }));

    const total = await Package.countDocuments(query);

    res.status(200).json({
      success: true,
      data: packages,
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

// PUT /api/admin/packages/:packageId/status
export const updatePackageStatus = async (req, res) => {
  try {
    const { packageStatus } = req.body;
    
    if (!["Draft", "Under Review", "Live", "Deleted"].includes(packageStatus)) {
      return res.status(400).json({ success: false, message: "Invalid package status" });
    }

    const pkg = await Package.findByIdAndUpdate(
      req.params.packageId,
      { packageStatus },
      { new: true }
    );
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found" });
    
    res.status(200).json({ success: true, data: pkg });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/packages/:packageId/review-step
export const reviewPackageStep = async (req, res) => {
  try {
    const { step, status, notes } = req.body;
    
    const validSteps = ["step1", "step2", "step3", "step4"];

    if (!validSteps.includes(step)) {
      return res.status(400).json({ success: false, message: "Invalid step name" });
    }

    const pkg = await Package.findById(req.params.packageId);
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found" });

    if (!pkg.adminReview) {
      pkg.adminReview = {};
    }

    pkg.adminReview[step] = {
      status,
      notes,
      reviewedAt: new Date()
    };

    // Check if ALL steps are now Approved
    let allApproved = true;
    for (const s of validSteps) {
      if (!pkg.adminReview[s] || pkg.adminReview[s].status !== "Approved") {
        allApproved = false;
        break;
      }
    }

    if (allApproved) {
      pkg.packageStatus = "Live";
    }

    await pkg.save();

    res.status(200).json({ success: true, data: pkg });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
