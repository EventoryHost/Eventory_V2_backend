import express from "express";
const router = express.Router();
import {
  createCustomer,
  getCustomerById,
  updateCustomer,
  deactivateCustomer,
  reactivateCustomer,
} from "../controllers/customerController.js";
import { protectCustomer, requireSelf } from "../middlewares/customerAuth.js";

/**
 * GET/PATCH/deactivate below now require a valid customer JWT (protectCustomer)
 * AND that the token's owner matches the :id in the URL (requireSelf) — a
 * customer can only ever read/update/deactivate their own profile, never
 * another customer's by guessing an ID.
 *
 * POST / (create) stays open — in normal operation an account is created
 * automatically by customerAuthController.verifyOtp on first login, so this
 * endpoint is mainly for admin/internal tooling; it does not leak any other
 * customer's data since it only ever creates a new document.
 *
 * reactivate intentionally stays unprotected for now: a deactivated
 * customer's JWT is rejected by protectCustomer, so self-service
 * reactivation is impossible by design — this must go behind an admin role
 * once one exists in this codebase.
 *
 * There is deliberately no "get all customers" endpoint — listing
 * every customer's PII should only ever exist behind an admin role,
 * which doesn't exist in this codebase yet either.
 */

/**
 * @swagger
 * /api/customers:
 *   post:
 *     summary: Create a new customer
 *     description: Creates a customer profile (invoked by the auth flow on first-time OTP verification).
 *     tags:
 *       - Customers
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "+919876543210"
 *               name:
 *                 type: string
 *                 example: "Jane Doe"
 *               email:
 *                 type: string
 *                 example: "jane@example.com"
 *     responses:
 *       201:
 *         description: Customer created successfully
 *       409:
 *         description: Customer with this phone/email already exists
 */
router.route("/").post(createCustomer);

/**
 * @swagger
 * /api/customers/{id}:
 *   get:
 *     summary: Get a single customer
 *     description: Retrieve profile details of a specific customer by their ID.
 *     tags:
 *       - Customers
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *     responses:
 *       200:
 *         description: Customer details
 *       404:
 *         description: Customer not found
 *   patch:
 *     summary: Update a customer's profile
 *     description: Update self-updatable profile fields (name, profilePicture, dateOfBirth, gender, addresses, preferences). Identity/verification/role fields cannot be changed through this endpoint.
 *     tags:
 *       - Customers
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Jane Doe"
 *     responses:
 *       200:
 *         description: Customer updated successfully
 *       404:
 *         description: Customer not found
 */
router
  .route("/:id")
  .get(protectCustomer, requireSelf, getCustomerById)
  .patch(protectCustomer, requireSelf, updateCustomer);

router.patch("/:id/deactivate", protectCustomer, requireSelf, deactivateCustomer);
router.patch("/:id/reactivate", reactivateCustomer);

export default router;
