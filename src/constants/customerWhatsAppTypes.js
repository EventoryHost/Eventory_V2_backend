/**
 * The customer WhatsApp notification catalogue — one entry per Interakt
 * template. `variables` is the ORDER of the template's body placeholders:
 * variables[0] fills {{1}}, variables[1] fills {{2}}, and so on. The
 * approved template must use exactly this many placeholders in this order
 * (docs/whatsapp/TEMPLATES.md has the copy for each).
 *
 * services/customerWhatsAppEvents.js builds a `vars` object per business
 * event; services/customerWhatsAppService.js turns it into bodyValues by
 * this order, so a template's variables are only ever defined here.
 *
 * `ttlHours` — how long a message stays worth sending. A send that is still
 * failing past this is dropped rather than delivered late (the caller can
 * pass an exact `expiresAt` instead, e.g. "before the event starts").
 */
export const CUSTOMER_WHATSAPP_TYPES = {
  welcome: {
    title: "Welcome message",
    category: "UTILITY",
    variables: ["customerName"],
    ttlHours: 24 * 7,
  },
  vendorResponse: {
    title: "New vendor response",
    category: "UTILITY",
    variables: ["customerName", "vendorName", "eventName", "eventDate", "enquiryId"],
    ttlHours: 48,
  },
  bookingRequest: {
    title: "Booking request submitted",
    category: "UTILITY",
    variables: ["customerName", "bookingId", "vendorName", "eventName", "eventDate"],
    ttlHours: 24,
  },
  bookingStatus: {
    title: "Booking status update",
    category: "UTILITY",
    variables: ["customerName", "bookingId", "vendorName", "eventDate", "statusText", "statusDetail"],
    ttlHours: 48,
  },
  bookingModification: {
    title: "Booking modification request",
    category: "UTILITY",
    variables: ["customerName", "vendorName", "bookingId", "eventDate"],
    ttlHours: 48,
  },
  bookingModified: {
    title: "Booking modification confirmed",
    category: "UTILITY",
    variables: ["customerName", "bookingId", "vendorName", "eventDate"],
    ttlHours: 48,
  },
  bookingCancelled: {
    title: "Booking cancelled",
    category: "UTILITY",
    variables: ["customerName", "bookingId", "vendorName", "eventDate", "cancelledBy"],
    ttlHours: 48,
  },
  paymentSuccess: {
    title: "Payment successful",
    category: "UTILITY",
    variables: ["customerName", "amount", "bookingRef", "transactionRef"],
    ttlHours: 24,
  },
  paymentFailed: {
    title: "Payment failed",
    category: "UTILITY",
    variables: ["customerName", "amount", "bookingRef"],
    ttlHours: 6,
  },
  paymentReminder: {
    title: "Payment reminder",
    category: "UTILITY",
    variables: ["customerName", "amount", "milestoneTitle", "bookingId", "dueDate"],
    ttlHours: 24,
  },
  refundInitiated: {
    title: "Refund initiated",
    category: "UTILITY",
    variables: ["customerName", "amount", "bookingId"],
    ttlHours: 72,
  },
  refundCompleted: {
    title: "Refund completed",
    category: "UTILITY",
    variables: ["customerName", "amount", "bookingId"],
    ttlHours: 72,
  },
  eventReminder: {
    title: "Upcoming event reminder",
    category: "UTILITY",
    variables: ["customerName", "eventName", "eventDate", "eventTime", "vendorName", "bookingId"],
    ttlHours: 24,
  },
  eventDay: {
    title: "Event-day reminder",
    category: "UTILITY",
    variables: ["customerName", "eventName", "eventTime", "vendorName", "bookingId"],
    ttlHours: 12,
  },
};

export const CUSTOMER_WHATSAPP_TYPE_KEYS = Object.keys(CUSTOMER_WHATSAPP_TYPES);

export default CUSTOMER_WHATSAPP_TYPES;
