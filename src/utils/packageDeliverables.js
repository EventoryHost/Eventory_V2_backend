/**
 * Extracts the deliverable-bearing slice of a package's step-2 payload so it
 * can be snapshotted onto a booking.
 */

const toPlain = (value) =>
  value && typeof value.toObject === "function" ? value.toObject() : value;

const pick = (source, keys) => {
  const out = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
};

/** Keys carrying deliverables, per discriminator value on Package. */
const KEYS_BY_VENDOR_TYPE = {
  VenueProvider: ["spaces", "inHouseServices", "addOns"],
  DJArtist: ["items", "equipments", "playlists", "hasBackupEquipment", "addOns"],
  Decorator: ["setups", "addOns"],
  Caterer: ["menus", "crockery", "addOns"],
  PAV: ["packageItems", "addOns"],
  MakeupArtist: [
    "items",
    "drapingIncluded",
    "drapingServiceTypes",
    "addOns",
  ],
};

/** Present on every type. */
const COMMON_KEYS = ["included", "notIncluded"];

export const snapshotDeliverables = (pkg) => {
  const step2 = toPlain(pkg?.step2_productsAndPricing);
  if (!step2) return null;

  const typeKeys = KEYS_BY_VENDOR_TYPE[pkg.vendorType];

  // Unknown vendor type: keep the payload whole rather than silently dropping
  // deliverables a new package type introduced.
  if (!typeKeys) return step2;

  return pick(step2, [...typeKeys, ...COMMON_KEYS]);
};
