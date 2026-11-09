import CommercialRuleSet from "../../models/CommercialRuleSet.js";
import { RULES_V1 } from "./rules.v1.js";

/**
 * Loads the ACTIVE commercial rule set. Falls back to the bundled v1 rules
 * (rules.v1.js) when no DB set has been activated yet, so the engine works
 * on a fresh database without a seed step.
 *
 * Cached for CACHE_MS; activating a new set calls clearRuleCache().
 *
 * Rule documents are stored as JSON, which cannot hold Infinity — the table
 * rows that use it as an open upper/lower bound are restored on load.
 */

const CACHE_MS = 60 * 1000;
let cache = null;

const OPEN_BOUNDS = [
  ["pciBands", 0, "min", -Infinity],
  ["cpciBands", -1, "max", Infinity],
  ["behaviour.responseTimeScore", -1, "maxMinutes", Infinity],
  ["behaviour.failureRateScore", -1, "maxPct", Infinity],
];

const get = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);

export function reviveRules(rules) {
  for (const [path, index, key, value] of OPEN_BOUNDS) {
    const table = get(rules, path);
    if (!Array.isArray(table) || !table.length) continue;
    const row = table.at(index);
    if (row[key] == null) row[key] = value;
  }
  return rules;
}

/** JSON-safe copy for storage (Infinity -> null, restored by reviveRules). */
export function serializeRules(rules) {
  return JSON.parse(JSON.stringify(rules, (_k, v) => (v === Infinity || v === -Infinity ? null : v)));
}

export async function getActiveRules() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rules;
  const doc = await CommercialRuleSet.findOne({ status: "ACTIVE" }).sort({ activatedAt: -1 }).lean();
  const rules = doc ? reviveRules(doc.rules) : RULES_V1;
  cache = { at: Date.now(), rules };
  return rules;
}

export function clearRuleCache() {
  cache = null;
}
