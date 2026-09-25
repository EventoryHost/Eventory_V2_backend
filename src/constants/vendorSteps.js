/**
 * The vendor profile steps: the one vocabulary the backend, the admin panel
 * (vendorSteps.ts) and the vendor app (vendor_steps.dart) share.
 *
 * A step is the unit an admin marks Correct / Not correct, the unit the vendor
 * is sent back to fix, and the unit the completion percentage counts. The
 * granularity follows the app's own setup screens so that one flagged step
 * opens exactly one screen. The admin panel's eight section cards are only a
 * grouping over these (`section`).
 *
 * `fields` does double duty:
 *   - it is the whitelist an admin edit of the step may write, and
 *   - it maps a changed Vendor field back to its step (STEP_BY_FIELD) so a
 *     vendor edit resets that step's review.
 *
 * `counted: false` steps are reviewable but never part of the percentage.
 *
 * `group` is the review group the step is decided in. The admin approves,
 * sends back or rejects each group on its own: "businessProfile" (the
 * "Set up Business Profile" flow) and "personalDocuments" (KYC and bank).
 *
 * Renaming a key is a breaking change for stored reviews and both clients.
 */

const has = (value) => value !== undefined && value !== null && String(value).trim() !== "";
const nonEmpty = (list) => Array.isArray(list) && list.length > 0;

export const VENDOR_STEPS = [
  {
    key: "businessName",
    group: "businessProfile",
    label: "Business Name",
    section: "businessProfile",
    fields: ["businessName", "isIndividual"],
    counted: true,
    isFilled: (v) => has(v.businessName),
  },
  {
    key: "pointOfContact",
    group: "businessProfile",
    label: "Point of Contact",
    section: "contactAndLocation",
    fields: ["pocName", "pocPhone", "additionalPocs"],
    counted: true,
    isFilled: (v) => has(v.pocName),
  },
  {
    key: "businessEmail",
    group: "businessProfile",
    label: "Business Email",
    section: "contactAndLocation",
    fields: ["email"],
    counted: true,
    isFilled: (v) => has(v.email),
  },
  {
    key: "businessScale",
    group: "businessProfile",
    label: "Team & Experience",
    section: "experienceAndTeam",
    fields: ["teamSize", "bookingsPerYear", "experience"],
    counted: true,
    // An individual has no team, so teamSize is not asked of them.
    isFilled: (v) =>
      has(v.bookingsPerYear) && has(v.experience) && (Boolean(v.isIndividual) || has(v.teamSize)),
  },
  {
    key: "servicesAndEvents",
    group: "businessProfile",
    label: "Services & Event Types",
    section: "businessProfile",
    fields: ["vendorType", "eventCategories"],
    counted: true,
    isFilled: (v) => has(v.vendorType) && nonEmpty(v.eventCategories),
  },
  {
    key: "serviceAreas",
    group: "businessProfile",
    label: "Service Areas",
    section: "contactAndLocation",
    fields: ["serviceAreas", "city", "state"],
    counted: true,
    isFilled: (v) => nonEmpty(v.serviceAreas),
  },
  {
    key: "profilePicture",
    group: "businessProfile",
    label: "Profile Picture",
    section: "photosAndBranding",
    fields: ["profilePicture", "coverImage"],
    counted: true,
    isFilled: (v) => has(v.profilePicture),
  },
  {
    key: "aboutBrand",
    group: "businessProfile",
    label: "About the Brand",
    section: "businessProfile",
    fields: ["description"],
    counted: true,
    isFilled: (v) => has(v.description),
  },
  {
    key: "businessPhotos",
    group: "businessProfile",
    label: "Business Photos",
    section: "photosAndBranding",
    // The Vendor model has no gallery-video field; photos only.
    fields: ["businessPhotos"],
    counted: true,
    isFilled: (v) => nonEmpty(v.businessPhotos),
  },
  {
    key: "agreement",
    group: "businessProfile",
    label: "Vendor Agreement",
    section: "agreement",
    fields: ["isAgreementAccepted", "agreementDocUrl"],
    counted: true,
    isFilled: (v) => Boolean(v.isAgreementAccepted) || has(v.agreementDocUrl),
  },
  {
    key: "aadhaar",
    group: "personalDocuments",
    label: "Aadhaar",
    section: "kycDocuments",
    fields: ["aadharNumber", "isAadharVerified", "isFaceMatchVerified"],
    counted: true,
    isFilled: (v) => Boolean(v.isAadharVerified) && has(v.aadharNumber),
  },
  {
    key: "pan",
    group: "personalDocuments",
    label: "PAN",
    section: "kycDocuments",
    fields: ["panNumber", "isPanVerified"],
    counted: true,
    isFilled: (v) => Boolean(v.isPanVerified) && has(v.panNumber),
  },
  {
    key: "gst",
    group: "personalDocuments",
    label: "GST",
    section: "kycDocuments",
    fields: ["gstNumber", "isGstVerified", "isGstSkipped"],
    counted: true,
    isFilled: (v) => (Boolean(v.isGstVerified) && has(v.gstNumber)) || Boolean(v.isGstSkipped),
  },
  {
    key: "bankDetails",
    group: "personalDocuments",
    label: "Bank Account",
    section: "bankDetails",
    fields: ["bankDetails"],
    counted: true,
    isFilled: (v) => nonEmpty(v.bankDetails),
  },
  {
    key: "businessDocuments",
    group: "businessProfile",
    label: "Business Documents",
    section: "businessLicenses",
    // The first three are what the app uploads; the rest are the older
    // number/URL fields the admin panel's Licenses card reads.
    fields: [
      "fssaiLicense",
      "tradeLicense",
      "gstCertificate",
      "fssaiNumber",
      "fssaiDocUrl",
      "isFssaiVerified",
      "tradeLicenseNumber",
      "tradeLicUrl",
      "isTradeLicVerified",
      "gstDocUrl",
    ],
    counted: false,
    isFilled: (v) =>
      ["fssaiLicense", "tradeLicense", "gstCertificate", "fssaiDocUrl", "tradeLicUrl", "gstDocUrl"].some(
        (f) => has(v[f])
      ),
  },
];

export const VENDOR_GROUPS = ["businessProfile", "personalDocuments"];

export const GROUP_LABELS = {
  businessProfile: "Business Profile",
  personalDocuments: "Personal Documents",
};

export const STEP_KEYS = VENDOR_STEPS.map((s) => s.key);

/** group -> its stepKeys, in order. */
export const STEPS_BY_GROUP = Object.fromEntries(
  VENDOR_GROUPS.map((g) => [g, VENDOR_STEPS.filter((s) => s.group === g).map((s) => s.key)])
);

export const isGroupKey = (key) => typeof key === "string" && VENDOR_GROUPS.includes(key);

export const STEP_BY_KEY = Object.fromEntries(VENDOR_STEPS.map((s) => [s.key, s]));

/** Vendor field -> the stepKey it belongs to. */
export const STEP_BY_FIELD = Object.fromEntries(
  VENDOR_STEPS.flatMap((s) => s.fields.map((f) => [f, s.key]))
);

/** The eight admin section cards (and the legacy adminReview keys) -> their steps. */
export const LEGACY_SECTION_STEPS = VENDOR_STEPS.reduce((acc, s) => {
  (acc[s.section] ||= []).push(s.key);
  return acc;
}, {});

export const LEGACY_SECTIONS = Object.keys(LEGACY_SECTION_STEPS);

export const isStepKey = (key) => typeof key === "string" && Object.hasOwn(STEP_BY_KEY, key);

export default VENDOR_STEPS;
