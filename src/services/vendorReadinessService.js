/**
 * Whether a vendor may send a package for review: both onboarding steps —
 * Business Profile Setup and Personal Documents — have to be complete first.
 *
 * Mirrors the vendor app's ProfileSetupResolver (businessProfileSteps /
 * personalDocsSteps) so the app's message and this refusal agree. GST is
 * optional but not ignorable: it counts once verified or deliberately skipped
 * (Vendor.isGstSkipped).
 */

const isBlank = (s) => s == null || String(s).trim() === "";
const isEmptyList = (l) => !Array.isArray(l) || l.length === 0;

/** Fields the check reads — select these when loading the vendor. */
export const READINESS_FIELDS = [
  "businessName",
  "pocName",
  "email",
  "isIndividual",
  "teamSize",
  "bookingsPerYear",
  "experience",
  "vendorType",
  "eventCategories",
  "serviceAreas",
  "profilePicture",
  "description",
  "businessPhotos",
  "isAgreementAccepted",
  "agreementDocUrl",
  "aadharNumber",
  "isAadharVerified",
  "panNumber",
  "isPanVerified",
  "gstNumber",
  "isGstVerified",
  "isGstSkipped",
  "bankDetails",
].join(" ");

/**
 * @returns {{ businessProfile: string[], personalDocuments: string[] }}
 * the missing items of each step, by field name; both empty when ready.
 */
export const profileGaps = (vendor) => {
  const v = vendor || {};
  const businessProfile = [
    isBlank(v.businessName) && "businessName",
    isBlank(v.pocName) && "pocName",
    isBlank(v.email) && "email",
    !v.isIndividual && isBlank(v.teamSize) && "teamSize",
    isBlank(v.bookingsPerYear) && "bookingsPerYear",
    isBlank(v.experience) && "experience",
    isBlank(v.vendorType) && "vendorType",
    isEmptyList(v.eventCategories) && "eventCategories",
    isEmptyList(v.serviceAreas) && "serviceAreas",
    isBlank(v.profilePicture) && "profilePicture",
    isBlank(v.description) && "description",
    isEmptyList(v.businessPhotos) && "businessPhotos",
    // A stored agreement document means the same as the flag for profiles
    // accepted before the flag existed.
    !(v.isAgreementAccepted || !isBlank(v.agreementDocUrl)) && "agreement",
  ].filter(Boolean);

  const personalDocuments = [
    !(v.isAadharVerified && !isBlank(v.aadharNumber)) && "aadhaar",
    !(v.isPanVerified && !isBlank(v.panNumber)) && "pan",
    !((v.isGstVerified && !isBlank(v.gstNumber)) || v.isGstSkipped) && "gst",
    isEmptyList(v.bankDetails) && "bankDetails",
  ].filter(Boolean);

  return { businessProfile, personalDocuments };
};

export const isReadyToSubmit = (vendor) => {
  const { businessProfile, personalDocuments } = profileGaps(vendor);
  return businessProfile.length === 0 && personalDocuments.length === 0;
};

export default { profileGaps, isReadyToSubmit, READINESS_FIELDS };
