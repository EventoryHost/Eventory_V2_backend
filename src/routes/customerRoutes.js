import express from "express";
const router = express.Router();
import {
  getCustomerById,
  updateCustomer,
  updateCustomerEmail,
  deactivateCustomer,
  reactivateCustomer,
} from "../controllers/customerController.js";
import { protectCustomer, requireSelf } from "../middlewares/customerAuth.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import { updateCustomerSchema, updateEmailSchema } from "../validators/customerValidators.js";

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

/**
 * @swagger
 * /api/customers/{id}/email:
 *   patch:
 *     summary: Change the customer's own email — Phase 5 Step 25
 *     description: |
 *       Always resets isEmailVerified to false on change — NO real
 *       re-verification is sent (no email service exists in this codebase
 *       yet, see info.txt). The new address is honestly reported as
 *       unverified rather than faked as verified or blocked outright.
 *     tags:
 *       - Customers
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: Email updated (isEmailVerified now false) }
 *       404: { description: Customer not found }
 *       409: { description: This email is already linked to another account }
 */
router.patch("/:id/email", protectCustomer, requireSelf, validateRequest(updateEmailSchema), updateCustomerEmail);

router.patch("/:id/deactivate", protectCustomer, requireSelf, deactivateCustomer);
router.patch("/:id/reactivate", reactivateCustomer);

export default router;
