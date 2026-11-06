import Package from "../models/Package.js";
import { getActiveRules } from "../services/commercial/ruleSetService.js";
import { loadVendor } from "../services/commercial/commercialService.js";

/**
 * @desc    The vendor's own commercial terms (replaces the commercial CSVs the
 *          business app's rate card read): commission range, rounding, GST /
 *          TCS on it, trial progress, and each approved package's commission
 *          range. Never exposes demand tier, category labels, PCI or the
 *          customer service fee (PRD §17.4).
 * @route   GET /api/vendors/:id/commercial-terms
 */
export const getVendorCommercialTerms = async (req, res) => {
  try {
    const vendor = await loadVendor(req.params.id);
    if (!vendor) return res.status(404).json({ status: "FAILED", message: "Vendor not found" });

    const rules = await getActiveRules();
    const c = vendor.commercial || {};
    const trialBookings = rules.commission.trialBookings;
    const completed = c.successfulBookingsCount ?? 0;
    const model = c.monetizationModel ?? "TRIAL";
    const registered = Boolean(vendor.gstNumber);

    const packages = await Package.find({
      vendorId: { $in: [vendor.id, String(vendor._id)] },
      packageStatus: { $in: ["Approved", "Live"] },
    })
      .select("packageGroupId variantType packageStatus step1_eventAndCrew.packageName commercial.baseline.commissionEnvelope commercial.publicationOutcome")
      .lean();

    return res.status(200).json({
      status: "SUCCESS",
      rulesVersion: rules.versions.pricing,
      monetizationModel: model,
      trial: {
        bookings: trialBookings,
        completed,
        remaining: model === "TRIAL" ? Math.max(0, trialBookings - completed) : 0,
        inTrial: model === "TRIAL" && completed < trialBookings,
      },
      commission: {
        minRatePct: rules.commission.clamp.min,
        maxRatePct: rules.commission.clamp.max,
        earlyBookingRaisesRate: true,
        rounding: rules.commission.rounding.map(({ min, step }) => ({ fromVendorPrice: min, nearest: step })),
        gstOnCommissionPct: rules.tax.gstOnCommissionPct,
        tcsPct: registered ? rules.tax.tcsPctRegisteredVendor : 0,
      },
      packages: packages.map((p) => ({
        packageId: p._id,
        packageGroupId: p.packageGroupId,
        name: p.step1_eventAndCrew?.packageName ?? null,
        variantType: p.variantType,
        packageStatus: p.packageStatus,
        commissionRangePct: p.commercial?.baseline?.commissionEnvelope ?? null,
        fixedPriceBooking: p.commercial?.publicationOutcome === "APPROVED_FIXED",
      })),
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to load commercial terms", error: error.message });
  }
};
