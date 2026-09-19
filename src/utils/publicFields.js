/**
 * Shared field whitelists for projecting vendor-authored documents into
 * customer-facing responses. Centralized here (rather than duplicated per
 * controller) so every customer-facing read of a Vendor document — browse,
 * PDP, reviews, wishlist, and anything added later — enforces the exact
 * same privacy rule from one place.
 *
 * businessName is deliberately NOT here: customer-facing surfaces show the
 * vendor's own name (pocName), never the registered business name. Anything
 * that used to sniff a resolved vendor object via `.businessName` must key
 * off `.id` instead — see resolveVendor.js.
 *
 * Per the Vendor Page PRD (see info.txt PART 3): customers never see a
 * vendor's direct contact info or verification/KYC internals. Deliberately
 * excludes: email, phone, aadharNumber/panNumber/gstNumber + their doc
 * URLs, bankDetails, agreementDocUrl, isDarkMode, faceMatchScore, and the
 * raw isAadharVerified/isPanVerified/isGstVerified/isFssaiVerified/
 * isTradeLicVerified flags (internal KYC granularity — customers only need
 * the overall isVerified).
 *
 * businessName excluded, pocName included instead — added 2026-09-14 per an
 * explicit product rule: the customer side must show the vendor's real
 * (point-of-contact) full name, never their registered business name, and
 * businessName must never reach the customer frontend at all. This is the
 * ONE whitelist nearly every customer-facing vendor read goes through
 * (resolveVendorForPackage's default, getVendorDetail, browseVendors), so
 * fixing it here is enough to cover all of them — see info.txt for the
 * full list of the few call sites that read/expose vendor.businessName
 * directly instead of through this whitelist, which needed their own fix.
 * Confirmed real data: every vendor behind a currently-Live package has a
 * genuine, populated pocName (a real person's name, e.g. "Aniket kumar",
 * "ABHISHEK RAM TRIPATHI") — not a placeholder gap like some other fields
 * found this engagement.
 */
export const PUBLIC_VENDOR_FIELDS =
  "id pocName isIndividual vendorType eventCategories city state serviceAreas " +
  "teamSize bookingsPerYear experience profilePicture description businessPhotos " +
  "coverImage isVerified rating reviewsCount wishlistCount createdAt";
