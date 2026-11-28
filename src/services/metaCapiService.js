import crypto from "crypto";

/**
 * Meta Conversions API — server-side "Purchase".
 *
 * Sent right after bookings are newly created from a checkout (see the end of
 * bookingCreationService.js's createBookingsFromCheckoutSession), alongside
 * the browser Pixel's Purchase from the /booking-success page. Both carry the
 * SAME event_id so Meta counts the pair once.
 *
 * Off by default: needs META_PIXEL_ID, META_CAPI_ACCESS_TOKEN and
 * META_GRAPH_API_VERSION. Optional META_CAPI_TEST_EVENT_CODE routes events to
 * Events Manager > Test events (remove it before real traffic).
 *
 * Never throws and never logs the access token — a Meta problem must not
 * affect booking creation.
 */

const REQUEST_TIMEOUT_MS = 5000;
let warnedDisabled = false;

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

/** Meta wants lowercased, trimmed email. */
function hashEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return normalized ? sha256(normalized) : null;
}

/**
 * Digits only, with the country code and no "+" (e.g. 9198xxxxxxxx). A bare
 * 10-digit Indian number gets 91 prefixed; a leading 0 is dropped first.
 */
function hashPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  digits = digits.replace(/^0+/, "");
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 ? sha256(digits) : null;
}

/**
 * Must stay identical to the frontend's trackPurchase event id
 * (Eventory_V2_frontend/src/lib/analytics.ts): "purchase_" + the booking ids
 * from the /booking-success?bookingIds=... URL (the Booking _id strings),
 * default-sorted and joined with "_".
 */
export function purchaseEventId(bookingIds) {
  return `purchase_${[...bookingIds].map(String).sort().join("_")}`;
}

/**
 * @param {object} p
 * @param {Array<string|object>} p.bookingIds - the new Booking _ids
 * @param {number} p.value - total booking value (sum of each booking's grandTotal)
 * @param {string} [p.currency="INR"]
 * @param {{id?: any, email?: string|null, phone?: string|null}} [p.customer]
 * @param {{fbp?: string|null, fbc?: string|null, clientIp?: string|null, userAgent?: string|null}} [p.tracking]
 * @param {string} [p.eventSourceUrl]
 * @param {string[]} [p.contentIds] - package ids
 */
export async function sendMetaPurchaseEvent({
  bookingIds,
  value,
  currency = "INR",
  customer = {},
  tracking = {},
  eventSourceUrl,
  contentIds = [],
}) {
  try {
    const pixelId = process.env.META_PIXEL_ID;
    const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
    const version = process.env.META_GRAPH_API_VERSION;
    if (!pixelId || !accessToken || !version) {
      if (!warnedDisabled) {
        warnedDisabled = true;
        console.warn("[metaCapi] META_PIXEL_ID / META_CAPI_ACCESS_TOKEN / META_GRAPH_API_VERSION not set — Meta Conversions API is disabled.");
      }
      return;
    }
    if (!bookingIds?.length) return;

    const eventId = purchaseEventId(bookingIds);
    const email = hashEmail(customer.email);
    const phone = hashPhone(customer.phone);
    const externalId = customer.id ? sha256(String(customer.id)) : null;

    const userData = {
      ...(email ? { em: [email] } : {}),
      ...(phone ? { ph: [phone] } : {}),
      ...(externalId ? { external_id: [externalId] } : {}),
      // Not hashed, per Meta's spec.
      ...(tracking.fbp ? { fbp: tracking.fbp } : {}),
      ...(tracking.fbc ? { fbc: tracking.fbc } : {}),
      ...(tracking.clientIp ? { client_ip_address: tracking.clientIp } : {}),
      ...(tracking.userAgent ? { client_user_agent: tracking.userAgent } : {}),
    };

    const body = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          action_source: "website",
          ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
          user_data: userData,
          custom_data: {
            currency,
            value: Number(value) || 0,
            order_id: eventId,
            content_ids: contentIds.map(String),
            content_type: "product",
          },
        },
      ],
      ...(process.env.META_CAPI_TEST_EVENT_CODE ? { test_event_code: process.env.META_CAPI_TEST_EVENT_CODE } : {}),
    };

    const url = `https://graph.facebook.com/${version}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Meta's error body names the problem (bad token, wrong version...) and never echoes the token.
      const text = await response.text().catch(() => "");
      console.warn(`[metaCapi] Purchase ${eventId} rejected: HTTP ${response.status} ${text.slice(0, 300)}`);
    }
  } catch (error) {
    // error.message from fetch can include the request URL; strip the token before logging.
    const token = process.env.META_CAPI_ACCESS_TOKEN;
    const message = String(error?.message || error);
    console.warn(`[metaCapi] Purchase send failed: ${token ? message.split(token).join("<token>") : message}`);
  }
}
