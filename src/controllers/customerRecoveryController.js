import * as recoveryService from "../services/checkoutRecoveryService.js";

/**
 * Abandoned-checkout recovery prompt — customer endpoints. Every route runs
 * behind protectCustomer, and every lookup is scoped to req.customer._id
 * inside the service, so a recovery id from another account just 404s.
 * See services/checkoutRecoveryService.js for the rules.
 */

const fail = (res, error) =>
  res.status(error.status).json({ status: "FAILED", ...(error.code ? { code: error.code } : {}), message: error.message });

/**
 * @desc The recovery prompt to show this customer right now, or null.
 * `recovery: null` is the normal answer — it is not an error.
 */
export const getRecoveryPrompt = async (req, res) => {
  try {
    const recovery = await recoveryService.getPromptForCustomer(req.customer._id);
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ status: "SUCCESS", recovery });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to load booking reminder", error: error.message });
  }
};

/** @desc The prompt was shown. */
export const recordRecoveryImpression = async (req, res) => {
  try {
    const result = await recoveryService.recordImpression(req.customer._id, req.params.recoveryId);
    if (result.error) return fail(res, result.error);
    return res.status(200).json({ status: "SUCCESS" });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to record reminder impression", error: error.message });
  }
};

/** @desc "Not now" / close. */
export const dismissRecovery = async (req, res) => {
  try {
    const result = await recoveryService.dismiss(req.customer._id, req.params.recoveryId);
    if (result.error) return fail(res, result.error);
    return res.status(200).json({ status: "SUCCESS" });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to dismiss booking reminder", error: error.message });
  }
};

/** @desc "Continue Booking" — re-validates and says where to send the customer. */
export const resumeRecovery = async (req, res) => {
  try {
    const result = await recoveryService.resume(req.customer._id, req.params.recoveryId);
    if (result.error) return fail(res, result.error);
    const { ok: _ok, ...resume } = result;
    return res.status(200).json({ status: "SUCCESS", resume });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to continue booking", error: error.message });
  }
};
