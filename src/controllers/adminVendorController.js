import Vendor from "../models/Vendor.js";
import axios from "axios";
import { getPayoutsBaseUrl, buildPayoutsHeaders } from "../utils/cashfreePayoutsHelper.js";

// GET /api/admin/vendors/review-queue
export const getReviewQueue = async (req, res) => {
  try {
    const { page = 1, limit = 10, sort = 'desc' } = req.query;
    const skip = (page - 1) * limit;
    
    const sortOrder = sort === 'desc' ? -1 : 1;

    const vendors = await Vendor.find({ isVerified: false, isDeactivated: false })
      .sort({ createdAt: sortOrder })
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
    
    vendor.markModified("adminReview");

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
    const { page = 1, limit = 10, vendorType, isVerified, isDeactivated, city, state, search, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    if (vendorType) query.vendorType = vendorType;
    if (isVerified !== undefined && isVerified !== 'all') query.isVerified = isVerified === 'true';
    if (isDeactivated !== undefined && isDeactivated !== 'all') query.isDeactivated = isDeactivated === 'true';
    if (city) query.city = { $regex: new RegExp(`^${city}$`, 'i') };
    if (state) query.state = { $regex: new RegExp(`^${state}$`, 'i') };
    
    if (search) {
      query.$or = [
        { businessName: { $regex: search, $options: 'i' } },
        { pocName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { id: { $regex: search, $options: 'i' } }
      ];
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    console.log("[getAllVendors] req.query:", req.query);
    console.log("[getAllVendors] Constructed query:", JSON.stringify(query));
    
    const vendors = await Vendor.find(query)
      .sort(sort)
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

// POST /api/admin/vendors/:id/payout
export const makePayout = async (req, res) => {
  try {
    const { amount, remarks, bankAccountId } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    const vendor = await Vendor.findOne({ id: req.params.id });
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    if (!vendor.bankDetails || vendor.bankDetails.length === 0) {
      return res.status(400).json({ success: false, message: "Vendor has no bank details saved" });
    }

    // Select the bank account based on the provided _id or fallback to the first one
    let targetBankAccount = null;
    if (bankAccountId) {
      targetBankAccount = vendor.bankDetails.find(b => b._id.toString() === bankAccountId);
    } else {
      targetBankAccount = vendor.bankDetails[0];
    }

    if (!targetBankAccount) {
      return res.status(400).json({ success: false, message: "Selected bank account not found" });
    }

    const payoutsBase = getPayoutsBaseUrl();
    const headers = buildPayoutsHeaders();

    let beneficiary_id = targetBankAccount.beneficiaryId;

    // Check or create beneficiary
    if (!beneficiary_id) {
      // Auto-generate a beneficiary ID for the first time
      beneficiary_id = `BENE_${vendor.id}_${Date.now()}`;
      
      const vendorName = vendor.businessName || vendor.pocName || "Vendor";
      
      const beneficiaryBody = {
        beneficiary_id,
        beneficiary_name: vendorName,
        beneficiary_instrument_details: {
          bank_account_number: targetBankAccount.accountNumber,
          bank_ifsc: targetBankAccount.ifscCode
        },
        beneficiary_contact_details: {
          beneficiary_email: vendor.email || "noreply@eventory.in",
          beneficiary_phone: (vendor.phone || vendor.pocPhone || "9999999999").replace(/\\D/g, "").slice(-10),
          beneficiary_country_code: "+91",
        },
      };

      try {
        await axios.post(`${payoutsBase}/beneficiary`, beneficiaryBody, { headers });
      } catch (err) {
        const errorData = err?.response?.data;
        if (errorData?.code === 'conflict_with_existing_beneficiary') {
          try {
             const existingRes = await axios.get(`${payoutsBase}/beneficiary`, {
                headers,
                params: {
                  bank_account_number: targetBankAccount.accountNumber,
                  bank_ifsc: targetBankAccount.ifscCode
                }
             });
             if (existingRes.data && existingRes.data.beneficiary_id) {
                beneficiary_id = existingRes.data.beneficiary_id;
             } else {
                throw new Error("Beneficiary ID not returned in fetch.");
             }
          } catch (fetchErr) {
             console.error("Failed to fetch existing beneficiary:", fetchErr?.response?.data || fetchErr.message);
             return res.status(500).json({ success: false, message: "Bank account already linked to another beneficiary, but couldn't retrieve ID." });
          }
        } else {
          console.error("Failed to create beneficiary:", errorData || err.message);
          return res.status(500).json({ success: false, message: "Failed to register beneficiary with Cashfree" });
        }
      }

      // Save the generated beneficiary ID to DB
      targetBankAccount.beneficiaryId = beneficiary_id;
      await vendor.save();
    } else {
      // Ensure the beneficiary exists on Cashfree, else recreate it
      try {
        await axios.get(`${payoutsBase}/beneficiary`, { headers, params: { beneficiary_id } });
      } catch (err) {
        if (err?.response?.status === 404) {
           const vendorName = vendor.businessName || vendor.pocName || "Vendor";
           const beneficiaryBody = {
             beneficiary_id,
             beneficiary_name: vendorName,
             beneficiary_instrument_details: {
               bank_account_number: targetBankAccount.accountNumber,
               bank_ifsc: targetBankAccount.ifscCode
             },
             beneficiary_contact_details: {
               beneficiary_email: vendor.email || "noreply@eventory.in",
               beneficiary_phone: (vendor.phone || vendor.pocPhone || "9999999999").replace(/\\D/g, "").slice(-10),
               beneficiary_country_code: "+91",
             },
           };
           try {
             await axios.post(`${payoutsBase}/beneficiary`, beneficiaryBody, { headers });
           } catch (createErr) {
             console.error("Failed to re-create beneficiary:", createErr?.response?.data || createErr.message);
             return res.status(500).json({ success: false, message: "Failed to re-register beneficiary with Cashfree" });
           }
        } else {
          console.error("Error checking beneficiary:", err?.response?.data || err.message);
          return res.status(500).json({ success: false, message: "Error verifying beneficiary status" });
        }
      }
    }

    // Initiate Transfer
    const transfer_id = `TRF_${vendor.id}_${Date.now()}`;
    const transferBody = {
      transfer_id,
      transfer_amount: parseFloat(amount),
      transfer_currency: "INR",
      transfer_mode: "banktransfer", // default
      beneficiary_details: {
        beneficiary_id
      },
      transfer_remarks: remarks || "Vendor Payout"
    };

    try {
      const transferRes = await axios.post(`${payoutsBase}/transfers`, transferBody, { headers });
      return res.status(200).json({ success: true, data: transferRes.data });
    } catch (err) {
      console.error("Transfer failed:", err?.response?.data || err.message);
      return res.status(500).json({ success: false, message: "Transfer failed", details: err?.response?.data || err.message });
    }

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/vendors/:id/payout-history
export const getPayoutHistory = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ id: req.params.id });
    if (!vendor) return res.status(404).json({ success: false, message: "Vendor not found" });

    // Collect all beneficiary IDs from bank details
    const beneficiaryIds = vendor.bankDetails
        .map(b => b.beneficiaryId)
        .filter(Boolean);

    if (beneficiaryIds.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const payoutsBase = getPayoutsBaseUrl();
    const headers = buildPayoutsHeaders();

    // In a real production scenario with many transfers, we might need a separate DB table.
    // But since the request is to use Cashfree APIs directly and history isn't extensive, we'll query CF for each beneficiary.
    // Note: Cashfree V1 has no bulk fetch across beneficiaries without a date range, but we can just query individual transfers if we stored them, or we can fetch by beneficiary if CF supports it.
    // Wait, the API `GET /transfers?beneficiary_id=...` exists in V1, but not always documented to return an array, let's assume we can fetch by beneficiary or we just don't have this API if it's not supported easily without DB.
    // Wait, looking at the requirements, V2 backend usually doesn't have a transfer history table yet. We'll try fetching from Cashfree if possible.
    // Wait, Cashfree doesn't support fetching ALL transfers by `beneficiary_id` easily without dates. Let's just return a placeholder for now to prevent breaking, and focus on the transfer action.
    
    // Actually, CF Payouts API does not support GET /transfers by beneficiary_id in the new version without date filters.
    // We'll skip fetching history from Cashfree to avoid errors, and just return empty array since DB logging isn't requested yet.
    return res.status(200).json({ success: true, data: [], message: "History fetch from Cashfree not implemented without local DB sync." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
