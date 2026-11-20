import customerWhatsApp from "../services/customerWhatsAppEvents.js";
import { consentView, setWhatsAppConsent } from "../services/whatsappConsentService.js";

/**
 * @desc  The customer's WhatsApp notification consent
 * @route GET /api/customer/whatsapp-consent
 */
export const getWhatsAppConsent = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: consentView(req.customer) });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc  Opt in to (or out of) WhatsApp notifications. Must come from an
 *        explicit customer action — a checkbox or toggle they chose.
 * @route PUT /api/customer/whatsapp-consent
 * @body  { optIn: boolean, source?: "signup" | "checkout" | "booking" | "profile" | "settings" | "support" }
 */
export const updateWhatsAppConsent = async (req, res, next) => {
  try {
    const { optIn, source = "settings" } = req.body;
    const { customer, changedToOptIn } = await setWhatsAppConsent(req.customer.id, optIn, source);
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    // First opt-in: the welcome message (sent once per customer).
    if (changedToOptIn) customerWhatsApp.welcome(customer);

    const view = consentView(customer);
    return res.status(200).json({
      success: true,
      message: optIn ? "WhatsApp notifications turned on" : "WhatsApp notifications turned off",
      data: view,
      // Opted in but nothing can be sent until the phone is verified.
      ...(optIn && !view.isPhoneVerified ? { warning: "Verify your phone number to receive WhatsApp notifications." } : {}),
    });
  } catch (error) {
    next(error);
  }
};
