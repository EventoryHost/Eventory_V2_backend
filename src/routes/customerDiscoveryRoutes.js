import express from "express";
import {
  browsePackages,
  browseVendors,
  getPackageFilters,
  getVendorFilters,
  getPackageDetail,
  getPackageGroupVariants,
  getPackageReviews,
  getVendorDetail,
  getVendorReviews,
} from "../controllers/customerDiscoveryController.js";
import { publicBrowseLimiter } from "../middlewares/rateLimiters.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import {
  browsePackagesQuerySchema,
  browseVendorsQuerySchema,
  packageDetailQuerySchema,
  reviewsQuerySchema,
} from "../validators/customerDiscoveryValidators.js";

const router = express.Router();

/**
 * Public, no-auth discovery routes — Phase 1 Step 6 of the customer build
 * plan. Mounted at /api/customer in src/routes/index.js, so this file's own
 * paths (/packages, /vendors) resolve to /api/customer/packages and
 * /api/customer/vendors. Kept as one router since both are currently thin,
 * closely-related read-only GETs; split into separate files if either grows
 * enough sibling endpoints (detail/PDP routes, etc.) to warrant it.
 */

/**
 * @swagger
 * /api/customer/packages:
 *   get:
 *     summary: Browse/search Live packages
 *     description: |
 *       Public, read-only. Returns only packages with packageStatus "Live".
 *       All query params are optional filters.
 *     tags: [Customer Discovery]
 *     parameters:
 *       - in: query
 *         name: eventCategory
 *         schema: { type: string }
 *         example: Wedding
 *       - in: query
 *         name: vendorType
 *         schema: { type: string, enum: [Caterer, Decorator, PAV, DJArtist, MakeupArtist, VenueProvider] }
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *         description: Matched against the owning vendor's city or serviceAreas
 *       - in: query
 *         name: guests
 *         schema: { type: integer }
 *         description: Must fall within the package's capacity.minGuests/maxGuests
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *         description: Excludes packages Blocked/Booked on this date
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [newest, price_asc, price_desc], default: newest }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200: { description: Paginated list of Live packages, vendor populated with a public-safe field whitelist }
 *       400: { description: Invalid query parameters }
 */
router.get("/packages", publicBrowseLimiter, validateRequest(browsePackagesQuerySchema, "query"), browsePackages);

/**
 * @swagger
 * /api/customer/packages/filters:
 *   get:
 *     summary: Filter/sort taxonomy for the package listing page
 *     description: |
 *       Returns the DISTINCT values actually present across Live packages
 *       right now (event categories, vendor types, cities, price range,
 *       guest range) plus the supported sort keys — not a hardcoded master
 *       list, since none exists anywhere in this backend today. Values are
 *       always in sync with what's actually bookable.
 *     tags: [Customer Discovery]
 *     responses:
 *       200: { description: Available filter facets and sort options }
 */
router.get("/packages/filters", publicBrowseLimiter, getPackageFilters);

/**
 * @swagger
 * /api/customer/packages/group/{packageGroupId}:
 *   get:
 *     summary: Sibling variants of one logical package (PDP's variant picker)
 *     description: |
 *       Public, read-only. Live-only replacement for the vendor-management
 *       router's internal GET /api/packages/group/:packageGroupId, which the
 *       PDP frontend was using as a stopgap (no packageStatus filter there —
 *       could leak Draft/Under Review/Deleted variants to a customer, and no
 *       vendor field whitelist). Added 2026-08-17.
 *     tags: [Customer Discovery]
 *     parameters:
 *       - in: path
 *         name: packageGroupId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Every Live variant of this package group, oldest first }
 *       400: { description: Invalid packageGroupId }
 *       404: { description: No Live variants found for this package group }
 */
router.get("/packages/group/:packageGroupId", publicBrowseLimiter, getPackageGroupVariants);

/**
 * @swagger
 * /api/customer/packages/{packageId}:
 *   get:
 *     summary: Package detail (PDP)
 *     description: |
 *       Public, read-only. 404s unless the package is packageStatus "Live".
 *       Returns the full package (event/crew details, add-ons/pricing,
 *       policies, media) plus three computed sections:
 *         - availability: best-effort, cross-checks the vendor's
 *           availabilityCalendar, declared weekly/time-slot working hours,
 *           and a live count of non-cancelled Bookings against
 *           bookingCapacity.dailyCapacity for the requested date.
 *         - pricingPreview: an ESTIMATE only (guest-tier + date-based
 *           dynamic pricing + GST) — never authoritative, always
 *           recomputed server-side at actual checkout.
 *         - reviews: Published reviews for this package if any exist yet,
 *           else falls back to the vendor's overall rating/reviewsCount.
 *       This route must stay registered AFTER /packages/filters — otherwise
 *       Express would match "filters" as this route's :packageId param.
 *     tags: [Customer Discovery]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: guests
 *         schema: { type: integer }
 *       - in: query
 *         name: time
 *         schema: { type: string }
 *         description: "HH:MM 24-hour, checked against the package's declared time slots"
 *     responses:
 *       200: { description: Package detail + availability + pricing preview + reviews }
 *       400: { description: Invalid packageId or query parameters }
 *       404: { description: Package not found or not Live }
 */
router.get(
  "/packages/:packageId",
  publicBrowseLimiter,
  validateRequest(packageDetailQuerySchema, "query"),
  getPackageDetail
);

/**
 * @swagger
 * /api/customer/packages/{packageId}/reviews:
 *   get:
 *     summary: Standalone, paginated review listing for one package
 *     description: |
 *       Public, read-only. The "see all reviews" page for a package — the
 *       PDP (Step 8) only embeds the 10 most recent. Returns real
 *       pagination/sort/filter plus a full rating aggregate: average,
 *       count, 1-5 star distribution, and a per-category breakdown
 *       computed from whatever categoryRatings keys are actually present
 *       on the matched reviews (no fixed category list is hardcoded — see
 *       src/models/Review.js).
 *     tags: [Customer Discovery]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: minRating
 *         schema: { type: integer, minimum: 1, maximum: 5 }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [recent, highest, lowest], default: recent }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200: { description: Paginated reviews + rating aggregate }
 *       400: { description: Invalid packageId or query parameters }
 */
router.get(
  "/packages/:packageId/reviews",
  publicBrowseLimiter,
  validateRequest(reviewsQuerySchema, "query"),
  getPackageReviews
);

/**
 * @swagger
 * /api/customer/vendors:
 *   get:
 *     summary: Browse/search active vendors
 *     description: |
 *       Public, read-only. Excludes deactivated vendors. Response fields are
 *       an explicit whitelist — never exposes phone/email/KYC/banking data.
 *     tags: [Customer Discovery]
 *     parameters:
 *       - in: query
 *         name: vendorType
 *         schema: { type: string }
 *       - in: query
 *         name: eventCategory
 *         schema: { type: string }
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *         description: Matched against city or serviceAreas
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [rating, newest], default: rating }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200: { description: Paginated list of active vendors, public-safe fields only }
 *       400: { description: Invalid query parameters }
 */
router.get("/vendors", publicBrowseLimiter, validateRequest(browseVendorsQuerySchema, "query"), browseVendors);

/**
 * @swagger
 * /api/customer/vendors/filters:
 *   get:
 *     summary: Filter/sort taxonomy for the vendor listing page
 *     description: Same "derived from real data" reasoning as /packages/filters.
 *     tags: [Customer Discovery]
 *     responses:
 *       200: { description: Available filter facets and sort options }
 */
router.get("/vendors/filters", publicBrowseLimiter, getVendorFilters);

/**
 * @swagger
 * /api/customer/vendors/{vendorId}:
 *   get:
 *     summary: Single vendor's public profile
 *     description: |
 *       Public, read-only, excludes deactivated vendors. Server-enforced
 *       public-safe field whitelist (PUBLIC_VENDOR_FIELDS) — never a
 *       client-controlled ?select=, unlike the vendor-management router's
 *       internal GET /vendors/:id. Added 2026-08-21 after auditing the Cart
 *       page: no proper customer-facing single-vendor-detail endpoint
 *       existed, so the frontend was calling that internal route directly,
 *       which returns the FULL vendor document (phone/email/bank details/
 *       KYC documents) whenever ?select= is omitted.
 *     tags: [Customer Discovery]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Vendor's public profile }
 *       400: { description: Invalid vendorId }
 *       404: { description: Vendor not found (or deactivated) }
 */
router.get("/vendors/:vendorId", publicBrowseLimiter, getVendorDetail);

/**
 * @swagger
 * /api/customer/vendors/{vendorId}/reviews:
 *   get:
 *     summary: Standalone, paginated review listing for a vendor (across all their packages)
 *     description: |
 *       Public, read-only. Same shape as /packages/{packageId}/reviews but
 *       scoped to every review a vendor has received, not one package —
 *       the "Review Page" / vendor-profile use case from the Customer
 *       Reviews & Social Proof Page PRD.
 *     tags: [Customer Discovery]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: minRating
 *         schema: { type: integer, minimum: 1, maximum: 5 }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [recent, highest, lowest], default: recent }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200: { description: Paginated reviews + rating aggregate }
 *       400: { description: Invalid vendorId or query parameters }
 */
router.get(
  "/vendors/:vendorId/reviews",
  publicBrowseLimiter,
  validateRequest(reviewsQuerySchema, "query"),
  getVendorReviews
);

export default router;
