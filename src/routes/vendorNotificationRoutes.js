import express from "express";
import { requireVendor, ownerFromParam } from "../middlewares/vendorAuth.js";
import {
  getVendorNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../controllers/vendorNotificationController.js";

const router = express.Router();

// The caller must be the vendor named in the URL.
const ownsVendor = requireVendor(ownerFromParam("vendorId"));

/**
 * @swagger
 * tags:
 *   name: Vendor Notifications
 *   description: |
 *     The vendor app's inbox. Rows are written server-side when something
 *     happens on a booking, enquiry, payment, package, profile or support
 *     ticket; the app only reads them and marks them read.
 *
 * components:
 *   schemas:
 *     VendorNotification:
 *       type: object
 *       properties:
 *         notificationId: { type: string, example: NTF20261105101500123a1b2c3 }
 *         category:
 *           type: string
 *           enum: [eventDay, booking, enquiry, payments, profile, package, support]
 *         type: { type: string, example: booking.newRequest }
 *         title: { type: string }
 *         body: { type: string }
 *         customerName: { type: string, nullable: true }
 *         eventName: { type: string, nullable: true }
 *         serviceLabel: { type: string, nullable: true }
 *         detail: { type: string, nullable: true }
 *         detailKind: { type: string, enum: [location, schedule] }
 *         showsPackageImage: { type: boolean }
 *         imageUrl: { type: string, nullable: true }
 *         needsAction: { type: boolean }
 *         isUnread: { type: boolean }
 *         target:
 *           type: object
 *           properties:
 *             kind:
 *               type: string
 *               enum: [booking, eventDay, enquiry, payments, package, packages, profile, documents, support, none]
 *             id: { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *     VendorNotificationUnreadCounts:
 *       type: object
 *       properties:
 *         all: { type: integer }
 *         eventDay: { type: integer }
 *         booking: { type: integer }
 *         enquiry: { type: integer }
 *         payments: { type: integer }
 *         profile: { type: integer }
 *         package: { type: integer }
 *         support: { type: integer }
 */

/**
 * @swagger
 * /api/notifications/vendor/{vendorId}:
 *   get:
 *     summary: List a vendor's notifications
 *     description: |
 *       Without a cursor the response also carries `actions` — every open
 *       needs-action row for the filter, newest first. `notifications` pages
 *       through the informational rows; pass `nextCursor` back as `cursor`.
 *       `actions` is null on later pages.
 *     tags: [Vendor Notifications]
 *     parameters:
 *       - { in: path, name: vendorId, required: true, schema: { type: string } }
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [all, eventDay, booking, enquiry, payments, profile, package, support]
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 50 } }
 *     responses:
 *       200:
 *         description: Inbox page
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: SUCCESS }
 *                 actions:
 *                   type: array
 *                   nullable: true
 *                   items: { $ref: '#/components/schemas/VendorNotification' }
 *                 notifications:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/VendorNotification' }
 *                 nextCursor: { type: string, nullable: true }
 *                 unreadCounts: { $ref: '#/components/schemas/VendorNotificationUnreadCounts' }
 *       400: { description: Bad category or cursor }
 */
router.get("/vendor/:vendorId", ownsVendor, getVendorNotifications);

/**
 * @swagger
 * /api/notifications/vendor/{vendorId}/read-all:
 *   patch:
 *     summary: Mark all notifications read
 *     description: Optionally only one category's (query `category`).
 *     tags: [Vendor Notifications]
 *     parameters:
 *       - { in: path, name: vendorId, required: true, schema: { type: string } }
 *       - { in: query, name: category, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: SUCCESS }
 *                 updated: { type: integer }
 *                 unreadCounts: { $ref: '#/components/schemas/VendorNotificationUnreadCounts' }
 */
router.patch("/vendor/:vendorId/read-all", ownsVendor, markAllNotificationsRead);

/**
 * @swagger
 * /api/notifications/vendor/{vendorId}/{notificationId}/read:
 *   patch:
 *     summary: Mark one notification read
 *     tags: [Vendor Notifications]
 *     parameters:
 *       - { in: path, name: vendorId, required: true, schema: { type: string } }
 *       - { in: path, name: notificationId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: SUCCESS }
 *                 notification: { $ref: '#/components/schemas/VendorNotification' }
 *                 unreadCounts: { $ref: '#/components/schemas/VendorNotificationUnreadCounts' }
 *       404: { description: Not this vendor's notification }
 */
router.patch("/vendor/:vendorId/:notificationId/read", ownsVendor, markNotificationRead);

export default router;
