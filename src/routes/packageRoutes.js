import express from "express";
const router = express.Router();
import {
  initializePackage,
  getPackageById,
  updatePackageStep,
  getVendorPackages,
  submitPackage,
  deletePackage,
  duplicatePackage,
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
 *       400:
 *         description: Missing required fields
 *       500:
 *         description: Server error
 */
router.post("/initialize", initializePackage);

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
 *       Automatically adds the stepNumber to completedSteps.
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
 * /api/packages/{packageId}/submit:
 *   post:
 *     summary: Submit package for review
 *     description: |
 *       Validates the package using vendor-specific rules and moves it to "Under Review" status.
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
 *       Returns validation errors if any checks fail.
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
 *                 packageStatus:
 *                   type: string
 *                   example: Under Review
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
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["Package name is required", "At least one menu is required"]
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

/**
 * @swagger
 * /api/packages/{packageId}/duplicate:
 *   post:
 *     summary: Duplicate an existing package
 *     description: |
 *       Creates a deep copy of the package as a new Draft.
 *       Appends " (Copy)" to the package name.
 *       Resets completedSteps to [].
 *     tags: [Packages]
 *     parameters:
 *       - in: path
 *         name: packageId
 *         required: true
 *         schema:
 *           type: string
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
 *                   description: The new duplicated package's ID
 *       404:
 *         description: Original package not found
 *       500:
 *         description: Server error
 */
router.post("/:packageId/duplicate", duplicatePackage);

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
