/**
 * Commercial engine output check — runs the PRD worked examples and the
 * tech-team ticket cases (corrected to the PRD) through the engine and
 * prints expected vs actual. Pure: no DB, no env.
 *
 *   node commercialEngineCheck.mjs
 */
import { RULES_V1 as R } from "./src/services/commercial/rules.v1.js";
import { preEventoryScore, demandTierFromScore, commercialCategory } from "./src/services/commercial/categoryEngine.js";
import { vendorCommission } from "./src/services/commercial/commissionEngine.js";
import { priceLine, priceAllModes, vendorSettlement } from "./src/services/commercial/pricingEngine.js";
import { evaluatePublication } from "./src/services/commercial/publicationEngine.js";

let pass = 0;
let fail = 0;
const failures = [];
function eq(label, actual, expected, tol = 0.01) {
  const ok =
    typeof expected === "number" ? Math.abs(actual - expected) <= tol : JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  if (!ok) failures.push(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  return ok;
}

const DAYS = { SAME_DAY: 0, D1_3: 2, D4_7: 5, D8_13: 10, D14_20: 18, D21_PLUS: 25 };
const MODE = { ADV: "ADVANCE_PAY_BOOK", ZP: "ZERO_PAY_BOOK", QUOTE: "ENQUIRE_QUOTE" };

// ── 1. Rahul Decorators (PRD §3, §17) ────────────────────────────────────
console.log("\n# Rahul Decorators (PRD §3, §17)");
const rahulVendor = { bookingsLast12Months: 62, yearsOfOperation: 5, teamSize: 10, gstRegistered: false };
const pre = preEventoryScore(rahulVendor, R);
eq("pre-Eventory score", pre.score, 52);
eq("demand tier", demandTierFromScore(pre.score, R), "MODERATE");
eq("category", commercialCategory("CRITICAL", "MODERATE", R), "CAT_2");

const pub = evaluatePublication({
  vendor: rahulVendor,
  pkg: {
    eventoryApprovedCriticality: "CRITICAL",
    vendorB2BPrice: 18000,
    b2cPriceVerified: true,
    verifiedVendorB2CPrice: 22000,
    marketPriceLow: 19000,
    marketPriceMedian: 21500,
    marketPriceHigh: 24000,
  },
});
eq("publication band", pub.baseline.band, "GROWTH");
eq("PCI", pub.baseline.pci, 18.18);
eq("PCI band", pub.baseline.pciBand, "VERY_GOOD");
eq("MCT", pub.snapshot.mct, 900);
eq("publication outcome", pub.outcome, "APPROVED_FIXED");
eq("modes", pub.modes, { ADVANCE_PAY_BOOK: true, ZERO_PAY_BOOK: true, ENQUIRE_QUOTE: true });

const rahul = priceLine({
  vendor: { gstRegistered: false, monetizationModel: "COMMISSION" },
  baseline: pub.baseline,
  runtime: { bookingMode: MODE.ADV, negotiationMode: "NONE", daysToEvent: 18 },
});
eq("commission rate", rahul.commission.rate, 4.75);
eq("commission before rounding", rahul.commission.beforeRounding, 855);
eq("commission after rounding", rahul.commission.afterRounding, 850);
eq("fee commercial rate", rahul.serviceFee.commercialRate, 6.5);
eq("fee commercial amount", rahul.serviceFee.commercialFee, 1170);
eq("fee winner", rahul.serviceFee.winner, "COMMERCIAL");
eq("unrounded total", rahul.customer.unroundedTotal, 19380.6);
eq("display price", rahul.customer.displayPrice, 19499);
eq("back-solved taxable fee", rahul.serviceFee.taxableFee, 1270.34);
eq("GST on fee", rahul.serviceFee.gstOnFee, 228.66);
eq("CPCI", rahul.cpci.cpci, -9.31);
eq("CPCI band", rahul.cpci.band, "GOOD");
eq("status", rahul.status, "APPROVED");
console.log(
  `  MRER ${rahul.mrer.total} (MCT ${rahul.mrer.mct} + PG ${rahul.mrer.pg} + payout ${rahul.mrer.payout} + comm ${rahul.mrer.communication})` +
    ` | economic floor ${rahul.serviceFee.economicFloor} | revenue ${rahul.platformRevenue} | contribution ${rahul.contributionBeforeCac}`,
);

console.log("\n# Rahul, same package, same-day — all modes (PRD §17.5)");
const sameDay = priceAllModes({
  vendor: { gstRegistered: false, monetizationModel: "COMMISSION" },
  baseline: pub.baseline,
  runtime: { negotiationMode: "NONE", daysToEvent: 0, customer: { loggedIn: true, completedBookings: 0 } },
});
for (const [mode, r] of Object.entries(sameDay)) {
  console.log(
    `  ${mode.padEnd(17)} comm ${r.commission.rate}% → ₹${r.commission.afterRounding} | fee ${r.serviceFee.rate}% | price ₹${r.customer.displayPrice} | CPCI ${r.cpci.cpci}% ${r.cpci.band} | ${r.status} ${r.reasonCodes.join(",")}`,
  );
}
eq("same-day ZP commission lower than 18-day Advance", sameDay.ZERO_PAY_BOOK.commission.rate < rahul.commission.rate, true);
eq("same-day ZP fee higher than 18-day Advance", sameDay.ZERO_PAY_BOOK.serviceFee.rate > rahul.serviceFee.commercialRate, true);

// ── 2. CA settlement examples (PRD §15.3, §15.4) ─────────────────────────
console.log("\n# CA settlement examples (PRD §15.3, §15.4)");
const reg = vendorSettlement({ vendorB2B: 10000, vendorGst: 1800, gstRegistered: true, commission: 1000 }, R);
eq("registered: GST on commission", reg.gstOnCommission, 180);
eq("registered: TCS", reg.tcs, 50);
eq("registered: settlement", reg.settlement, 10570);
const unreg = vendorSettlement({ vendorB2B: 10000, vendorGst: 0, gstRegistered: false, commission: 1000 }, R);
eq("unregistered: TCS", unreg.tcs, 0);
eq("unregistered: settlement", unreg.settlement, 8820);

// ── 3. Ticket sheet: commission cases A–R (PRD rounding applied) ─────────
console.log("\n# Ticket commission cases A–R");
// [id, category, b2b, pciBand, lead, expectedFinalRate, expectedRounded, note]
const COMMISSION_CASES = [
  ["A", "CAT_1", 4000, "WEAK", "D21_PLUS", 7.0, 280],
  ["B", "CAT_2", 18000, "VERY_GOOD", "D14_20", 4.75, 850, "ticket ₹855 unrounded"],
  ["C", "CAT_6", 18000, "EXCELLENT", "SAME_DAY", 2.0, 400, "ticket ₹360; 350 after rounding breaks 2% → 400"],
  ["D", "CAT_3", 12000, "GOOD", "D8_13", 5.0, 600],
  ["E", "CAT_4", 8000, "FAIR", "D4_7", 5.25, 420],
  ["F", "CAT_5", 4000, "LOW", "D1_3", 5.0, 200],
  ["G", "CAT_1", 40000, "VERY_GOOD", "D14_20", 4.25, 1700],
  ["H", "CAT_2", 23000, "GOOD", "D8_13", 4.75, 1100, "ticket ₹1,092.50"],
  ["I", "CAT_3", 28000, "FAIR", "D4_7", 4.25, 1200, "ticket ₹1,190"],
  ["J", "CAT_4", 45000, "EXCELLENT", "D1_3", 2.0, 900],
  ["K", "CAT_5", 60000, "GOOD", "SAME_DAY", 2.0, 1200],
  ["L", "CAT_6", 80000, "EXCELLENT", "SAME_DAY", 2.0, 1600],
  ["M", "CAT_2", 5000, "VERY_GOOD", "D21_PLUS", 5.5, 280, "ticket treats ₹5K as MICRO (5.75%); PRD bands → ENTRY"],
  ["N", "CAT_3", 17000, "LOW", "D8_13", 5.75, 1000, "ticket ₹977.50"],
  ["O", "CAT_1", 24000, "WEAK", "D4_7", 6.0, 1450, "ticket ₹1,440"],
  ["P", "CAT_4", 14000, "GOOD", "D21_PLUS", 5.5, 750, "ticket ₹770"],
  ["Q", "CAT_5", 19000, "VERY_GOOD", "D14_20", 4.0, 750, "ticket ₹760"],
  ["R", "CAT_6", 9000, "FAIR", "D8_13", 4.75, 430, "ticket ₹427.50"],
];
for (const [id, category, b2b, pciBand, lead, rate, rounded, note] of COMMISSION_CASES) {
  const band = R.packageBands.filter((b) => b2b >= b.min).at(-1).band;
  const c = vendorCommission({ vendorB2B: b2b, category, band, pciBand, leadBucket: lead, monetizationModel: "COMMISSION" }, R);
  const ok = eq(`${id} rate`, c.rate, rate) & eq(`${id} rounded`, c.afterRounding, rounded);
  console.log(
    `  ${ok ? "✓" : "✗"} ${id} ${category} ${band.padEnd(10)} ${pciBand.padEnd(9)} ${lead.padEnd(8)} raw ${c.rawRate}% → ${c.rate}%  ₹${c.beforeRounding} → ₹${c.afterRounding}${note ? `   (${note})` : ""}`,
  );
}

// ── 4. Ticket sheet: service fee scenarios 1–20 (corrected to PRD) ───────
console.log("\n# Ticket service-fee scenarios 1–20 (unregistered vendor, no benchmark)");
// [#, band-check, category, pciBand, mode, negotiation, lead, b2b,
//  expected {commRate, feeRate, status, reason}, ticket {total, revenue}]
const FEE_CASES = [
  [1, "CAT_3", "FAIR", "ADV", "NONE", "D14_20", 4000, { comm: 6.25, fee: 7.75 }, { total: 4366, rev: 560, contrib: 438 }],
  [2, "CAT_2", "GOOD", "ZP", "NONE", "D8_13", 4500, { comm: 5.75, fee: 9.75 }, { total: 5018, rev: 698 }],
  [3, "CAT_4", "WEAK", "QUOTE", "CUSTOM", "D4_7", 3500, { comm: 6.5, status: "UNAVAILABLE", reason: "QUOTE_BELOW_CORE" }, { total: 4440, rev: 1024 }],
  [4, "CAT_3", "GOOD", "ADV", "NONE", "D14_20", 8000, { comm: 5.5, fee: 7.25 }, { total: 8684, rev: 1020, contrib: 790 }],
  [5, "CAT_2", "VERY_GOOD", "ZP", "NONE", "D4_7", 9000, { comm: 4.5, fee: 9.75 }, { total: 10035, rev: 1282 }],
  [6, "CAT_4", "FAIR", "QUOTE", "CUSTOM", "D8_13", 7000, { comm: 5.75, status: "UNAVAILABLE", reason: "QUOTE_BELOW_CORE" }, { total: 8040, rev: 1284 }],
  [7, "CAT_3", "GOOD", "ADV", "NONE", "D8_13", 12000, { comm: 5.0, fee: 7.0 }, { total: 12991, rev: 1440, contrib: 1102 }],
  [8, "CAT_2", "VERY_GOOD", "ADV", "LIMITED", "D14_20", 14000, { comm: 5.0, fee: 7.5 }, { total: 15239, rev: 1750, contrib: 956 }],
  [9, "CAT_4", "LOW", "ZP", "NONE", "D1_3", 11000, { comm: 5.0, fee: 9.75 }, { total: 12266, rev: 1622 }],
  [10, "CAT_2", "VERY_GOOD", "ADV", "NONE", "D14_20", 18000, { comm: 4.75, fee: 6.5 }, { total: 19381, rev: 2025, contrib: 1527 }],
  [11, "CAT_3", "GOOD", "ZP", "NONE", "D4_7", 17000, { comm: 4.25, fee: 8.5 }, { total: 18705, rev: 2168 }],
  [12, "CAT_4", "FAIR", "QUOTE", "CUSTOM", "D8_13", 16000, { comm: 5.25, fee: 9.25 }, { total: 17746, rev: 2320, contrib: 1213 }],
  [13, "CAT_2", "GOOD", "ADV", "NONE", "D21_PLUS", 23000, { comm: 5.25, fee: 5.75 }, { total: 24561, rev: 2530, contrib: 1903 }],
  [14, "CAT_3", "VERY_GOOD", "ZP", "NONE", "D1_3", 24000, { comm: 3.0, fee: 8.75 }, { total: 26478, rev: 2820 }],
  [15, "CAT_2", "EXCELLENT", "ADV", "LIMITED", "D14_20", 28000, { comm: 3.75, fee: 6.0 }, { total: 29982, rev: 2730, contrib: 1560 }],
  [16, "CAT_4", "FAIR", "ZP", "NONE", "SAME_DAY", 26000, { comm: 3.5, fee: 8.75 }, { total: 28684, rev: 3185 }],
  [17, "CAT_2", "VERY_GOOD", "ADV", "NONE", "D8_13", 40000, { comm: 3.75, fee: 4.75 }, { total: 42242, rev: 3400, contrib: 2324 }],
  [18, "CAT_3", "GOOD", "QUOTE", "CUSTOM", "D4_7", 45000, { comm: 3.5, fee: 7.75 }, { total: 49115, rev: 5063, contrib: 3165 }],
  [19, "CAT_2", "EXCELLENT", "ADV", "NONE", "D21_PLUS", 60000, { comm: 3.5, fee: 4.0, commercial: 3.25 }, { total: 62832, rev: 4500, contrib: 2909 }],
  [20, "CAT_4", "WEAK", "ZP", "NONE", "SAME_DAY", 80000, { comm: 4.0, fee: 5.0, commercial: 6.75, status: "REVIEW_REQUIRED", reason: "WEAK_PCI" }, { total: 86372, rev: 8600 }],
];

console.log("  #  mode    comm%  fee% (commercial)   unrounded (ticket)   price   revenue (ticket)  contrib (ticket)  status");
for (const [n, category, pciBand, mode, neg, lead, b2b, exp, ticket] of FEE_CASES) {
  const r = priceLine({
    vendor: { gstRegistered: false, monetizationModel: "COMMISSION" },
    baseline: { vendorB2B: b2b, category, pciBand },
    runtime: { bookingMode: MODE[mode], negotiationMode: neg, daysToEvent: DAYS[lead] },
  });
  let ok = eq(`#${n} commission rate`, r.commission.rate, exp.comm);
  if (exp.status) ok &= eq(`#${n} status`, r.status, exp.status);
  else ok &= eq(`#${n} status`, r.status, "APPROVED");
  if (exp.reason) ok &= eq(`#${n} reason`, r.reasonCodes.includes(exp.reason), true);
  if (exp.fee != null) ok &= eq(`#${n} fee rate`, r.serviceFee.rate, exp.fee);
  if (exp.commercial != null) ok &= eq(`#${n} commercial rate`, r.serviceFee.commercialRate, exp.commercial);
  // Ticket totals are pre-merchandising with the commercial fee; compare where the fee matches the ticket.
  if (exp.fee != null && exp.commercial == null) ok &= eq(`#${n} unrounded total vs ticket`, r.customer.unroundedTotal, ticket.total, 1);

  console.log(
    `  ${ok ? "✓" : "✗"} ${String(n).padStart(2)} ${mode.padEnd(5)} ${String(r.commission.rate).padStart(5)} ${String(r.serviceFee.rate).padStart(6)} (${String(r.serviceFee.commercialRate).padStart(5)})` +
      `   ${String(r.customer.unroundedTotal).padStart(9)} (${String(ticket.total).padStart(6)})` +
      `  ${String(r.customer.displayPrice).padStart(6)}  ${String(r.platformRevenue).padStart(8)} (${String(ticket.rev).padStart(5)})` +
      `  ${String(r.contributionBeforeCac).padStart(8)} (${String(ticket.contrib ?? "—").padStart(5)})  ${r.status} ${r.reasonCodes.join(",")}`,
  );
}

// ── 5. Guardrail edge cases ──────────────────────────────────────────────
console.log("\n# Guardrail edge cases");
const trial = priceLine({
  vendor: { gstRegistered: false, monetizationModel: "TRIAL", successfulBookingsCount: 2 },
  baseline: pub.baseline,
  runtime: { bookingMode: MODE.ADV, negotiationMode: "NONE", daysToEvent: 18 },
});
eq("trial: actual commission 0", trial.commission.actual, 0);
eq("trial: shadow commission kept", trial.commission.shadow, 850);

const missingTeam = preEventoryScore({ bookingsLast12Months: 62, yearsOfOperation: 5, teamSize: null }, R);
eq("missing team size renormalised (60*.6+40*.2)/.8", missingTeam.score, 55);
eq("missing bookings → provisional", preEventoryScore({ yearsOfOperation: 5 }, R).provisional, true);

const zpNoLogin = priceLine({
  vendor: {},
  baseline: pub.baseline,
  runtime: { bookingMode: MODE.ZP, daysToEvent: 10, customer: { loggedIn: false } },
});
eq("zero pay needs login", zpNoLogin.reasonCodes.includes("ZERO_PAY_LOGIN_REQUIRED"), true);

const overpriced = priceLine({
  vendor: { monetizationModel: "COMMISSION" },
  baseline: { ...pub.baseline, marketMedian: 17000 },
  runtime: { bookingMode: MODE.ADV, daysToEvent: 18 },
});
eq("CPCI > +5% → review on fixed mode", overpriced.reasonCodes.includes("CPCI_ABOVE_LIMIT"), true);

const weakPub = evaluatePublication({
  vendor: rahulVendor,
  pkg: { eventoryApprovedCriticality: "CRITICAL", vendorB2BPrice: 18000, b2cPriceVerified: true, verifiedVendorB2CPrice: 17000, marketPriceMedian: 21500 },
});
eq("weak PCI at publication → QUOTE_ONLY (CORE+)", weakPub.outcome, "QUOTE_ONLY");
const weakMicro = evaluatePublication({
  vendor: rahulVendor,
  pkg: { eventoryApprovedCriticality: "CRITICAL", vendorB2BPrice: 4000, b2cPriceVerified: true, verifiedVendorB2CPrice: 3800, marketPriceMedian: 5000 },
});
eq("weak PCI on MICRO → PRICE_REVIEW_REQUIRED", weakMicro.outcome, "PRICE_REVIEW_REQUIRED");

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log(failures.join("\n"));
process.exit(fail ? 1 : 0);
