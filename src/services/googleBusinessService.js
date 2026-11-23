import Vendor from "../models/Vendor.js";
import { normalizePhone } from "../utils/phone.js";
import { getPlaceSummary, GooglePlacesError } from "./googlePlacesService.js";

const VENDOR_PHONE_FIELDS = "id phone pocPhone additionalPocs googleBusiness";

const vendorPhones = (vendor) =>
  new Set(
    [vendor.phone, vendor.pocPhone, ...(vendor.additionalPocs ?? []).map((p) => p?.phone)]
      .map(normalizePhone)
      .filter(Boolean)
  );

export const phoneMatchesVendor = (vendor, listingPhone) => {
  const listing = normalizePhone(listingPhone);
  return Boolean(listing) && vendorPhones(vendor).has(listing);
};

const findVendor = async (vendorId, select = VENDOR_PHONE_FIELDS) => {
  const vendor = await Vendor.findOne({ id: vendorId }).select(select).lean();
  if (!vendor) throw new GooglePlacesError("Vendor not found", 404);
  return vendor;
};

const saveLink = async (vendorId, googleBusiness) => {
  await Vendor.updateOne({ id: vendorId }, { $set: { googleBusiness } });
  return googleBusiness;
};

const withPlace = async (googleBusiness) => {
  if (!googleBusiness?.placeId) return { googleBusiness: null, place: null };
  try {
    return { googleBusiness, place: await getPlaceSummary(googleBusiness.placeId) };
  } catch (error) {
    if (error instanceof GooglePlacesError && error.status === 503) throw error;
    return { googleBusiness, place: null };
  }
};

export const getLink = async (vendorId) => {
  const vendor = await findVendor(vendorId, "id googleBusiness");
  return withPlace(vendor.googleBusiness);
};

export const linkByVendor = async (vendorId, placeId, sessionToken) => {
  const vendor = await findVendor(vendorId);
  const place = await getPlaceSummary(placeId, sessionToken);
  const matched = phoneMatchesVendor(vendor, place.phone);
  const googleBusiness = await saveLink(vendorId, {
    placeId: place.placeId,
    status: matched ? "linked" : "pending",
    verifiedVia: matched ? "phone_match" : null,
    linkedAt: new Date(),
    reviewedAt: null,
  });
  return { googleBusiness, place };
};

export const linkByEm = async (vendorId, placeId) => {
  await findVendor(vendorId, "id");
  const place = await getPlaceSummary(placeId);
  const now = new Date();
  const googleBusiness = await saveLink(vendorId, {
    placeId: place.placeId,
    status: "linked",
    verifiedVia: "em",
    linkedAt: now,
    reviewedAt: now,
  });
  return { googleBusiness, place };
};

export const reviewLink = async (vendorId, approve) => {
  const vendor = await findVendor(vendorId, "id googleBusiness");
  if (!vendor.googleBusiness?.placeId) {
    throw new GooglePlacesError("This vendor has no Google Business linked", 404);
  }
  const googleBusiness = await saveLink(vendorId, {
    ...vendor.googleBusiness,
    status: approve ? "linked" : "rejected",
    verifiedVia: approve ? "em" : null,
    reviewedAt: new Date(),
  });
  return withPlace(googleBusiness);
};

export const unlink = async (vendorId) => {
  await findVendor(vendorId, "id");
  await Vendor.updateOne({ id: vendorId }, { $set: { googleBusiness: null } });
};

export const listPendingLinks = () =>
  Vendor.find({ "googleBusiness.status": "pending" })
    .select("id businessName pocName phone pocPhone googleBusiness")
    .sort({ "googleBusiness.linkedAt": 1 })
    .lean();

export default {
  getLink,
  linkByVendor,
  linkByEm,
  reviewLink,
  unlink,
  listPendingLinks,
  phoneMatchesVendor,
};
