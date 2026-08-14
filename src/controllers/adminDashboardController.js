import Vendor from "../models/Vendor.js";
import Package from "../models/Package.js";
import Booking from "../models/Booking.js";
import Template from "../models/Template.js";
import Enquiry from "../models/Enquiry.js";

// GET /api/admin/dashboard/kpis
export const getDashboardKPIs = async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const SLA_HOURS = 4;
    const slaThreshold = new Date(Date.now() - SLA_HOURS * 60 * 60 * 1000);

    const [
      pendingVerifications,
      pendingApprovals,
      slaBreachCount,
      pendingBookings,
      todaysBookings,
      totalTemplates,
      totalLivePackages,
      openEnquiries
    ] = await Promise.all([
      Vendor.countDocuments({ isVerified: false, isDeactivated: false }),
      Package.countDocuments({ packageStatus: "Under Review" }),
      Booking.countDocuments({ status: "Pending", createdAt: { $lt: slaThreshold } }),
      Booking.countDocuments({ status: "Pending" }),
      Booking.countDocuments({ eventDate: { $gte: todayStart, $lte: todayEnd } }),
      Template.countDocuments({}),
      Package.countDocuments({ packageStatus: "Live" }),
      Enquiry.countDocuments({ status: "NewEnquiry" })
    ]);

    res.status(200).json({
      success: true,
      data: {
        pendingVerifications,
        pendingApprovals,
        slaBreachCount,
        pendingBookings,
        todaysBookings,
        totalTemplates,
        totalLivePackages,
        openEnquiries
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
