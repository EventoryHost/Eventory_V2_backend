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
 */
export const PUBLIC_VENDOR_FIELDS =
  "id pocName isIndividual vendorType eventCategories city state serviceAreas " +
  "teamSize bookingsPerYear experience profilePicture description businessPhotos " +
  "coverImage isVerified rating reviewsCount wishlistCount createdAt";
