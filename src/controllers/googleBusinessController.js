import mongoose from "mongoose";
import Vendor from "../models/Vendor.js";
import { VISIBLE_VENDOR_FILTER } from "../utils/customerVisibility.js";
import {
  searchBusinesses,
  getPlaceSummary,
  placeEmbedUrl,
  placeMapsUrl,
  resolveShareLink,
  GooglePlacesError,
} from "../services/googlePlacesService.js";
import {
  getLink,
  linkByVendor,
  linkByEm,
  reviewLink,
  unlink,
  listPendingLinks,
} from "../services/googleBusinessService.js";

const handle = (run) => async (req, res, next) => {
  try {
    const data = await run(req);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (error instanceof GooglePlacesError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    return next(error);
  }
};

export const searchGoogleBusinesses = handle((req) =>
  searchBusinesses(req.query.q, req.query.sessionToken)
);

export const getGoogleBusinessPlace = handle((req) =>
  getPlaceSummary(req.params.placeId, req.query.sessionToken)
);

export const resolveGoogleBusinessLink = handle(async (req) => ({
  placeId: await resolveShareLink(req.body.url),
}));

export const getVendorGoogleBusiness = handle((req) => getLink(req.params.id));

export const linkVendorGoogleBusiness = handle((req) =>
  linkByVendor(req.params.id, req.body.placeId, req.body.sessionToken)
);

export const unlinkVendorGoogleBusiness = handle(async (req) => {
  await unlink(req.params.id);
  return null;
});

export const adminListPendingGoogleBusiness = handle(() => listPendingLinks());

export const adminLinkGoogleBusiness = handle((req) => linkByEm(req.params.id, req.body.placeId));

export const adminApproveGoogleBusiness = handle((req) => reviewLink(req.params.id, true));

export const adminRejectGoogleBusiness = handle((req) => reviewLink(req.params.id, false));

export const getPublicGoogleReviews = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const query = mongoose.Types.ObjectId.isValid(vendorId)
      ? { $or: [{ _id: vendorId }, { id: vendorId }], ...VISIBLE_VENDOR_FILTER }
      : { id: vendorId, ...VISIBLE_VENDOR_FILTER };
    const vendor = await Vendor.findOne(query).select("id googleBusiness").lean();
    if (!vendor) {
      return res.status(404).json({ status: "FAILED", message: "Vendor not found" });
    }
    if (vendor.googleBusiness?.status !== "linked") {
      return res.status(200).json({ status: "SUCCESS", googleReviews: null });
    }
    const { placeId } = vendor.googleBusiness;
    return res.status(200).json({
      status: "SUCCESS",
      googleReviews: {
        placeId,
        embedUrl: placeEmbedUrl(placeId),
        googleMapsUrl: placeMapsUrl(placeId),
      },
    });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch Google reviews" });
  }
};
