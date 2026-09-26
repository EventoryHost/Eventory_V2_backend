import { buildGroupFilter } from "../utils/packageGroup.js";
import {
  recordPackageView,
  getGroupAnalytics,
  PackageAnalyticsError,
} from "../services/packageAnalyticsService.js";

const sendAnalyticsError = (res, error, fallback) => {
  if (error instanceof PackageAnalyticsError) {
    return res.status(error.statusCode).json({ status: "FAILED", message: error.message });
  }
  return res.status(500).json({ status: "ERROR", message: fallback, error: error.message });
};

/**
 * @desc Customer opened a package's detail page. Called once per page open
 * by the customer site — not from GET /customer/packages/:packageId, which
 * is also re-fetched for date changes, compare, cart and booking screens and
 * would count each of those as a view.
 */
export const recordView = async (req, res) => {
  try {
    await recordPackageView(req.params.packageId);
    return res.status(200).json({ status: "SUCCESS" });
  } catch (error) {
    return sendAnalyticsError(res, error, "Failed to record view");
  }
};

/**
 * @desc Views, wishlist, cart and booking counts for one package, across all
 * of its variants. Backs the vendor app's Analytics popup on a Live card.
 */
export const getPackageGroupAnalytics = async (req, res) => {
  try {
    const { packageGroupId } = req.params;
    if (!packageGroupId || !String(packageGroupId).trim()) {
      return res.status(400).json({
        status: "FAILED",
        message: `Invalid packageGroupId: ${packageGroupId}`,
      });
    }

    const analytics = await getGroupAnalytics(await buildGroupFilter(packageGroupId));
    return res.status(200).json({ status: "SUCCESS", analytics });
  } catch (error) {
    return sendAnalyticsError(res, error, "Failed to load package analytics");
  }
};
