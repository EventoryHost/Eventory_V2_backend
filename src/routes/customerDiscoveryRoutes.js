import express from "express";
import {
  browsePackages,
  browseVendors,
  getPackageFilters,
  getVendorFilters,
} from "../controllers/customerDiscoveryController.js";
import { publicBrowseLimiter } from "../middlewares/rateLimiters.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { browsePackagesQuerySchema, browseVendorsQuerySchema } from "../validators/customerDiscoveryValidators.js";

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

export default router;
