import express from "express";
import {
  getPaymentMethods,
  removePaymentMethod,
  setPrimaryPaymentMethod,
} from "../controllers/customerPaymentMethodController.js";
import { protectCustomer } from "../middlewares/customerAuth.js";

const router = express.Router();

/**
 * Mounted at /api/customer/payment-methods (src/routes/index.js) — backs the
 * Payment Details page. Distinct from /api/customer/payments, which creates
 * and confirms actual payments.
 *
 * There is intentionally NO create route: instruments are recorded by the
 * payment flow through saveInstrumentForCustomer(), never from a client
 * request body. See the security note on the SavedPaymentMethod model.
 */

/**
 * @swagger
 * /api/customer/payment-methods:
 *   get:
 *     summary: The customer's saved UPI IDs and cards, primary first
 *     description: |
 *       Returns display metadata only (last four digits, network, UPI
 *       handle). Cashfree's instrument reference is never sent to the client.
 *     tags: [Customer Payment Methods]
 *     responses:
 *       200: { description: "{ upiIds, cards } for the authenticated customer" }
 */
router.get("/", protectCustomer, getPaymentMethods);

/**
 * @swagger
 * /api/customer/payment-methods/{methodId}:
 *   delete:
 *     summary: Forget a saved instrument
 *     description: Promotes the next most recent instrument if the primary was removed.
 *     tags: [Customer Payment Methods]
 *     parameters:
 *       - in: path
 *         name: methodId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Removed }
 *       404: { description: Not found, or not this customer's }
 */
router.delete("/:methodId", protectCustomer, removePaymentMethod);

/**
 * @swagger
 * /api/customer/payment-methods/{methodId}/primary:
 *   patch:
 *     summary: Mark one saved instrument as primary
 *     tags: [Customer Payment Methods]
 *     parameters:
 *       - in: path
 *         name: methodId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Primary updated }
 *       404: { description: Not found, or not this customer's }
 */
router.patch("/:methodId/primary", protectCustomer, setPrimaryPaymentMethod);

export default router;
