import { round2 } from "../../utils/money.js";
import { byMin, byMax } from "./lookup.js";

/**
 * MARKET ENGINE — package band (§6.1), PCI (§7.1), CPCI (§7.3) and the
 * lead-time bucket shared by commission and service fee.
 */

export function packageBand(vendorB2B, rules) {
  return byMin(rules.packageBands, vendorB2B).band;
}

export function bandAtLeast(band, minBand, rules) {
  return rules.bandOrder.indexOf(band) >= rules.bandOrder.indexOf(minBand);
}

/**
 * PCI = (VerifiedVendorB2C - VendorB2B) / VerifiedVendorB2C * 100.
 * Without a VERIFIED same-vendor B2C price the status is NOT_AVAILABLE —
 * never treated as zero / WEAK.
 */
export function pci(vendorB2B, verifiedVendorB2C, rules) {
  if (!verifiedVendorB2C) return { pci: null, band: "NOT_AVAILABLE" };
  const value = ((verifiedVendorB2C - vendorB2B) / verifiedVendorB2C) * 100;
  return { pci: round2(value), band: byMin(rules.pciBands, value).band };
}

/** CPCI = (EventoryCustomerPrice - ComparableMarketMedian) / Median * 100. */
export function cpci(customerPrice, marketMedian, rules) {
  if (!marketMedian) return { cpci: null, band: "NOT_AVAILABLE" };
  const value = ((customerPrice - marketMedian) / marketMedian) * 100;
  return { cpci: round2(value), band: byMax(rules.cpciBands, value).band };
}

export function leadTimeBucket(daysToEvent, rules) {
  if (daysToEvent == null || daysToEvent < 0) return null;
  return byMin(rules.leadTimeBuckets, daysToEvent).bucket;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const istDay = (d) => Math.floor((new Date(d).getTime() + IST_OFFSET_MS) / 86400000);

/** Whole calendar days (IST) from booking to event; same date = 0. */
export function daysToEvent(eventDate, bookingDate = new Date()) {
  return istDay(eventDate) - istDay(bookingDate);
}
