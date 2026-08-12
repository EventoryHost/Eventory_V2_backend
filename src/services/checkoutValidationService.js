import { normalizePhone } from "../utils/phone.js";

/**
 * Phase 4 Step 17's "Validation before Continue" checks, pulled out of
 * customerCheckoutController.js so Step 18's payment creation can run the
 * exact same checks before letting a customer pay (never trust that the
 * frontend actually enforced canContinue) — same "extract to services/ once
 * a second controller needs it" pattern as Step 15's pricing engine.
 *
 * NOT checked, and NOT guessed at: "every choose-N item group satisfied"
 * (final BRD Section 10.5's last checklist item) — no Package schema
 * exposes a max_selectable-style field for a choose-N group's required
 * count, so there's nothing real to validate against.
 */

export function computeContactValidation(contactDetails, customer) {
  const errors = [];
  const name = contactDetails?.name;
  if (!name || name.trim().length < 2) errors.push("Contact name is required (2-100 characters)");

  const phone = contactDetails?.phone;
  let phoneVerified = false;
  if (!phone) {
    errors.push("Contact phone is required");
  } else {
    // Customer.phone is always stored normalized as "+91XXXXXXXXXX" (OTP/
    // social-auth flows); contactDetails.phone is a bare 10-digit string —
    // comparing raw would never match. Same normalizePhone() already used
    // for Booking/Enquiry auto-link, reused here rather than a third rule.
    phoneVerified = customer.isPhoneVerified === true && normalizePhone(customer.phone) === normalizePhone(phone);
    if (!phoneVerified) {
      errors.push("Phone number is not verified — verify it via POST /api/customer/phone/send-otp + /verify-otp before payment");
    }
  }

  const email = contactDetails?.email;
  if (!email && !phoneVerified) errors.push("Email is required unless phone is verified");

  return { valid: errors.length === 0, errors, phoneVerified };
}

export function computeLinesValidation(lines) {
  const perLine = lines.map((l) => {
    const errors = [];
    if (!l.eventDetails?.eventType) errors.push("eventType is missing");
    if (!l.eventDetails?.date) errors.push("date is missing");
    if (!l.eventDetails?.location) errors.push("location is missing");
    return { lineId: l._id, valid: errors.length === 0, errors };
  });
  return { valid: perLine.length > 0 && perLine.every((l) => l.valid), perLine };
}
