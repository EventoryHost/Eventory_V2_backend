import express from "express";
const router = express.Router();
import {
  getCustomerById,
  updateCustomer,
  deactivateCustomer,
  reactivateCustomer,
} from "../controllers/customerController.js";
import { protectCustomer, requireSelf } from "../middlewares/customerAuth.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { updateCustomerSchema } from "../validators/customerValidators.js";

/**
 * GET/PATCH/deactivate below require a valid customer access token
 * (protectCustomer) AND that the token's owner matches the :id in the URL
 * (requireSelf) — a customer can only ever read/update/deactivate their own
 * profile, never another customer's by guessing an ID.
 *
 * There is no direct "create customer" endpoint here on purpose — accounts
 * are created via /api/customer/auth/signup (email+password) or Google/
 * Facebook login, both of which set up a usable authProviders[] entry. A
 * bare POST /api/customers would mint an account with no password and no
 * linked provider, which could never log in.
 *
 * reactivate intentionally stays unprotected for now: a deactivated
 * customer's token is rejected by protectCustomer, so self-service
 * reactivation is impossible by design — this must go behind an admin role
 * once one exists in this codebase.
 *
 * There is deliberately no "get all customers" endpoint — listing
 * every customer's PII should only ever exist behind an admin role,
 * which doesn't exist in this codebase yet either.
 */

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
  .patch(protectCustomer, requireSelf, validateRequest(updateCustomerSchema), updateCustomer);

router.patch("/:id/deactivate", protectCustomer, requireSelf, deactivateCustomer);
router.patch("/:id/reactivate", reactivateCustomer);

export default router;
