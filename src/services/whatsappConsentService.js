import Customer from "../models/Customer.js";

/**
 * The customer's WhatsApp opt-in / opt-out. The consent record
 * (Customer.whatsappConsent) is what sending checks; the existing
 * preferences.notification.whatsapp toggle is kept in step with it for the
 * apps that already read it.
 *
 * Consent is explicit: only a customer action (the consent endpoint, or the
 * profile's WhatsApp toggle) records it. Having a phone number never does.
 */

export const CONSENT_SOURCES = ["signup", "checkout", "booking", "profile", "settings", "support"];

const publicView = (customer) => ({
  optedIn: customer?.whatsappConsent?.status === "opted_in",
  status: customer?.whatsappConsent?.status ?? null,
  optedInAt: customer?.whatsappConsent?.optedInAt ?? null,
  optedOutAt: customer?.whatsappConsent?.optedOutAt ?? null,
  source: customer?.whatsappConsent?.source ?? null,
  phone: customer?.phone ?? null,
  isPhoneVerified: Boolean(customer?.isPhoneVerified),
});

export const consentView = publicView;

/**
 * Records an opt-in or opt-out for the customer with public id [customerId].
 * Resolves to { customer, changedToOptIn } — changedToOptIn is true only
 * when this call turned consent on (the caller sends the welcome then).
 * Opting in again keeps the original optedInAt.
 */
export async function setWhatsAppConsent(customerId, optIn, source) {
  const customer = await Customer.findOne({ id: customerId });
  if (!customer) return { customer: null, changedToOptIn: false };

  const wasOptedIn = customer.whatsappConsent?.status === "opted_in";
  // Already opted in for this same number: nothing new to record.
  const sameConsent = wasOptedIn && (customer.whatsappConsent.phone ?? null) === (customer.phone ?? null);
  const now = new Date();
  if (optIn) {
    customer.whatsappConsent = {
      status: "opted_in",
      optedInAt: sameConsent ? customer.whatsappConsent.optedInAt : now,
      optedOutAt: null,
      source: sameConsent ? customer.whatsappConsent.source : source,
      phone: customer.phone || null,
    };
  } else {
    customer.whatsappConsent = {
      status: "opted_out",
      optedInAt: customer.whatsappConsent?.optedInAt ?? null,
      optedOutAt: now,
      source,
      phone: customer.whatsappConsent?.phone ?? customer.phone ?? null,
    };
  }
  customer.set("preferences.notification.whatsapp", Boolean(optIn));
  await customer.save();
  return { customer, changedToOptIn: Boolean(optIn) && !sameConsent };
}

/**
 * The profile PATCH (customerController.updateCustomer) can flip
 * preferences.notification.whatsapp directly. When it does, record that as
 * consent given / withdrawn from the profile. No-op when the request didn't
 * touch the toggle or the record already agrees.
 */
export async function syncConsentFromPreferences(customer, requestedPreferences) {
  const unchanged = { customer, changedToOptIn: false };
  const wanted = requestedPreferences?.notification?.whatsapp;
  if (typeof wanted !== "boolean" || !customer) return unchanged;
  const current = customer.whatsappConsent?.status === "opted_in";
  if (wanted === current) return unchanged;
  try {
    const result = await setWhatsAppConsent(customer.id, wanted, "profile");
    return result.customer ? result : unchanged;
  } catch (error) {
    // The profile update itself already succeeded; don't fail it.
    console.error(`[whatsappConsent] syncing consent for ${customer.id} failed:`, error.message);
    return unchanged;
  }
}

export default { setWhatsAppConsent, syncConsentFromPreferences, consentView, CONSENT_SOURCES };
