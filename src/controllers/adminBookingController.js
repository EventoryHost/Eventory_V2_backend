import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Vendor from "../models/Vendor.js"; // For reassignment validation

const SLA_HOURS = 4;
const getSlaThreshold = () => new Date(Date.now() - SLA_HOURS * 60 * 60 * 1000);

// GET /api/admin/bookings/exception-queue
export const getExceptionQueue = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const threshold = getSlaThreshold();

    const query = {
      status: "Pending",
      createdAt: { $lt: threshold },
    };

    const bookings = await Booking.find(query)
      .populate("vendorId", "businessName city phone isVerified vendorType")
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Calculate SLA breach minutes for each
    const now = new Date();
    const withSlaData = bookings.map(b => {
      const bObj = b.toObject();
      const breachedMs = now - (new Date(bObj.createdAt).getTime() + (SLA_HOURS * 60 * 60 * 1000));
      bObj.slaBreachedMinutes = Math.floor(breachedMs / 60000);
      return bObj;
    });

    const total = await Booking.countDocuments(query);

    res.status(200).json({
      success: true,
      data: withSlaData,
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

// GET /api/admin/bookings/exception-queue/count
export const getExceptionQueueCount = async (req, res) => {
  try {
    const count = await Booking.countDocuments({
      status: "Pending",
      createdAt: { $lt: getSlaThreshold() },
    });
    res.status(200).json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/bookings/pending
export const getAllPending = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const bookings = await Booking.find({ status: "Pending" })
      .populate("vendorId", "businessName city phone isVerified vendorType")
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments({ status: "Pending" });
    
    // Add SLA timer info
    const now = new Date();
    const withSlaData = bookings.map(b => {
      const bObj = b.toObject();
      const slaDeadline = new Date(bObj.createdAt).getTime() + (SLA_HOURS * 60 * 60 * 1000);
      const diffMs = now.getTime() - slaDeadline;
      
      bObj.isSlaBreached = diffMs > 0;
      bObj.slaDiffMinutes = Math.floor(Math.abs(diffMs) / 60000); // Minutes until breach (or since breach)
      
      return bObj;
    });

    res.status(200).json({
      success: true,
      data: withSlaData,
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

// GET /api/admin/bookings/:bookingId
export const getBookingDetails = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId)
      .populate("vendorId", "businessName city phone isVerified vendorType")
      .populate("packageId", "packageStatus completedSteps variantType");
      
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    res.status(200).json({ success: true, data: booking });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/bookings/:bookingId/reassign
export const reassignBooking = async (req, res) => {
  try {
    const { newVendorId, reason } = req.body;
    
    // Validate new vendor exists
    const vendorQuery = mongoose.Types.ObjectId.isValid(newVendorId)
      ? { $or: [{ _id: newVendorId }, { id: newVendorId }] }
      : { id: newVendorId };
    const newVendor = await Vendor.findOne(vendorQuery);
    if (!newVendor) {
      return res.status(404).json({ success: false, message: "New vendor not found" });
    }

    const booking = await Booking.findByIdAndUpdate(
      req.params.bookingId,
      { 
        vendorId: newVendorId,
        // Reset status if it was declined/cancelled etc? 
        // For now just change vendor, keep status pending if it was pending
      },
      { new: true }
    );
    
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    
    res.status(200).json({ success: true, data: booking, reason });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/admin/bookings/:bookingId/force-accept
export const forceAccept = async (req, res) => {
  try {
    const booking = await Booking.findByIdAndUpdate(
      req.params.bookingId,
      { status: "Accepted" },
      { new: true }
    );
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    res.status(200).json({ success: true, data: booking });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/bookings/stats
export const getStats = async (req, res) => {
  try {
    const threshold = getSlaThreshold();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [
      totalPending,
      slaBreachedCount,
      todaysBookingsCount,
      totalAccepted,
      totalCount
    ] = await Promise.all([
      Booking.countDocuments({ status: "Pending" }),
      Booking.countDocuments({ status: "Pending", createdAt: { $lt: threshold } }),
      Booking.countDocuments({ eventDate: { $gte: todayStart, $lte: todayEnd } }),
      Booking.countDocuments({ status: "Accepted" }),
      Booking.countDocuments({})
    ]);

    const ackRate = totalCount > 0 ? (totalAccepted / totalCount) * 100 : 0;

    res.status(200).json({
      success: true,
      data: {
        totalPending,
        slaBreachedCount,
        todaysBookingsCount,
        totalAccepted,
        totalCount,
        ackRate: ackRate.toFixed(1)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/admin/bookings/all
export const getAllBookings = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, vendorId, search } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    if (status) query.status = status;
    if (vendorId) query.vendorId = vendorId;
    if (search) {
      query["customer.name"] = { $regex: search, $options: 'i' };
    }

    const bookings = await Booking.find(query)
      .populate("vendorId", "businessName id")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Booking.countDocuments(query);

    res.status(200).json({
      success: true,
      data: bookings,
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

// GET /api/admin/bookings/today
export const getTodaysBookings = async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const bookings = await Booking.find({
      eventDate: { $gte: todayStart, $lte: todayEnd }
    }).populate("vendorId", "businessName city");

    res.status(200).json({ success: true, data: bookings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
