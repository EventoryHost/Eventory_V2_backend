import { z } from "zod";
import { SUPPORTED_TYPES } from "../utils/modelRegistry.js";

/**
 * Zod schemas for the public (no-auth) customer discovery endpoints —
 * browsing/searching Packages and Vendors. Same pattern as
 * customerValidators.js, split into its own file since this is a distinct
 * feature area (read-only catalog browsing vs. auth/profile).
 *
 * All query params are optional — an empty query just means "no filter" —
 * and z.coerce is used throughout since query-string values always arrive
 * as strings.
 */

// Matches EVENT_CATEGORIES / VENDOR_TYPES freeform strings on the frontend —
// no shared taxonomy enum exists in this repo yet, so these stay plain
// trimmed strings rather than a hardcoded enum that could drift out of sync.
const paginationFields = {
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

export const browsePackagesQuerySchema = z.object({
  // Free-text search — matched against package name, event categories, and
  // vendor business name (browsePackages, customerDiscoveryController.js).
  q: z.string().trim().min(1).max(200).optional(),
  eventCategory: z.string().trim().min(1).max(100).optional(),
  vendorType: z.enum(SUPPORTED_TYPES).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  guests: z.coerce.number().int().min(1).optional(), // must fit within capacity.minGuests/maxGuests
  date: z.coerce.date().optional(), // must not be Blocked/Booked on availabilityCalendar
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "rating"]).default("newest"),
  ...paginationFields,
});

export const browseVendorsQuerySchema = z.object({
  vendorType: z.string().trim().min(1).max(60).optional(),
  eventCategory: z.string().trim().min(1).max(100).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(["rating", "newest"]).default("rating"),
  ...paginationFields,
});

// PDP (package detail) — date/guests/time are all optional; when given, the
// controller uses them to compute a live availability + price preview on
// top of the static package payload.
export const packageDetailQuerySchema = z.object({
  date: z.coerce.date().optional(),
  guests: z.coerce.number().int().min(1).optional(),
  // "HH:MM" 24h, matched against the package's declared timeSlots — not
  // validated further than shape since it's just compared as a string.
  time: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be in HH:MM 24-hour format")
    .optional(),
});

// Standalone review-listing endpoints (vendor-level and package-level) —
// Step 9.
export const reviewsQuerySchema = z.object({
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  sort: z.enum(["recent", "highest", "lowest"]).default("recent"),
  ...paginationFields,
});

// Landing page's featured-reviews carousel (getFeaturedReviews) — a small,
// fixed-size, sort-locked feed, not a paginated listing, so this
// deliberately doesn't spread ...paginationFields (no page param — just how
// many to return).
export const featuredReviewsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(8),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
});
