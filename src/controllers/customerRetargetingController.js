import * as retargeting from "../services/retargetingCampaignService.js";

/**
 * Unified retargeting popup — customer endpoints. Every route runs behind
 * protectCustomer and every lookup is scoped to req.customer._id inside the
 * service, so another customer's campaign id just 404s.
 *
 * ABANDONED_CHECKOUT prompts are tracked and resumed through the existing
 * /api/customer/recovery/:id/* endpoints (customerRecoveryController.js);
 * the /:campaignId/* endpoints here are for the browsing campaigns.
 */

const fail = (res, error) => res.status(error.status).json({ status: "FAILED", message: error.message });

/** @desc The one popup to show now (any campaign type), or `prompt: null`. */
export const getRetargetingPrompt = async (req, res) => {
  try {
    const prompt = await retargeting.selectCampaignForCustomer(req.customer._id);
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ status: "SUCCESS", prompt });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to load personalized suggestions", error: error.message });
  }
};

const track = (action, label) => async (req, res) => {
  try {
    const result = await action(req);
    if (result.error) return fail(res, result.error);
    return res.status(200).json({ status: "SUCCESS" });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: `Failed to record ${label}`, error: error.message });
  }
};

export const recordRetargetingImpression = track((req) => retargeting.recordImpression(req.customer._id, req.params.campaignId), "impression");
export const dismissRetargeting = track((req) => retargeting.dismiss(req.customer._id, req.params.campaignId), "dismissal");
export const recordRetargetingClick = track(
  (req) => retargeting.recordClick(req.customer._id, req.params.campaignId, req.body?.packageId),
  "click"
);
