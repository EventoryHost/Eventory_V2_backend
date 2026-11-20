import mongoose from "mongoose";
import Vendor from "../models/Vendor.js";
import Booking, { eventEndOf, istDayRange } from "../models/Booking.js";
import { whatsappConfig } from "../config/whatsapp.js";
import { notifyCustomerWhatsApp } from "./customerWhatsAppService.js";

/**
 * The 14 customer WhatsApp notifications, one function per business event.
 * Each one picks the recipient, the template values (by the names in
 * constants/customerWhatsAppTypes.js) and the dedupeKey that makes the
 * event send at most once.
 *
 * Every function resolves (never rejects) and is meant to be called
 * WITHOUT awaiting, after the change that triggers it is saved — exactly
 * like notifyVendor(). They are no-ops while WHATSAPP_NOTIFICATIONS_ENABLED
 * is off.
 *
 * Bookings carry the customer's Mongo _id in customerId; enquiries carry
 * none, so they are matched to an account by phone (as Booking's
 * autoLinkCustomer does). Customers see the vendor's pocName, never
 * businessName (see utils/publicFields.js).
 */

const IST = "Asia/Kolkata";

/** "14 Dec 2026" in IST. */
export const formatDate = (date) =>
  date ? new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST }) : null;

/** "₹12,500" (paise shown only when there are any). */
export const formatAmount = (amount) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const hasPaise = Math.round(n * 100) % 100 !== 0;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: hasPaise ? 2 : 0, maximumFractionDigits: 2 })}`;
};

/** "16:30" → "4:30 PM". */
export const formatSlotTime = (hhmm) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  if (hours > 23) return null;
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${match[2]} ${suffix}`;
};

const trimmed = (value) => (typeof value === "string" ? value.trim() || null : null);
// Templates read "your {{n}}" and "Start time: {{n}}" — see TEMPLATES.md.
const eventNameOf = (doc) => trimmed(doc?.eventType) || trimmed(doc?.packageSnapshot?.name) || "event";
const eventTimeOf = (booking) =>
  formatSlotTime(booking?.eventTiming?.startTime) || formatSlotTime(booking?.startTime) || "as per your booking";
const ms = (date) => (date ? new Date(date).getTime() : 0);

/** Default lookups against MongoDB. Tests pass their own. */
export const mongoLookups = {
  /** The vendor's customer-facing name (pocName). vendorId is "VEN…" or an _id. */
  async vendorName(vendorId) {
    if (!vendorId) return null;
    const raw = String(vendorId);
    const query = mongoose.Types.ObjectId.isValid(raw) ? { $or: [{ id: raw }, { _id: raw }] } : { id: raw };
    const vendor = await Vendor.findOne(query).select("pocName").lean();
    return trimmed(vendor?.pocName);
  },
  /** Public "EVT…" ids for Booking _ids. */
  async bookingIdsFor(ids) {
    const valid = (ids || []).map(String).filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!valid.length) return [];
    const rows = await Booking.find({ _id: { $in: valid } }).select("bookingId").lean();
    return rows.map((b) => b.bookingId).filter(Boolean);
  },
};

export function createCustomerWhatsAppEvents({ notify = notifyCustomerWhatsApp, lookups = mongoLookups, getConfig = whatsappConfig } = {}) {
  // Never rejects: a lookup failing must not surface in the caller.
  const safe = (name, fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", scope: "whatsapp", event: "trigger_failed", trigger: name, message: error?.message }));
      return { status: "error", reason: error?.message };
    }
  };
  // Cheap exit before any lookup while the feature is off.
  const off = () => !getConfig().enabledFlag;
  const skippedOff = { status: "skipped", reason: "disabled" };
  const vendorNameOf = async (vendorId) => (await lookups.vendorName(vendorId)) || "your vendor";

  const forBooking = async (booking) => ({
    bookingId: booking.bookingId,
    vendorName: await vendorNameOf(booking.vendorId),
    eventName: eventNameOf(booking),
    eventDate: formatDate(booking.eventDate),
  });
  const bookingRecipient = (booking) => ({ customerId: booking.customerId ? String(booking.customerId) : null });

  return {
    // 1. Account created — and again on first opt-in, because consent is
    // almost never given at signup (phone isn't even collected then). The
    // key is per customer, so they get it once whichever comes first.
    welcome: safe("welcome", async (customer) => {
      if (off() || !customer?._id) return skippedOff;
      return notify("welcome", { customerId: String(customer._id), dedupeKey: `welcome:${customer._id}` });
    }),

    // 2. The vendor sent their proposal (their response) on an enquiry.
    vendorResponse: safe("vendorResponse", async (enquiry) => {
      if (off()) return skippedOff;
      if (!enquiry?.customer?.phone) return { status: "skipped", reason: "no_customer_account" };
      return notify("vendorResponse", {
        phone: enquiry.customer.phone,
        dedupeKey: `vendorResponse:${enquiry.enquiryId}:${ms(enquiry.proposal?.submittedAt || enquiry.proposalSentAt)}`,
        refs: { enquiryId: enquiry.enquiryId },
        vars: {
          vendorName: await vendorNameOf(enquiry.vendorId),
          eventName: eventNameOf(enquiry),
          eventDate: formatDate(enquiry.eventDate) || "a date to be confirmed",
          enquiryId: enquiry.enquiryId,
        },
      });
    }),

    // 3. A customer checkout created this booking request.
    bookingRequested: safe("bookingRequested", async (booking) => {
      if (off()) return skippedOff;
      return notify("bookingRequest", {
        ...bookingRecipient(booking),
        dedupeKey: `bookingRequest:${booking.bookingId}`,
        refs: { bookingId: booking.bookingId },
        vars: await forBooking(booking),
      });
    }),

    // 4. The vendor (or Eventory) accepted, or the vendor declined.
    bookingStatusChanged: safe("bookingStatusChanged", async (booking) => {
      if (off()) return skippedOff;
      const accepted = booking.status === "Confirmed";
      if (!accepted && booking.status !== "Declined") return { status: "skipped", reason: "not_a_status_outcome" };
      const base = await forBooking(booking);
      return notify("bookingStatus", {
        ...bookingRecipient(booking),
        dedupeKey: `bookingStatus:${booking.bookingId}:${booking.status}`,
        refs: { bookingId: booking.bookingId },
        vars: {
          ...base,
          statusText: accepted ? "accepted" : "declined",
          statusDetail: accepted
            ? "Your date is reserved. You can see the details and payment schedule in the Eventory app."
            : "You can explore other vendors for your event in the Eventory app.",
        },
      });
    }),

    // 5. The vendor sent a revised proposal — the customer should review it.
    bookingModificationRequested: safe("bookingModificationRequested", async (booking) => {
      if (off()) return skippedOff;
      return notify("bookingModification", {
        ...bookingRecipient(booking),
        dedupeKey: `bookingModification:${booking.bookingId}:v${booking.proposalVersion || 0}`,
        refs: { bookingId: booking.bookingId },
        throttleMinutes: getConfig().modificationThrottleMinutes,
        vars: await forBooking(booking),
      });
    }),

    // 6. The revised booking is agreed by both sides and confirmed again.
    bookingModificationConfirmed: safe("bookingModificationConfirmed", async (booking) => {
      if (off()) return skippedOff;
      return notify("bookingModified", {
        ...bookingRecipient(booking),
        dedupeKey: `bookingModified:${booking.bookingId}:v${booking.proposalVersion || 0}`,
        refs: { bookingId: booking.bookingId },
        vars: await forBooking(booking),
      });
    }),

    // 7. Cancelled — by the customer or the vendor.
    bookingCancelled: safe("bookingCancelled", async (booking) => {
      if (off()) return skippedOff;
      if (booking.status !== "Cancelled") return { status: "skipped", reason: "not_cancelled" };
      return notify("bookingCancelled", {
        ...bookingRecipient(booking),
        dedupeKey: `bookingCancelled:${booking.bookingId}:${ms(booking.cancelledAt)}`,
        refs: { bookingId: booking.bookingId },
        vars: {
          ...(await forBooking(booking)),
          cancelledBy: booking.cancelledBy === "Customer" ? "at your request" : "by the vendor",
        },
      });
    }),

    // 8. Cashfree confirmed the order PAID (re-verified with PGFetchOrder).
    paymentSucceeded: safe("paymentSucceeded", async (payment) => {
      if (off()) return skippedOff;
      if (payment?.status !== "PAID") return { status: "skipped", reason: "payment_not_paid" };
      const bookingIds = await lookups.bookingIdsFor(payment.bookingId ? [payment.bookingId] : payment.createdBookingIds);
      return notify("paymentSuccess", {
        customerId: String(payment.customerId),
        dedupeKey: `paymentSuccess:${payment._id}`,
        refs: { bookingId: bookingIds[0] ?? null, paymentId: payment._id, milestoneId: payment.milestoneId },
        vars: {
          amount: formatAmount(payment.amount),
          bookingRef: bookingIds.length ? `booking ${bookingIds.join(", ")}` : "your Eventory booking",
          transactionRef: payment.cfOrderId,
        },
      });
    }),

    // 9. Cashfree confirmed the payment failed or the order expired. Only
    // called from the gateway-confirmed paths, never on a timeout.
    paymentFailed: safe("paymentFailed", async (payment) => {
      if (off()) return skippedOff;
      if (payment?.status !== "FAILED") return { status: "skipped", reason: "payment_not_failed" };
      const bookingIds = payment.bookingId ? await lookups.bookingIdsFor([payment.bookingId]) : [];
      return notify("paymentFailed", {
        customerId: String(payment.customerId),
        dedupeKey: `paymentFailed:${payment._id}`,
        refs: { bookingId: bookingIds[0] ?? null, paymentId: payment._id, milestoneId: payment.milestoneId },
        vars: {
          amount: formatAmount(payment.amount),
          bookingRef: bookingIds.length ? `booking ${bookingIds[0]}` : `order ${payment.cfOrderId}`,
        },
      });
    }),

    // 10. Scheduled: an unpaid instalment is due soon.
    paymentReminder: safe("paymentReminder", async (booking, milestone) => {
      if (off()) return skippedOff;
      return notify("paymentReminder", {
        ...bookingRecipient(booking),
        dedupeKey: `paymentReminder:${booking.bookingId}:${milestone._id}:${ms(milestone.dueDate)}`,
        refs: { bookingId: booking.bookingId, milestoneId: milestone._id },
        expiresAt: milestone.dueDate,
        vars: {
          amount: formatAmount(milestone.amount),
          milestoneTitle: trimmed(milestone.title) || "instalment",
          bookingId: booking.bookingId,
          dueDate: formatDate(milestone.dueDate),
        },
      });
    }),

    // 11. The team started processing the cancellation refund.
    refundInitiated: safe("refundInitiated", async (booking) => {
      if (off()) return skippedOff;
      if (!(booking.refund?.amount > 0)) return { status: "skipped", reason: "no_refund_amount" };
      return notify("refundInitiated", {
        ...bookingRecipient(booking),
        dedupeKey: `refundInitiated:${booking.bookingId}:${ms(booking.cancelledAt)}`,
        refs: { bookingId: booking.bookingId },
        vars: { amount: formatAmount(booking.refund.amount), bookingId: booking.bookingId },
      });
    }),

    // 12. The team confirmed the refund was paid out.
    refundCompleted: safe("refundCompleted", async (booking) => {
      if (off()) return skippedOff;
      if (booking.refund?.status !== "completed" || !(booking.refund?.amount > 0)) {
        return { status: "skipped", reason: "refund_not_completed" };
      }
      return notify("refundCompleted", {
        ...bookingRecipient(booking),
        dedupeKey: `refundCompleted:${booking.bookingId}:${ms(booking.cancelledAt)}`,
        refs: { bookingId: booking.bookingId },
        vars: { amount: formatAmount(booking.refund.amount), bookingId: booking.bookingId },
      });
    }),

    // 13. Scheduled: the event is tomorrow (IST). Pointless once the day starts.
    eventReminder: safe("eventReminder", async (booking) => {
      if (off()) return skippedOff;
      const day = istDayRange(booking.eventDate);
      if (!day) return { status: "skipped", reason: "no_event_date" };
      const base = await forBooking(booking);
      return notify("eventReminder", {
        ...bookingRecipient(booking),
        dedupeKey: `eventReminder:${booking.bookingId}:${day.key}`,
        refs: { bookingId: booking.bookingId },
        expiresAt: day.start,
        vars: { ...base, eventTime: eventTimeOf(booking) },
      });
    }),

    // 14. Scheduled: today is the event day (IST). Pointless once it ends.
    eventDayReminder: safe("eventDayReminder", async (booking) => {
      if (off()) return skippedOff;
      const day = istDayRange(booking.eventDate);
      if (!day) return { status: "skipped", reason: "no_event_date" };
      const base = await forBooking(booking);
      return notify("eventDay", {
        ...bookingRecipient(booking),
        dedupeKey: `eventDay:${booking.bookingId}:${day.key}`,
        refs: { bookingId: booking.bookingId },
        expiresAt: eventEndOf(booking),
        vars: { ...base, eventTime: eventTimeOf(booking) },
      });
    }),
  };
}

const customerWhatsApp = createCustomerWhatsAppEvents();

export default customerWhatsApp;
