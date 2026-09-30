/** Escape user input for use inside a RegExp / $regex, so "+91(" is a literal. */
export const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default escapeRegex;
