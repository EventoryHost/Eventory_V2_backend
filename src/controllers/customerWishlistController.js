import crypto from "crypto";
import mongoose from "mongoose";
import WishlistItem from "../models/WishlistItem.js";
import Package from "../models/Package.js";
import Vendor from "../models/Vendor.js";
import Customer from "../models/Customer.js";
import { PUBLIC_VENDOR_FIELDS } from "../utils/publicFields.js";
import { resolveVendorForPackage } from "../utils/resolveVendor.js";

/**
 * Authenticated wishlist CRUD + a public read-only share link — Phase 2
 * Step 10. Every mutating route runs behind protectCustomer; ownership is
 * checked explicitly against req.customer._id on every item-level route
 * rather than trusting a customerId the client could otherwise supply.
 */

const PACKAGE_CARD_FIELDS =
  "vendorId vendorType variantType packageStatus step1_eventAndCrew.packageName " +
  "step1_eventAndCrew.eventCategories step3_policiesAndCharges.packagePricing step4_sampleMedia.media";

/**
 * @desc Save a Package or Vendor to the logged-in customer's wishlist.
 */
export const addWishlistItem = async (req, res) => {
  try {
    const { itemType, packageId, vendorId, note } = req.body;

    let priceSnapshot = null;
    if (itemType === "Package") {
      const pkg = await Package.findOne({ _id: packageId, packageStatus: "Live" }).select(
        "step3_policiesAndCharges.packagePricing.price"
      );
      if (!pkg) {
        return res.status(404).json({ status: "FAILED", message: "Package not found or not currently available" });
      }
      priceSnapshot = pkg.step3_policiesAndCharges?.packagePricing?.price ?? null;
    } else {
      // Vendor.isDeactivated may simply be unset on older docs — same
      // "$ne: true" reasoning as the discovery browse endpoints.
      const vendorQuery = mongoose.Types.ObjectId.isValid(vendorId)
        ? { $or: [{ _id: vendorId }, { id: vendorId }], isDeactivated: { $ne: true } }
        : { id: vendorId, isDeactivated: { $ne: true } };
      const vendor = await Vendor.findOne(vendorQuery).select("_id id");
      if (!vendor) {
        return res.status(404).json({ status: "FAILED", message: "Vendor not found or not currently active" });
      }
    }

    const item = await WishlistItem.create({
      customerId: req.customer._id,
      itemType,
      packageId: itemType === "Package" ? packageId : null,
      vendorId: itemType === "Vendor" ? vendorId : null,
      note: note || "",
      priceSnapshot,
    });

    return res.status(201).json({ status: "SUCCESS", message: "Added to wishlist", item });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ status: "FAILED", message: "This item is already in your wishlist" });
    }
    return res.status(500).json({ status: "ERROR", message: "Failed to add to wishlist", error: error.message });
  }
};

/**
 * @desc List the logged-in customer's wishlist, newest first. Package items
 * carry a computed priceChanged flag (current price vs. the price at save
 * time) — a passive, read-time signal, not a push/email alert (no
 * notification channel exists in this codebase yet — see info.txt PART 4).
 */
export const getWishlist = async (req, res) => {
  try {
    // NOT nesting a "vendorId" populate under packageId — see
    // src/utils/resolveVendor.js: every currently-seeded Package.vendorId
    // fails that populate's implicit ObjectId cast (real bug found via
    // end-to-end testing, testsuite.pdf). Resolved manually below instead,
    // which the direct item.vendorId populate (itemType:"Vendor" saves,
    // always a real Vendor._id set at add-time, not derived from
    // Package.vendorId) doesn't need and is left as a normal populate.
    const items = await WishlistItem.find({ customerId: req.customer._id })
      .sort({ createdAt: -1 })
      .populate({ path: "packageId", select: PACKAGE_CARD_FIELDS })
      .populate({ path: "vendorId", select: PUBLIC_VENDOR_FIELDS })
      .lean();

    const enriched = await Promise.all(
      items.map(async (item) => {
        if (item.itemType !== "Package") return item;
        // The package may have been taken down/deleted since it was saved —
        // populate leaves packageId null in that case, handled here rather
        // than surfacing a confusing partial object to the client.
        if (item.packageId) {
          item.packageId.vendorId = await resolveVendorForPackage(item.packageId.vendorId);
        }
        const currentPrice = item.packageId?.step3_policiesAndCharges?.packagePricing?.price ?? null;
        return {
          ...item,
          packageStillAvailable: Boolean(item.packageId),
          currentPrice,
          priceChanged: item.priceSnapshot != null && currentPrice != null && currentPrice !== item.priceSnapshot,
        };
      })
    );

    return res.status(200).json({ status: "SUCCESS", count: enriched.length, items: enriched });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch wishlist", error: error.message });
  }
};

/**
 * @desc Update the personal note on one wishlist item.
 */
export const updateWishlistItemNote = async (req, res) => {
  try {
    const { itemId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({ status: "FAILED", message: "Invalid itemId" });
    }

    const item = await WishlistItem.findOneAndUpdate(
      { _id: itemId, customerId: req.customer._id }, // ownership check baked into the query, not a separate step
      { $set: { note: req.body.note } },
      { new: true }
    );

    if (!item) {
      return res.status(404).json({ status: "FAILED", message: "Wishlist item not found" });
    }

    return res.status(200).json({ status: "SUCCESS", item });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to update note", error: error.message });
  }
};

/**
 * @desc Remove one item from the wishlist.
 */
export const removeWishlistItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({ status: "FAILED", message: "Invalid itemId" });
    }

    const item = await WishlistItem.findOneAndDelete({ _id: itemId, customerId: req.customer._id });
    if (!item) {
      return res.status(404).json({ status: "FAILED", message: "Wishlist item not found" });
    }

    return res.status(200).json({ status: "SUCCESS", message: "Removed from wishlist" });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to remove wishlist item", error: error.message });
  }
};

/**
 * @desc Clear the entire wishlist.
 */
export const clearWishlist = async (req, res) => {
  try {
    const { deletedCount } = await WishlistItem.deleteMany({ customerId: req.customer._id });
    return res.status(200).json({ status: "SUCCESS", message: "Wishlist cleared", count: deletedCount });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to clear wishlist", error: error.message });
  }
};

/**
 * @desc Enable (and, if needed, mint/rotate) the customer's wishlist share
 * link. One link per customer for their whole current wishlist, not a
 * point-in-time snapshot — see Customer.js for why.
 */
export const shareWishlist = async (req, res) => {
  try {
    const customer = await Customer.findById(req.customer._id).select("wishlistShareToken wishlistShareEnabled");
    const needsToken = !customer.wishlistShareToken || req.query.rotate;

    if (needsToken) {
      // Collision odds on a 16-byte hex token are negligible, but the
      // unique index means a collision would 500 the request outright
      // without a retry — a few attempts costs nothing and removes that
      // (astronomically unlikely) failure mode entirely.
      let saved = false;
      for (let attempt = 0; attempt < 5 && !saved; attempt++) {
        const token = crypto.randomBytes(16).toString("hex");
        try {
          customer.wishlistShareToken = token;
          customer.wishlistShareEnabled = true;
          await customer.save();
          saved = true;
        } catch (err) {
          if (err.code !== 11000) throw err;
        }
      }
      if (!saved) {
        return res.status(500).json({ status: "ERROR", message: "Failed to generate a unique share link, please retry" });
      }
    } else {
      customer.wishlistShareEnabled = true;
      await customer.save();
    }

    const base = process.env.FRONTEND_URL || "http://localhost:3000";
    return res.status(200).json({
      status: "SUCCESS",
      shareToken: customer.wishlistShareToken,
      shareUrl: `${base}/wishlist/shared/${customer.wishlistShareToken}`,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to enable wishlist sharing", error: error.message });
  }
};

/**
 * @desc Disable the wishlist share link. The token itself is kept (not
 * cleared) so re-enabling reuses the same link rather than issuing a new
 * one — only /share?rotate=true mints a fresh token.
 */
export const unshareWishlist = async (req, res) => {
  try {
    await Customer.updateOne({ _id: req.customer._id }, { $set: { wishlistShareEnabled: false } });
    return res.status(200).json({ status: "SUCCESS", message: "Wishlist sharing disabled" });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to disable wishlist sharing", error: error.message });
  }
};

/**
 * @desc Public, no-auth read of a shared wishlist by its token. Personal
 * notes are deliberately excluded from this view — they're the saving
 * customer's private reminders, not something implied by "share this
 * wishlist" (not specified either way in the source PRD; this is a
 * deliberate privacy default, documented as such in info.txt).
 */
export const getSharedWishlist = async (req, res) => {
  try {
    const { token } = req.params;
    const customer = await Customer.findOne({ wishlistShareToken: token, wishlistShareEnabled: true }).select("name");
    if (!customer) {
      return res.status(404).json({ status: "FAILED", message: "This wishlist link is invalid or no longer shared" });
    }

    const items = await WishlistItem.find({ customerId: customer._id })
      .select("-note")
      .sort({ createdAt: -1 })
      .populate({ path: "packageId", select: PACKAGE_CARD_FIELDS })
      .populate({ path: "vendorId", select: PUBLIC_VENDOR_FIELDS })
      .lean();

    // Same manual resolution as getWishlist — see its comment / resolveVendor.js.
    await Promise.all(
      items.map(async (item) => {
        if (item.itemType === "Package" && item.packageId) {
          item.packageId.vendorId = await resolveVendorForPackage(item.packageId.vendorId);
        }
      })
    );

    return res.status(200).json({
      status: "SUCCESS",
      owner: { name: customer.name || "A customer" },
      count: items.length,
      items,
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch shared wishlist", error: error.message });
  }
};
