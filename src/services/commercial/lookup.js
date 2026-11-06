/**
 * Table helpers shared by the commercial engine. Rule tables are ordered
 * lists; `byMin` returns the last row whose inclusive `min` the value reaches,
 * `byMax` the first row whose inclusive upper bound covers it.
 */

export function byMin(table, value) {
  let hit = null;
  for (const row of table) {
    if (value >= row.min) hit = row;
    else break;
  }
  return hit;
}

export function byMax(table, value, key = "max") {
  return table.find((row) => value <= row[key]) ?? null;
}

/**
 * Weighted mean over the factors that are present. NULL factors are dropped
 * and the remaining weights renormalised (PRD §2 "Missing is not zero").
 */
export function renormalisedMean(parts) {
  const present = parts.filter((p) => p.value != null);
  const totalWeight = present.reduce((s, p) => s + p.weight, 0);
  if (!totalWeight) return null;
  return present.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight;
}

/** Rounds `value` to the nearest multiple of `step` (half up). */
export function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

/** Percentage helper that keeps rates readable (4.75 means 4.75%). */
export function pctOf(amount, ratePct) {
  return (amount * ratePct) / 100;
}
