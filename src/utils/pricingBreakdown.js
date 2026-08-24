/**
 * Derives the "Pricing Breakdown" card from a booking or an enquiry proposal.
 *
 * Both carry the same two fields this reads — `pricing` and `packageSnapshot` —
 * so one derivation serves the booking details screen and the customise
 * proposal screen, and a converted enquiry prices identically to the booking it
 * becomes.
 *
 * The vendor prices a negotiation in bulk: one cumulative figure for everything
 * added, one for the add-ons, and so on — not a price per requested item. Those
 * figures live on `pricing` as positive magnitudes; this applies the signs,
 * computes tax on the subtotal and returns the rows in the order the card
 * renders them.
 *
 * Nothing here is stored. `totalAmount` is written from `finalAmount` only so
 * lists and the transactions module can read a total without recomputing it.
 */

const round2 = (value) => Math.round(value * 100) / 100;

const ADDITION_ROWS = [
  { key: "itemsAdded", label: "Items Added" },
  { key: "addonsAdded", label: "Add-ons added" },
];

const DEDUCTION_ROWS = [
  { key: "itemsRemoved", label: "Items Removed" },
  { key: "addonsRemoved", label: "Add-ons removed" },
];

const sumRows = (rows) => rows.reduce((total, row) => total + row.amount, 0);

const buildPricingBreakdown = (record) => {
  const pricing = record.pricing || {};
  const originalPackagePrice =
    pricing.basePrice ?? record.packageSnapshot?.price ?? 0;

  const additions = ADDITION_ROWS.map((row) => ({
    key: row.key,
    label: row.label,
    amount: round2(pricing[row.key] || 0),
  })).filter((row) => row.amount !== 0);

  const deductions = DEDUCTION_ROWS.map((row) => ({
    key: row.key,
    label: row.label,
    amount: -round2(pricing[row.key] || 0),
  })).filter((row) => row.amount !== 0);

  const discountAmount = pricing.discountAmount || 0;
  if (discountAmount) {
    deductions.push({
      key: "discountAllowed",
      label: pricing.discountLabel || "Discount Allowed",
      amount: -round2(discountAmount),
    });
  }

  const subtotal = round2(
    originalPackagePrice + sumRows(additions) + sumRows(deductions)
  );

  const taxRatePct =
    pricing.taxRatePct ?? record.packageSnapshot?.gstRatePercent ?? 0;
  const tax = {
    label: `Taxes (${taxRatePct}% ${pricing.taxLabel || "GST"})`,
    ratePct: taxRatePct,
    amount: round2((subtotal * taxRatePct) / 100),
  };

  return {
    originalPackagePrice: round2(originalPackagePrice),
    additions,
    deductions,
    subtotal,
    tax,
    finalAmount: round2(subtotal + tax.amount),
  };
};

/**
 * Recomputes the breakdown and writes the derived total back onto the record.
 * Call after anything that can move the price.
 */
export const applyPricingBreakdown = (record) => {
  const breakdown = buildPricingBreakdown(record);
  record.totalAmount = breakdown.finalAmount;
  return breakdown;
};

/** Attaches the breakdown to a record about to be sent over the wire. */
export const withPricingBreakdown = (record) => {
  const plain =
    typeof record?.toObject === "function" ? record.toObject() : record;
  if (!plain) return plain;
  return { ...plain, pricingBreakdown: buildPricingBreakdown(plain) };
};
