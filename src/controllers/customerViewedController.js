import ViewedItem from "../models/ViewedItem.js";
import { resolveVendorForPackage } from "../utils/resolveVendor.js";
import { getEffectivePackagePrice } from "../utils/packagePrice.js";

/**
 * "Viewed Items" — the customer's recently-opened packages.
 *
 * Every route runs behind protectCustomer and scopes to req.customer._id;
 * no customerId is ever taken from the client.
 */

// Same projection the wishlist uses, so both surfaces render from an
// identical package shape on the frontend.
const PACKAGE_CARD_FIELDS =
  "vendorId vendorType variantType packageStatus step1_eventAndCrew.packageName " +
  "step1_eventAndCrew.eventCategories step2_productsAndPricing.setups " +
  "step3_policiesAndCharges.packagePricing step3_policiesAndCharges.teamAndEquipment " +
  "step3_policiesAndCharges.overallPriceOfPackage step4_sampleMedia.media";

/** Oldest rows beyond this are trimmed on write, so the list stays bounded. */
const MAX_PER_CUSTOMER = 50;

/**
 * @desc Record that the customer opened a package. Idempotent — a repeat
 *       view bumps viewedAt rather than inserting a second row.
 */
export const recordViewedItem = async (req, res) => {
  try {
    const { packageId } = req.body;
    const customerId = req.customer._id;

    const item = await ViewedItem.findOneAndUpdate(
      { customerId, packageId },
      { $set: { viewedAt: new Date() }, $setOnInsert: { customerId, packageId } },
      { new: true, upsert: true }
    ).lean();

    // Trim the tail rather than letting this grow without bound. Done after
    // the upsert so the row just written is never the one removed.
    const stale = await ViewedItem.find({ customerId })
      .sort({ viewedAt: -1 })
      .skip(MAX_PER_CUSTOMER)
      .select("_id")
      .lean();
    if (stale.length > 0) {
      await ViewedItem.deleteMany({ _id: { $in: stale.map((row) => row._id) } });
    }

    return res.status(200).json({ status: "SUCCESS", item });
  } catch (error) {
    return res
      .status(500)
      .json({ status: "ERROR", message: "Failed to record viewed item", error: error.message });
  }
};

/**
 * @desc The customer's viewed packages, newest first.
 */
export const getViewedItems = async (req, res) => {
  try {
    const items = await ViewedItem.find({ customerId: req.customer._id })
      .sort({ viewedAt: -1 })
      .limit(MAX_PER_CUSTOMER)
      .populate({ path: "packageId", select: PACKAGE_CARD_FIELDS })
      .lean();

    // A package taken down since it was viewed leaves packageId null after
    // populate — drop those rather than handing the client a half object.
    const live = items.filter((item) => item.packageId);

    const enriched = await Promise.all(
      live.map(async (item) => {
        // Not nesting a vendorId populate under packageId — see
        // resolveVendor.js for why that cast fails on seeded packages.
        item.packageId.vendorId = await resolveVendorForPackage(item.packageId.vendorId);
        return { ...item, currentPrice: getEffectivePackagePrice(item.packageId) };
      })
    );

    return res.status(200).json({ status: "SUCCESS", count: enriched.length, items: enriched });
  } catch (error) {
    return res
      .status(500)
      .json({ status: "ERROR", message: "Failed to fetch viewed items", error: error.message });
  }
};

/**
 * @desc Remove one viewed item. Scoped to the caller so one customer can
 *       never delete another's row.
 */
export const removeViewedItem = async (req, res) => {
  try {
    const deleted = await ViewedItem.findOneAndDelete({
      _id: req.params.itemId,
      customerId: req.customer._id,
    });
    if (!deleted) {
      return res.status(404).json({ status: "FAILED", message: "Viewed item not found" });
    }
    return res.status(200).json({ status: "SUCCESS", message: "Removed from viewed items" });
  } catch (error) {
    return res
      .status(500)
      .json({ status: "ERROR", message: "Failed to remove viewed item", error: error.message });
  }
};

/** @desc Clear the whole list. */
export const clearViewedItems = async (req, res) => {
  try {
    const { deletedCount } = await ViewedItem.deleteMany({ customerId: req.customer._id });
    return res.status(200).json({ status: "SUCCESS", message: "Viewed items cleared", deletedCount });
  } catch (error) {
    return res
      .status(500)
      .json({ status: "ERROR", message: "Failed to clear viewed items", error: error.message });
  }
};
