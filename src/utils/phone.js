/**
 * Normalizes a free-text phone number into the canonical "+91XXXXXXXXXX"
 * form Customer.phone is always stored in (set by the OTP/social auth
 * flows). Vendor-entered numbers on Booking/Enquiry are free text — no
 * format is enforced there — so this exists to make the two comparable.
 *
 * Strips everything but digits, then takes the last 10 digits (handles
 * "+91 98765 43210", "091-9876543210", "9876543210", stray spaces/dashes,
 * a leading trunk "0", etc.). Returns null if fewer than 10 digits remain
 * — not enough to be a real mobile number, so it's left unmatched rather
 * than guessed at.
 */
export function normalizePhone(raw) {
  if (!raw || typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  return `+91${last10}`;
}

export default normalizePhone;
