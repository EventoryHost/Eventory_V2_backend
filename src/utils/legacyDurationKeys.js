/**
 * Compatibility shim for app builds that still send in-house service
 * durations in minutes under the old keys. Package durations are decimal
 * hours now, and the step-2 schemas no longer declare the *Minutes keys, so
 * strict mode would otherwise drop those values without an error.
 *
 * Remove this (and its call sites in packageController.js) once every app
 * build sends the *Hours keys.
 */

const LEGACY_DURATION_KEYS = {
  setupDurationMinutes: "setupDurationHours",
  durationPerPersonMinutes: "durationPerPersonHours",
  minDurationMinutes: "minDurationHours",
  maxDurationMinutes: "maxDurationHours",
};

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Rewrites the old keys on one object; a new key sent alongside wins. */
const upgradeHolder = (holder) => {
  if (!isObject(holder)) return;
  for (const [oldKey, newKey] of Object.entries(LEGACY_DURATION_KEYS)) {
    if (!Object.prototype.hasOwnProperty.call(holder, oldKey)) continue;
    const minutes = Number(holder[oldKey]);
    const hasNew = holder[newKey] !== undefined && holder[newKey] !== null;
    if (!hasNew && holder[oldKey] !== null && holder[oldKey] !== "" && Number.isFinite(minutes)) {
      holder[newKey] = Math.round((minutes / 60) * 100) / 100;
    }
    delete holder[oldKey];
  }
};

const upgradeEntries = (entries) => {
  if (Array.isArray(entries)) entries.forEach((entry) => upgradeHolder(entry?.data));
};

/**
 * Upgrades, in place, an incoming step-2 payload or a fragment of one:
 *  - a step-2 body (standalone package), and its inHouseServices.<svc>[].data
 *  - dotted keys such as "inHouseServices.caterer": [...]
 *  - a single in-house service entry or update ({ data: { ... } })
 * Returns the same object for convenience.
 */
export const upgradeLegacyDurationKeys = (body) => {
  if (!isObject(body)) return body;
  upgradeHolder(body);
  upgradeHolder(body.data);
  if (isObject(body.inHouseServices)) {
    Object.values(body.inHouseServices).forEach(upgradeEntries);
  }
  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith("inHouseServices.")) {
      if (Array.isArray(value)) upgradeEntries(value);
      else upgradeHolder(value?.data ?? value);
    }
  }
  return body;
};
