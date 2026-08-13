/**
 * Rounds to 2 decimal places, tolerating null/NaN inputs (common throughout
 * the pricing/comparison code, where a field may legitimately be unset).
 */
export function round2(n) {
  return n == null || isNaN(n) ? null : Math.round(n * 100) / 100;
}

export default round2;
