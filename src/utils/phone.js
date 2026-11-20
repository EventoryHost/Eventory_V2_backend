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

const E164 = /^\+[1-9]\d{6,14}$/;
// Indian mobile numbers: 10 digits starting 6-9.
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/**
 * Splits a stored E.164 number ("+919876543210") into the country code and
 * national number Interakt's message API takes separately. Only the country
 * codes in [countryCodes] are accepted (longest match first), and +91
 * numbers must be real Indian mobiles. Returns null for anything else —
 * never guesses at a malformed number.
 */
export function splitE164(phone, countryCodes = ["+91"]) {
  if (typeof phone !== "string") return null;
  const value = phone.trim();
  if (!E164.test(value)) return null;
  const code = [...countryCodes]
    .filter((c) => /^\+[1-9]\d{0,3}$/.test(c))
    .sort((a, b) => b.length - a.length)
    .find((c) => value.startsWith(c));
  if (!code) return null;
  const national = value.slice(code.length);
  if (code === "+91" ? !INDIAN_MOBILE.test(national) : !/^\d{4,14}$/.test(national)) return null;
  return { countryCode: code, phoneNumber: national, e164: value };
}

/** "+91******3210" — for logs, which must never carry a full number. */
export const maskPhone = (phone) =>
  typeof phone === "string" && phone.length > 4 ? `${phone.slice(0, 3)}******${phone.slice(-4)}` : "***";

export default normalizePhone;
