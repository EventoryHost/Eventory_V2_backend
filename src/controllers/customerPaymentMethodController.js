import SavedPaymentMethod from "../models/SavedPaymentMethod.js";

/**
 * Saved payment instruments — the Payment Details page (Figma 1414:6624).
 *
 * READ AND DELETE ONLY, deliberately. There is no endpoint here that
 * accepts instrument details from the client: rows are written by the
 * payment flow via saveInstrumentForCustomer() below, once Cashfree
 * confirms an instrument was saved on its side. See the security note on
 * SavedPaymentMethod for why no cardholder data is accepted or stored.
 */

/** Fields safe to return — instrumentRef is internal and never sent to the client. */
const CLIENT_FIELDS =
  "methodType last4 network issuerLabel holderName vpa upiProvider isPrimary createdAt";

/**
 * @desc List the customer's saved instruments, primary first.
 */
export const getPaymentMethods = async (req, res) => {
  try {
    const methods = await SavedPaymentMethod.find({ customerId: req.customer._id })
      .select(CLIENT_FIELDS)
      .sort({ isPrimary: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      status: "SUCCESS",
      count: methods.length,
      upiIds: methods.filter((method) => method.methodType === "UPI"),
      cards: methods.filter((method) => method.methodType === "Card"),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ status: "ERROR", message: "Failed to fetch payment methods", error: error.message });
  }
};

/**
 * @desc Forget a saved instrument. Scoped to the caller, so one customer
 *       can never delete another's.
 */
export const removePaymentMethod = async (req, res) => {
  try {
    const deleted = await SavedPaymentMethod.findOneAndDelete({
      _id: req.params.methodId,
      customerId: req.customer._id,
    });
    if (!deleted) {
      return res.status(404).json({ status: "FAILED", message: "Payment method not found" });
    }

    // If the primary was removed, promote the next most recent so the list
    // doesn't end up with no primary at all.
    if (deleted.isPrimary) {
      const next = await SavedPaymentMethod.findOne({ customerId: req.customer._id }).sort({
        createdAt: -1,
      });
      if (next) {
        next.isPrimary = true;
        await next.save();
      }
    }

    return res.status(200).json({ status: "SUCCESS", message: "Payment method removed" });
  } catch (error) {
    return res
      .status(500)
      .json({ status: "ERROR", message: "Failed to remove payment method", error: error.message });
  }
};

/**
 * @desc Mark one instrument primary, clearing the flag on the rest.
 */
export const setPrimaryPaymentMethod = async (req, res) => {
  try {
    const customerId = req.customer._id;
    const target = await SavedPaymentMethod.findOne({ _id: req.params.methodId, customerId });
    if (!target) {
      return res.status(404).json({ status: "FAILED", message: "Payment method not found" });
    }

    await SavedPaymentMethod.updateMany({ customerId }, { $set: { isPrimary: false } });
    target.isPrimary = true;
    await target.save();

    return res.status(200).json({ status: "SUCCESS", message: "Primary payment method updated" });
  } catch (error) {
    return res
      .status(500)
      .json({ status: "ERROR", message: "Failed to update primary", error: error.message });
  }
};

/**
 * Internal helper for the payment flow — NOT wired to any route.
 *
 * Call this from the Cashfree webhook/confirmation path when the gateway
 * reports that an instrument was saved, passing only the reference and the
 * display metadata Cashfree returns. Never call it with data taken from a
 * client request body.
 */
export async function saveInstrumentForCustomer(customerId, instrument) {
  const {
    instrumentRef,
    methodType,
    last4 = null,
    network = null,
    issuerLabel = null,
    holderName = null,
    vpa = null,
    upiProvider = null,
  } = instrument;

  if (!customerId || !instrumentRef || !methodType) return null;

  const isFirst = (await SavedPaymentMethod.countDocuments({ customerId })) === 0;

  return SavedPaymentMethod.findOneAndUpdate(
    { customerId, instrumentRef },
    {
      $set: { methodType, last4, network, issuerLabel, holderName, vpa, upiProvider },
      $setOnInsert: { customerId, instrumentRef, isPrimary: isFirst },
    },
    { new: true, upsert: true }
  );
}
