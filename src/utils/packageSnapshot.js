import { snapshotDeliverables } from "./packageDeliverables.js";
import { packageCoverImage } from "./packageCoverImage.js";
import { getEffectivePackagePrice } from "./packagePrice.js";
import { normalizeGroupId } from "./packageGroup.js";

/**
 * Point-in-time copies of a package variant, taken when it is quoted or
 * booked. One builder per shape so every booking path freezes the same
 * fields. Before this, four controllers each spelled the snapshot out by hand.
 *
 * The snapshot is what booking history shows. Renaming, repricing,
 * deactivating or deleting the variant later never changes it
 * (PackageSnapshotSchema marks every field immutable).
 */

/** The variant's display name, or null — never an invented default like "Premium". */
const variantLabel = (pkg) =>
  typeof pkg?.variantType === "string" && pkg.variantType.trim()
    ? pkg.variantType.trim()
    : null;

/** Booking / enquiry snapshot — Booking.packageSnapshot (PackageSnapshotSchema). */
export const buildPackageSnapshot = (pkg) => ({
  name: pkg.step1_eventAndCrew?.packageName || "Untitled Package",
  // getEffectivePackagePrice, not a plain read — packagePricing.price is
  // never set for Caterer/Decorator packages.
  price: getEffectivePackagePrice(pkg),
  image: packageCoverImage(pkg),
  vendorType: pkg.vendorType || null,
  variantType: variantLabel(pkg),
  gstRatePercent: pkg.step3_policiesAndCharges?.gstRatePercent ?? null,
  gstInclusive: pkg.step3_policiesAndCharges?.gstInclusive ?? false,
  // Variant-specific inclusions and configuration (included / notIncluded,
  // setups, menus, items, add-ons… per vendor type).
  deliverables: snapshotDeliverables(pkg),
});

/**
 * Cart item / checkout line snapshot. GST is deliberately absent: it stays
 * sourced from the live quote and is frozen onto the booking at payment.
 */
export const buildLineSnapshot = (pkg, { withDeliverables = true } = {}) => ({
  name: pkg.step1_eventAndCrew?.packageName,
  price: getEffectivePackagePrice(pkg),
  billingUnit:
    pkg.step3_policiesAndCharges?.packagePricing?.billingUnit ??
    pkg.step3_policiesAndCharges?.teamAndEquipment?.billingUnit ??
    null,
  image: packageCoverImage(pkg),
  vendorType: pkg.vendorType,
  variantType: variantLabel(pkg),
  ...(withDeliverables ? { deliverables: snapshotDeliverables(pkg) } : {}),
});

/** The logical package a booking belongs to; a pre-group document is its own group. */
export const packageGroupIdOf = (pkg) => {
  if (!pkg) return null;
  // A hydrated document that predates groups gets packageGroupId from the
  // schema default (a freshly minted id) — that is not its group; it is a
  // package of one, keyed by its own _id like everywhere else.
  const isSchemaDefault = typeof pkg.$isDefault === "function" && pkg.$isDefault("packageGroupId");
  return (!isSchemaDefault && normalizeGroupId(pkg.packageGroupId)) || String(pkg._id);
};

export default { buildPackageSnapshot, buildLineSnapshot, packageGroupIdOf };
