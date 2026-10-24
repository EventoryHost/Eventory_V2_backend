import { MAX_SETUP_PHOTOS } from "../models/Booking.js";
import { normalizePhone } from "../utils/phone.js";

// Vendor event-day request bodies (POST/PUT /api/bookings/:bookingId/event-day/...).
// Same hand-rolled { valid, errors } shape as bookingValidators.js, since these
// controllers answer through the same `invalid` helper. Each also returns
// `value`, the cleaned input the controller should store.

const GROUND_NAME_MAX = 60;
const UPDATE_MESSAGE_MAX = 1000;
const URL_MAX = 2000;

// Uploaded file URLs only. A prefix check would miss "DATA:" or
// "javascript:" (schemes are case-insensitive), so the scheme is
// allow-listed — the same rule as adminBookingValidators.js's isHttpUrl.
const isHttpUrl = (value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Checks a list of photo URLs, pushing errors under `field`. Returns the
 * trimmed URLs.
 */
const checkPhotos = (photos, field, { min, max }, errors) => {
  if (!Array.isArray(photos)) {
    errors.push(`${field} must be an array of URLs`);
    return [];
  }
  if (photos.length < min || photos.length > max) {
    errors.push(
      min > 0
        ? `${field} must have between ${min} and ${max} photos`
        : `${field} can have at most ${max} photos`
    );
  }
  return photos.map((url, i) => {
    const trimmed = typeof url === "string" ? url.trim() : "";
    if (!trimmed || trimmed.length > URL_MAX || !isHttpUrl(trimmed)) {
      errors.push(`${field}[${i}] must be an uploaded http(s) URL`);
    }
    return trimmed;
  });
};

/**
 * A 10-digit Indian mobile number in any common spelling ("98765 43210",
 * "+91-9876543210", "09876543210"), returned in the canonical "+91XXXXXXXXXX"
 * form (utils/phone.js). null for anything else — normalizePhone alone would
 * take the last 10 digits of any longer string, which is too lenient for
 * input the vendor is typing in now.
 */
export const parseIndianMobile = (raw) => {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  const local =
    digits.length === 10
      ? digits
      : digits.length === 11 && digits.startsWith("0")
        ? digits.slice(1)
        : digits.length === 12 && digits.startsWith("91")
          ? digits.slice(2)
          : null;
  if (!local || !/^[6-9]\d{9}$/.test(local)) return null;
  return normalizePhone(local);
};

/** POST /event-day/setup — { photos: [url] }, 1 to MAX_SETUP_PHOTOS. */
export const validateSetupPhotos = (body) => {
  const errors = [];
  const photos = checkPhotos(body?.photos, "photos", { min: 1, max: MAX_SETUP_PHOTOS }, errors);
  return { valid: errors.length === 0, errors, value: { photos } };
};

/** PUT /event-day/ground-contact — { name, phone }. */
export const validateGroundContact = (body) => {
  const errors = [];
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    errors.push("name is required");
  } else if (name.length > GROUND_NAME_MAX) {
    errors.push(`name must be at most ${GROUND_NAME_MAX} characters`);
  }
  const phone = parseIndianMobile(body?.phone);
  if (!phone) errors.push("phone must be a 10-digit Indian mobile number");
  return { valid: errors.length === 0, errors, value: { name, phone } };
};

/**
 * POST /event-day/day-requests/:requestId/update — { message?, photos? },
 * at least one of a non-empty message or a non-empty photo list.
 */
export const validateDayRequestUpdate = (body) => {
  const errors = [];

  let message = null;
  if (body?.message !== undefined && body?.message !== null) {
    if (typeof body.message !== "string") {
      errors.push("message must be a string");
    } else {
      message = body.message.trim() || null;
      if (message && message.length > UPDATE_MESSAGE_MAX) {
        errors.push(`message must be at most ${UPDATE_MESSAGE_MAX} characters`);
      }
    }
  }

  let photos = [];
  if (body?.photos !== undefined && body?.photos !== null) {
    photos = checkPhotos(body.photos, "photos", { min: 0, max: MAX_SETUP_PHOTOS }, errors);
  }

  if (!errors.length && !message && !photos.length) {
    errors.push("Send a message or at least one photo");
  }
  return { valid: errors.length === 0, errors, value: { message, photos } };
};
