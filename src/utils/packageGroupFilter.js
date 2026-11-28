/**
 * Kept as a re-export so existing imports keep working. The implementation
 * lives in utils/packageGroup.js — there used to be two copies of this logic,
 * which is how a fix to one never reached the other.
 */
export { buildGroupFilter } from "./packageGroup.js";
export { buildGroupFilter as default } from "./packageGroup.js";
