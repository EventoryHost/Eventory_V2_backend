import Package from "../models/Package.js";
import DeletedPackage from "../models/DeletedPackage.js";

export const PACKAGE_RETENTION_DAYS = Number(
  process.env.PACKAGE_RETENTION_DAYS || 28
);

export const packageRetentionWindowMs = () =>
  PACKAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export const dueForPurgeFilter = (cutoff) => ({
  packageStatus: "Deleted",
  $or: [
    { deletedAt: { $lte: cutoff } },
    { deletedAt: null, updatedAt: { $lte: cutoff } },
  ],
});

const hasEntries = (value) => Array.isArray(value) && value.length > 0;

const ITEM_CHECKS = {
  Caterer: (step2) =>
    (step2.menus ?? []).some(
      (menu) =>
        (menu.categories ?? []).some((category) => hasEntries(category.items)) ||
        Object.values(menu.items ?? {}).some(hasEntries)
    ),
  Decorator: (step2) => hasEntries(step2.setups),
  PAV: (step2) => hasEntries(step2.packageItems),
  DJArtist: (step2) => hasEntries(step2.items),
  MakeupArtist: (step2) => hasEntries(step2.items),
  VenueProvider: (step2) => hasEntries(step2.spaces),
};

export function hasAtLeastOneItem(pkg) {
  const check = ITEM_CHECKS[pkg.vendorType];
  return Boolean(check?.(pkg.step2_productsAndPricing ?? {}));
}

export function isCompleteThroughStep3(pkg) {
  const steps = new Set((pkg.completedSteps ?? []).map(Number));
  return steps.has(1) && steps.has(3) && hasAtLeastOneItem(pkg);
}

export async function purgeDeletedPackage(pkg, cutoff) {
  const archive = isCompleteThroughStep3(pkg);

  if (archive) {
    await DeletedPackage.replaceOne(
      { _id: pkg._id },
      { ...pkg, archivedAt: new Date() },
      { upsert: true }
    );
  }

  const { deletedCount } = await Package.deleteOne({
    _id: pkg._id,
    ...dueForPurgeFilter(cutoff),
  });

  if (deletedCount === 0) {
    if (archive) await DeletedPackage.deleteOne({ _id: pkg._id });
    return "skipped";
  }
  return archive ? "archived" : "removed";
}

export function findPackagesDueForPurge(cutoff) {
  return Package.find(dueForPurgeFilter(cutoff)).lean().cursor();
}
