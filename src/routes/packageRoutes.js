import express from "express";
const router = express.Router();
import {
  initializePackage,
  getPackageById,
  updatePackage,
  updatePackageStep,
  getVendorPackages,
  getPackageGroup,
  updatePackageGroup,
  submitPackage,
  submitPackageGroup,
  goLivePackageGroup,
  deletePackage,
  duplicatePackage,
  duplicateVariant,
  hardDeletePackage,
  hardDeleteVariant,
  addNestedItem,
  updateNestedItem,
  removeNestedItem,
} from "../controllers/packageController.js";

/**
 * @swagger
 * tags:
 *   name: Packages
 *   description: |
 *     Package creation & management for all vendor types.
 *     Uses a multi-step wizard flow (Steps 1–4) with vendor-specific schemas.
 *     Supported vendorTypes: Caterer, Decorator, PAV, DJArtist, MakeupArtist, VenueProvider.
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     PackageBase:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: Mongoose ObjectId
 *         vendorId:
 *           type: string
 *           description: ObjectId reference to the Vendor
 *         vendorType:
 *           type: string
 *           enum: [Caterer, Decorator, PAV, DJArtist, MakeupArtist, VenueProvider]
 *         bookingType:
 *           type: string
 *           enum: [Ready-to-Book, Enquiry/Quote]
 *         packageStatus:
 *           type: string
 *           enum: [Draft, Under Review, Live, Deleted]
 *           default: Draft
 *         variantType:
 *           type: string
 *           enum: [Premium, Standard, Custom]
 *           default: Standard
 *         completedSteps:
 *           type: array
 *           items:
 *             type: number
 *           description: "Array of completed step numbers, e.g. [1, 2]"
 *         step1_eventAndCrew:
 *           type: object
 *           description: "Shared fields: packageName, eventCategories, poc, duration, crewSize, capacity, venueNeeds, tastingSession. Vendor-specific fields merged in."
 *         step2_productsAndPricing:
 *           type: object
 *           description: "Vendor-specific. Caterer: menus/addOns. Decorator: setups/addOns. PAV: packageItems/addOns. DJArtist: items/playlists/equipments/addOns. MakeupArtist: items/addOns. VenueProvider: spaces/inHouseServices/addOns."
 *         step3_policiesAndCharges:
 *           type: object
 *           description: "Shared: teamAndEquipment, guestTiers, dynamicPricing, policiesDocUrl. Vendor-specific: overtimeCharges (DJ/Makeup), dateRangeDynamicPricing (PAV), overallPriceOfPackage (Venue)."
 *         step4_sampleMedia:
 *           type: object
 *           description: "Shared: media[]. VenueProvider: spaceMedia[] (per-space). DJArtist: socialMediaLinks."
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     NestedItemRequest:
 *       type: object
 *       required: [arrayName, item]
 *       properties:
 *         arrayName:
 *           type: string
 *           description: |
 *             The sub-array path within step2_productsAndPricing.
 *             Examples by vendor:
 *             - Caterer: "menus", "addOns"
 *             - Decorator: "setups", "addOns"
 *             - PAV: "packageItems", "addOns"
 *             - DJArtist: "items", "playlists", "equipments", "addOns"
 *             - MakeupArtist: "items", "addOns"
 *             - VenueProvider: "spaces", "addOns", "inHouseServices.caterer", "inHouseServices.decorator", "inHouseServices.pav", "inHouseServices.djArtist", "inHouseServices.makeupArtist"
 *         item:
 *           type: object
 *           description: The item object matching the schema of the target array.
 *
 *     NestedItemUpdateRequest:
 *       type: object
 *       required: [arrayName, itemId, updates]
 *       properties:
 *         arrayName:
 *           type: string
 *           description: Same as NestedItemRequest.arrayName
 *         itemId:
 *           type: string
 *           description: The _id of the subdocument to update.
 *         updates:
 *           type: object
 *           description: Partial object with only the fields to update.
 *
 *     NestedItemRemoveRequest:
 *       type: object
 *       required: [arrayName, itemId]
 *       properties:
 *         arrayName:
 *           type: string
 *           description: Same as NestedItemRequest.arrayName
 *         itemId:
 *           type: string
 *           description: The _id of the subdocument to remove.
 */

// ============================================================
//  CORE LIFECYCLE
// ============================================================

/**
 * @swagger
 * /api/packages/initialize:
 *   post:
 *     summary: Initialize a new package draft
 *     description: |
 *       Creates a new empty package in Draft status for the given vendor.
 *       The correct discriminator model is chosen based on vendorType.
 *       Returns the new packageId — use this ID for all subsequent step updates.
 *
 *       Also returns packageGroupId. Omit it on the FIRST variant of a package
 *       (one is minted for you), then send that same value back when creating
 *       the remaining variants so they join the same group.
 *     tags: [Packages]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vendorId, vendorType, bookingType]
 *             properties:
 *               vendorId:
 *                 type: string
 *                 description: ObjectId of the vendor
 *                 example: "664a1b2c3d4e5f6a7b8c9d0e"
 *               vendorType:
 *                 type: string
 *                 enum: [Caterer, Decorator, PAV, DJArtist, MakeupArtist, VenueProvider]
 *                 example: "Caterer"
 *               bookingType:
 *                 type: string
 *                 enum: [Ready-to-Book, Enquiry/Quote]
 *                 example: "Ready-to-Book"
 *               variantType:
 *                 type: string
 *                 description: Free-form variant name, defaults to "Premium"
 *                 example: "Premium"
 *               packageGroupId:
 *                 type: string
 *                 description: |
 *                   Group this variant joins. Omit on the first variant of a
 *                   package; pass the returned value for subsequent variants.
 *                 example: "664a1b2c3d4e5f6a7b8c9d0e"
 *               availabilityCalendar:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     date:
 *                       type: string
 *                       format: date
 *                     status:
 *                       type: string
 *                       enum: [Available, Blocked, Booked]
 *     responses:
 *       201:
 *         description: Package initialized
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 message:
 *                   type: string
 *                 packageId:
 *                   type: string
 *                   description: The ID to use for all subsequent operations
 *                 packageGroupId:
 *                   type: string
 *                   description: Send this back when creating sibling variants
 *       400:
 *         description: Missing required fields or invalid packageGroupId
 *       500:
 *         description: Server error
 */
router.post("/initialize", initializePackage);

/**
 * @swagger
 * /api/packages/group/{packageGroupId}:
 *   get:
 *     summary: Get every variant of one logical package
 *     description: |
 *       Returns all variant documents sharing the given packageGroupId, oldest
 *       first. Replaces fetching every package for a vendor and filtering by
 *       package name on the client.
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageGroupId
 *         required: true
 *         schema:
 *           type: string
 *         description: The package group ObjectId shared by all variants
 *     responses:
 *       200:
 *         description: Variants of the package
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 count:
 *                   type: number
 *                 packageGroupId:
 *                   type: string
 *                 packages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PackageBase'
 *       400:
 *         description: Invalid packageGroupId
 *       404:
 *         description: Package group not found
 *       500:
 *         description: Server error
 */
router.get("/group/:packageGroupId", getPackageGroup);

/**
 * @swagger
 * /api/packages/group/{packageGroupId}:
 *   put:
 *     summary: Rename a logical package across all of its variants
 *     description: |
 *       Sets step1_eventAndCrew.packageName on every variant in the group in a
 *       single write, so a rename cannot partially apply and split the group.
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageGroupId
 *         required: true
 *         schema:
 *           type: string
 *         description: The package group ObjectId shared by all variants
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [packageName]
 *             properties:
 *               packageName:
 *                 type: string
 *                 example: Wedding Deluxe
 *     responses:
 *       200:
 *         description: Group renamed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 matched:
 *                   type: number
 *                 modified:
 *                   type: number
 *       400:
 *         description: Invalid packageGroupId or missing packageName
 *       404:
 *         description: Package group not found
 *       500:
 *         description: Server error
 */
router.put("/group/:packageGroupId", updatePackageGroup);

/**
 * @swagger
 * /api/packages/{packageId}:
 *   get:
 *     summary: Get a single package by ID
 *     description: Returns the full package document including all steps and vendor-specific data.
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema:
 *           type: string
 *         description: The package ObjectId
 *     responses:
 *       200:
 *         description: Package found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 package:
 *                   $ref: '#/components/schemas/PackageBase'
 *       404:
 *         description: Package not found
 *       500:
 *         description: Server error
 */
router.get("/:packageId", getPackageById);

/**
 * @swagger
 * /api/packages/{packageId}:
 *   put:
 *     summary: Update top-level package fields (e.g. rename variant)
 *     description: |
 *       Sets whitelisted top-level fields on the package. Currently supports
 *       `variantType` (used to rename a variant).
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               variantType:
 *                 type: string
 *                 example: "Deluxe"
 *     responses:
 *       200:
 *         description: Package updated
 *       400:
 *         description: No updatable fields provided
 *       404:
 *         description: Package not found
 *       500:
 *         description: Server error
 */
router.put("/:packageId", updatePackage);

/**
 * @swagger
 * /api/packages/vendor/{vendorId}:
 *   get:
 *     summary: Get all packages for a vendor
 *     description: |
 *       Returns all packages belonging to the given vendor.
 *       Optionally filter by status using the query parameter.
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *         description: The vendor ObjectId
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *           enum: [Draft, Under Review, Live, Deleted]
 *         description: "Filter by package status. Example: ?status=Draft"
 *       - in: query
 *         name: packageGroupId
 *         required: false
 *         schema:
 *           type: string
 *         description: "Return only variants of one logical package"
 *     responses:
 *       200:
 *         description: List of packages
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 count:
 *                   type: number
 *                 packages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PackageBase'
 *       500:
 *         description: Server error
 */
router.get("/vendor/:vendorId", getVendorPackages);

/**
 * @swagger
 * /api/packages/{packageId}/step/{stepNumber}:
 *   put:
 *     summary: Update a specific step (deep merge)
 *     description: |
 *       Updates fields within a specific step using deep merge (dot-notation $set).
 *       Only the fields you send are updated — missing fields are NOT wiped.
 *       Automatically adds the stepNumber to completedSteps, unless
 *       `markCompleted=false` is passed (Save & Exit: stash partial data only).
 *
 *       **Important**: Send ONLY the fields you want to update, not the full step object.
 *
 *       ## Step 1 — Event & Crew
 *       Shared fields (all vendors):
 *       ```json
 *       {
 *         "packageName": "Wedding Premium",
 *         "eventCategories": ["Wedding", "Reception"],
 *         "poc": "John Doe",
 *         "duration": { "minHours": 4, "maxHours": 8 },
 *         "crewSize": { "minPeople": 5, "maxPeople": 10, "roles": ["Chef", "Helper"] },
 *         "capacity": { "minGuests": 100, "maxGuests": 500 },
 *         "venueNeeds": { "power": true, "ac": true },
 *         "tastingSession": true
 *       }
 *       ```
 *       PAV adds: `crewBreakdown: { photographers, videographers, otherAssistants, editors }`
 *       DJArtist adds: `audienceCapacity, performers, supportingCrew, visitingIncluded`
 *       MakeupArtist adds: `durationPerPerson, durationOfSetup, trialOffered, parallelServicingPossible`
 *       VenueProvider adds: `venueAddress`
 *
 *       ## Step 2 — Products & Pricing
 *       Varies entirely by vendorType. See the schemas documentation.
 *       Prefer using the `/nested/*` endpoints for individual item management.
 *
 *       ## Step 3 — Policies & Charges
 *       Shared fields: `teamAndEquipment, lastMinuteChargesDocUrl, guestTiers, dynamicPricing, policiesDocUrl`
 *       PAV adds: `dateRangeDynamicPricing`
 *       DJArtist/MakeupArtist adds: `overtimeCharges`
 *       VenueProvider adds: `overallPriceOfPackage`
 *
 *       ## Step 4 — Sample Media
 *       Shared: `media: [{ url, type, fileName, size }]`
 *       DJArtist adds: `socialMediaLinks: { youtube, instagram, spotify, ... }`
 *       VenueProvider: `spaceMedia: [{ spaceName, spaceIndex, media: [...] }]`
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: stepNumber
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 4
 *         description: "Step to update: 1, 2, 3, or 4"
 *       - in: query
 *         name: markCompleted
 *         required: false
 *         schema:
 *           type: boolean
 *           default: true
 *         description: >
 *           Set to false to save the step data without recording the step as
 *           completed (Save & Exit).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: |
 *               Partial object with only the fields to update within the step.
 *               Fields NOT sent will NOT be modified (deep merge behavior).
 *           examples:
 *             step1_basic:
 *               summary: "Step 1 — Update package name only"
 *               value:
 *                 packageName: "Royal Wedding Deluxe"
 *             step1_full:
 *               summary: "Step 1 — Full update"
 *               value:
 *                 packageName: "Royal Wedding"
 *                 eventCategories: ["Wedding"]
 *                 capacity:
 *                   minGuests: 100
 *                   maxGuests: 500
 *             step3_dynamic:
 *               summary: "Step 3 — Enable weekend pricing"
 *               value:
 *                 dynamicPricing:
 *                   weekends:
 *                     enabled: true
 *                     percentage: 15
 *             step4_media:
 *               summary: "Step 4 — Add sample media"
 *               value:
 *                 media:
 *                   - url: "https://cdn.example.com/photo1.jpg"
 *                     type: "image"
 *                     fileName: "photo1.jpg"
 *                     size: 204800
 *     responses:
 *       200:
 *         description: Step updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 message:
 *                   type: string
 *                 package:
 *                   $ref: '#/components/schemas/PackageBase'
 *       400:
 *         description: Invalid step number
 *       404:
 *         description: Package not found
 *       500:
 *         description: Server error
 */
router.put("/:packageId/step/:stepNumber", updatePackageStep);

/**
 * @swagger
 * /api/packages/group/{packageGroupId}/submit:
 *   post:
 *     summary: Submit a package for EM review
 *     description: |
 *       Submits every variant of the package for review, moving them to
 *       "Under Review". A review decision applies to the logical package, so
 *       submitting does too — submitting a single variant would leave its
 *       siblings unreviewed and let the EM approve half a package.
 *
 *       Only variants currently in "Draft" or "Action Required" are moved; a
 *       sibling that is already Live stays Live.
 *
 *       **Validation rules by vendor:**
 *       - All: packageName required, ≥1 eventCategory
 *       - Caterer: ≥1 menu
 *       - Decorator: ≥1 setup
 *       - PAV: ≥1 package item
 *       - DJArtist: ≥1 DJ item
 *       - MakeupArtist: ≥1 service item
 *       - VenueProvider: ≥1 space
 *
 *       Every variant being submitted must pass; failures are returned per variant.
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageGroupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Package submitted for review
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 packageStatus:
 *                   type: string
 *                   example: Under Review
 *                 count:
 *                   type: integer
 *                   description: Variants moved
 *       400:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: FAILED
 *                 message:
 *                   type: string
 *                   example: Validation failed
 *                 variants:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       packageId:
 *                         type: string
 *                       variantType:
 *                         type: string
 *                       errors:
 *                         type: array
 *                         items:
 *                           type: string
 *       409:
 *         description: No variant is in a submittable status
 *       500:
 *         description: Server error
 */
router.post("/group/:packageGroupId/submit", submitPackageGroup);

/**
 * @swagger
 * /api/packages/group/{packageGroupId}/go-live:
 *   post:
 *     summary: Publish an approved package
 *     description: |
 *       Moves an "Approved" package to "Live". EM approval only clears a
 *       package for sale — this is the vendor pressing Go Live, so the moment
 *       a listing appears on the marketplace stays the vendor's decision.
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageGroupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Package is now live
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 packageStatus:
 *                   type: string
 *                   example: Live
 *                 count:
 *                   type: integer
 *       409:
 *         description: Package has not been approved
 *       500:
 *         description: Server error
 */
router.post("/group/:packageGroupId/go-live", goLivePackageGroup);

/**
 * @swagger
 * /api/packages/{packageId}/submit:
 *   post:
 *     deprecated: true
 *     summary: Submit by variant id (resolves to the whole package)
 *     description: |
 *       Kept for the shipped app, which has no group-level submit call. It
 *       resolves the id to its group and submits every variant, so it behaves
 *       identically to /group/{packageGroupId}/submit.
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Package submitted for review
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Package not found
 *       500:
 *         description: Server error
 */
router.post("/:packageId/submit", submitPackage);

/**
 * @swagger
 * /api/packages/{packageId}:
 *   delete:
 *     summary: Soft-delete a package
 *     description: Sets packageStatus to "Deleted". The document is NOT removed from the database.
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Package marked as deleted
 *       404:
 *         description: Package not found
 *       500:
 *         description: Server error
 */
router.delete("/:packageId", deletePackage);

// Permanently remove ONE variant document. 
router.delete("/:packageId/permanent", hardDeleteVariant);

// Permanently remove a whole package — every variant in the group.
router.delete("/group/:packageGroupId/permanent", hardDeletePackage);

/**
 * @swagger
 * /api/packages/{packageId}/duplicate:
 *   post:
 *     summary: Duplicate a whole package, including every variant
 *     description: |
 *       Deep-copies the ENTIRE logical package the given id belongs to — every
 *       variant sharing its packageGroupId — into a single new group, so the
 *       copy keeps the same variant line-up (e.g. Premium/Standard/Basic).
 *
 *       Pass any variant's id; the group is resolved server-side. Do NOT call
 *       this once per variant — that produces one standalone package per
 *       variant instead of one package with all of them.
 *
 *       Every copy comes back as a Draft with " (Copy)" appended to the package
 *       name. `completedSteps` is preserved, since the copy carries all of the
 *       source's step data.
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema:
 *           type: string
 *         description: Any variant of the package to duplicate
 *     responses:
 *       201:
 *         description: Package duplicated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 message:
 *                   type: string
 *                 packageId:
 *                   type: string
 *                   description: The first copied variant, representing the new package
 *                 packageGroupId:
 *                   type: string
 *                   description: The new group shared by every copy
 *                 count:
 *                   type: number
 *                   description: How many variants were copied
 *                 packageIds:
 *                   type: array
 *                   items:
 *                     type: string
 *       404:
 *         description: Original package not found
 *       500:
 *         description: Server error
 */
router.post("/:packageId/duplicate", duplicatePackage);

/**
 * @swagger
 * /api/packages/{packageId}/duplicate-variant:
 *   post:
 *     summary: Duplicate one variant within its package
 *     description: |
 *       Deep-copies a single variant document and keeps it in the SAME package:
 *       the copy inherits the source's packageGroupId and package name, and
 *       takes the new variant name from the body.
 *
 *       Use this for "duplicate this variant" inside the package editor. Use
 *       `/duplicate` to copy the package as a whole.
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema:
 *           type: string
 *         description: The variant to copy
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [variantType]
 *             properties:
 *               variantType:
 *                 type: string
 *                 description: Name for the new variant; must be free within the package
 *                 example: "Premium Copy"
 *     responses:
 *       201:
 *         description: Variant duplicated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 packageId:
 *                   type: string
 *                   description: The new variant's ID
 *                 packageGroupId:
 *                   type: string
 *                 variantType:
 *                   type: string
 *       400:
 *         description: Missing or empty variantType
 *       404:
 *         description: Source variant not found
 *       409:
 *         description: A variant with that name already exists in the package
 *       500:
 *         description: Server error
 */
router.post("/:packageId/duplicate-variant", duplicateVariant);

// ============================================================
//  NESTED RESOURCE MANAGEMENT (Step 2 sub-items)
// ============================================================

/**
 * @swagger
 * /api/packages/{packageId}/nested/add:
 *   post:
 *     summary: Add a nested item to Step 2
 *     description: |
 *       Pushes a new item into a sub-array within `step2_productsAndPricing`.
 *       Use `arrayName` to target the correct array for the vendor type.
 *
 *       **arrayName reference by vendor:**
 *
 *       | Vendor | Valid arrayName values |
 *       |---|---|
 *       | Caterer | `menus`, `addOns` |
 *       | Decorator | `setups`, `addOns` |
 *       | PAV | `packageItems`, `addOns` |
 *       | DJArtist | `items`, `playlists`, `equipments`, `addOns` |
 *       | MakeupArtist | `items`, `addOns` |
 *       | VenueProvider | `spaces`, `addOns`, `inHouseServices.caterer`, `inHouseServices.decorator`, `inHouseServices.pav`, `inHouseServices.djArtist`, `inHouseServices.makeupArtist` |
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NestedItemRequest'
 *           examples:
 *             caterer_menu:
 *               summary: "Add a Caterer menu"
 *               value:
 *                 arrayName: "menus"
 *                 item:
 *                   name: "Wedding Dinner"
 *                   type: "Dinner"
 *                   serviceStyle: "Buffet"
 *                   priceModel: "Per Plate"
 *                   billingUnit: "Per Person"
 *                   items:
 *                     starters:
 *                       - name: "Paneer Tikka"
 *                         price: 250
 *                     mainCourse:
 *                       - name: "Dal Makhani"
 *                         price: 200
 *                     dessert:
 *                       - name: "Gulab Jamun"
 *                         price: 100
 *                     drinks:
 *                       - name: "Masala Chai"
 *                         price: 50
 *             decorator_setup:
 *               summary: "Add a Decorator setup"
 *               value:
 *                 arrayName: "setups"
 *                 item:
 *                   name: "Floral Arch"
 *                   setupPhoto: "https://cdn.example.com/arch.jpg"
 *                   referenceStyle: "Indoor"
 *                   description: "Premium flower arrangement"
 *                   price: 12000
 *                   decoratingWhat: "Entrance"
 *                   items:
 *                     - name: "Steel Frame (Adjustable)"
 *                       qty: 1
 *                       unit: "Units"
 *                       price: 120
 *             dj_playlist:
 *               summary: "Add a DJ playlist"
 *               value:
 *                 arrayName: "playlists"
 *                 item:
 *                   name: "Bollywood Hits"
 *                   type: "Curated"
 *                   playlistType: "Type 1"
 *                   customerPlaylistAllowed: true
 *                   guestRequestsAllowed: false
 *                   songs:
 *                     - name: "Tum Hi Ho"
 *                       artist: "Arijit Singh"
 *                       duration: "4:22"
 *             venue_space:
 *               summary: "Add a Venue space"
 *               value:
 *                 arrayName: "spaces"
 *                 item:
 *                   name: "Grand Ballroom"
 *                   spaceType: "Banquet Hall"
 *                   area: { value: 5000, unit: "sq.ft" }
 *                   height: { value: 20, unit: "ft" }
 *                   layout: "Theatre"
 *                   capacity: { standing: 500, sitting: 300, dining: 200 }
 *                   environment: "Indoor"
 *                   activities: ["Wedding", "Reception", "Conference"]
 *                   amenities: { power: true, ac: true, stage: true, lighting: true, security: true }
 *                   price: 150000
 *                   billingUnit: "Per Day"
 *             venue_inhouse_caterer:
 *               summary: "Add an in-house Caterer service to a Venue"
 *               value:
 *                 arrayName: "inHouseServices.caterer"
 *                 item:
 *                   serviceType: "Premium Buffet"
 *                   data:
 *                     crockery: { included: true, type: "Bone China" }
 *                     menus:
 *                       - name: "Wedding Dinner"
 *                         type: "Dinner"
 *                         serviceStyle: "Buffet"
 *                         items:
 *                           starters: [{ name: "Paneer Tikka", price: 250 }]
 *                   sampleMedia:
 *                     - url: "https://cdn.example.com/venue_food.jpg"
 *                       type: "image"
 *                       fileName: "venue_food.jpg"
 *                       size: 204800
 *             makeup_item:
 *               summary: "Add a Makeup Artist service item"
 *               value:
 *                 arrayName: "items"
 *                 item:
 *                   name: "Bridal Makeup"
 *                   itemType: "Makeup"
 *                   options:
 *                     - name: "HD Makeup"
 *                       price: 0
 *                     - name: "Air Brush"
 *                       price: 800
 *                   brands:
 *                     - name: "MAC"
 *                       price: 0
 *                     - name: "HUDA"
 *                       price: 800
 *                   allowCustomInput: true
 *     responses:
 *       200:
 *         description: Item added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCESS
 *                 package:
 *                   $ref: '#/components/schemas/PackageBase'
 *       500:
 *         description: Server error
 */
router.post("/:packageId/nested/add", addNestedItem);

/**
 * @swagger
 * /api/packages/{packageId}/nested/update:
 *   put:
 *     summary: Update a nested item in Step 2
 *     description: |
 *       Updates a specific subdocument within a sub-array of `step2_productsAndPricing`.
 *       Only the fields provided in `updates` are modified.
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NestedItemUpdateRequest'
 *           examples:
 *             update_menu_price:
 *               summary: "Update a Caterer menu"
 *               value:
 *                 arrayName: "menus"
 *                 itemId: "664a1b2c3d4e5f6a7b8c9d0e"
 *                 updates:
 *                   name: "Updated Wedding Dinner"
 *                   serviceStyle: "Table"
 *             update_space_capacity:
 *               summary: "Update a Venue space capacity"
 *               value:
 *                 arrayName: "spaces"
 *                 itemId: "664a1b2c3d4e5f6a7b8c9d0f"
 *                 updates:
 *                   capacity:
 *                     standing: 600
 *                     sitting: 400
 *                     dining: 250
 *     responses:
 *       200:
 *         description: Item updated successfully
 *       404:
 *         description: Package or item not found
 *       500:
 *         description: Server error
 */
router.put("/:packageId/nested/update", updateNestedItem);

/**
 * @swagger
 * /api/packages/{packageId}/nested/remove:
 *   delete:
 *     summary: Remove a nested item from Step 2
 *     description: |
 *       Removes a specific subdocument by its `_id` from a sub-array within `step2_productsAndPricing`.
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NestedItemRemoveRequest'
 *           examples:
 *             remove_menu:
 *               summary: "Remove a Caterer menu"
 *               value:
 *                 arrayName: "menus"
 *                 itemId: "664a1b2c3d4e5f6a7b8c9d0e"
 *             remove_space:
 *               summary: "Remove a Venue space"
 *               value:
 *                 arrayName: "spaces"
 *                 itemId: "664a1b2c3d4e5f6a7b8c9d0f"
 *             remove_inhouse:
 *               summary: "Remove a Venue in-house caterer service"
 *               value:
 *                 arrayName: "inHouseServices.caterer"
 *                 itemId: "664a1b2c3d4e5f6a7b8c9d10"
 *     responses:
 *       200:
 *         description: Item removed successfully
 *       500:
 *         description: Server error
 */
router.delete("/:packageId/nested/remove", removeNestedItem);

export default router;
