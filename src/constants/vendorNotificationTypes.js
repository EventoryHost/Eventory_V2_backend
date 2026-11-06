/**
 * Every notification the vendor inbox can show, keyed by type.
 *
 * Copy follows the vendor-side handoff in Figma ("All … notifications"
 * sheets). Each entry decides the row's category, whether it sits under
 * "N actions required", where a tap goes, and the text — built from a
 * context the caller passes to notifyVendor() (see
 * services/vendorNotificationService.js for the context fields).
 *
 * `target(ctx)` returns { kind, id }; kinds are the model's
 * NOTIFICATION_TARGET_KINDS and the app maps each to a screen.
 */

const inr = (amount) =>
  amount == null || isNaN(amount)
    ? null
    : `₹${Math.round(Number(amount)).toLocaleString("en-IN")}`;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const who = (ctx) => ctx.customerName || "The customer";
const pkg = (ctx) => ctx.packageName || "Your package";
const sentence = (...parts) => parts.filter(Boolean).join(" ");

const booking = (ctx) => ({ kind: "booking", id: ctx.bookingId ?? null });
const eventDay = (ctx) => ({ kind: "eventDay", id: ctx.bookingId ?? null });
const enquiry = (ctx) => ({ kind: "enquiry", id: ctx.enquiryId ?? null });
const pkgTarget = (ctx) =>
  ctx.packageGroupId ? { kind: "package", id: ctx.packageGroupId } : { kind: "packages", id: null };

export const VENDOR_NOTIFICATION_TYPES = {
  // ── Enquiry ──────────────────────────────────────────────────────────────
  "enquiry.new": {
    category: "enquiry",
    needsAction: true,
    target: enquiry,
    title: (ctx) =>
      ctx.conflict ? "New enquiry, dates conflict" : `New enquiry from ${who(ctx)}`,
    body: (ctx) =>
      sentence(
        `${[pkg(ctx), ctx.eventDateLabel].filter(Boolean).join(", ")}.`,
        ctx.conflict
          ? "You already have an event that day."
          : ctx.requestCount
            ? `${plural(ctx.requestCount, "request")}.`
            : null,
        !ctx.conflict && ctx.respondByLabel ? `Respond by ${ctx.respondByLabel}.` : null
      ),
  },
  "enquiry.changesRequested": {
    category: "enquiry",
    needsAction: true,
    target: enquiry,
    title: (ctx) => `${who(ctx)} asked for ${plural(ctx.requestCount || 1, "change")}`,
    body: (ctx) => `${pkg(ctx)}. Review them and update your proposal.`,
  },

  // ── Booking ──────────────────────────────────────────────────────────────
  "booking.newRequest": {
    category: "booking",
    needsAction: true,
    target: booking,
    showsPackageImage: true,
    title: (ctx) => `New booking request from ${who(ctx)}`,
    body: (ctx) =>
      sentence(`${pkg(ctx)}. Free booking.`, ctx.respondByLabel ? `Confirm by ${ctx.respondByLabel}.` : null),
  },
  "booking.newTokenPaid": {
    category: "booking",
    needsAction: true,
    target: booking,
    showsPackageImage: true,
    title: (ctx) => `New booking from ${who(ctx)}, token paid`,
    body: (ctx) =>
      sentence(
        `${pkg(ctx)}.`,
        inr(ctx.amount) ? `${inr(ctx.amount)} token received.` : null,
        ctx.respondByLabel ? `Confirm by ${ctx.respondByLabel}.` : null
      ),
  },
  "booking.newWithRequests": {
    category: "booking",
    needsAction: true,
    target: booking,
    showsPackageImage: true,
    title: (ctx) => `New booking with ${plural(ctx.requestCount || 1, "request")}`,
    body: (ctx) =>
      `${pkg(ctx)}. ${who(ctx)} wants changes to ${plural(ctx.requestCount || 1, "item")}. Review each one.`,
  },
  "booking.changesRequested": {
    category: "booking",
    needsAction: true,
    target: booking,
    showsPackageImage: true,
    title: (ctx) => `${who(ctx)} asked for ${plural(ctx.requestCount || 1, "change")}`,
    body: (ctx) => `${pkg(ctx)}. Review the changes and respond.`,
  },
  "booking.proposalAccepted": {
    category: "booking",
    // Accepting a revised proposal hands the booking back to the vendor to
    // confirm; a re-confirmation needs nothing more from them.
    needsAction: (ctx) => !ctx.reconfirmed,
    target: booking,
    showsPackageImage: true,
    title: (ctx) => `${who(ctx)} accepted your proposal`,
    body: (ctx) =>
      ctx.reconfirmed
        ? `${pkg(ctx)}. The accepted changes are now part of the booking.`
        : `${pkg(ctx)}. Confirm the booking to lock the date.`,
  },
  "booking.cancelledByCustomer": {
    category: "booking",
    target: booking,
    showsPackageImage: true,
    title: (ctx) => `${who(ctx)} cancelled their booking`,
    body: (ctx) => `${pkg(ctx)}. Any cancellation charge will show in Payments.`,
  },
  "booking.confirmedByEventory": {
    category: "booking",
    target: booking,
    showsPackageImage: true,
    title: () => "Booking confirmed",
    body: (ctx) => `${pkg(ctx)} is confirmed by the Eventory team.`,
  },
  "booking.emAssigned": {
    category: "booking",
    target: booking,
    title: (ctx) => (ctx.emName ? `${ctx.emName} is your Event Manager` : "Event Manager assigned"),
    body: (ctx) => `For ${pkg(ctx)}. Reach out to them for anything about this booking.`,
  },
  "booking.reassigned": {
    category: "booking",
    target: booking,
    title: () => "New booking assigned to you",
    body: (ctx) => `${pkg(ctx)}. The Eventory team moved this booking to you.`,
  },

  // ── Event day ────────────────────────────────────────────────────────────
  "eventDay.dayRequest": {
    category: "eventDay",
    needsAction: true,
    target: eventDay,
    title: (ctx) => `${who(ctx)} added a request`,
    body: (ctx) =>
      ctx.requestText
        ? `"${ctx.requestText}". Share an update with a photo or message.`
        : "Share an update with a photo or message.",
  },
  "eventDay.review": {
    category: "eventDay",
    target: booking,
    title: (ctx) =>
      ctx.rating ? `${who(ctx)} rated you ${plural(ctx.rating, "star")}` : `New review from ${who(ctx)}`,
    body: (ctx) => ctx.reviewText || `For ${pkg(ctx)}.`,
  },

  // ── Payments ─────────────────────────────────────────────────────────────
  "payments.milestoneReceived": {
    category: "payments",
    target: booking,
    title: (ctx) => `${ctx.milestoneTitle || "Payment"} received`,
    body: (ctx) =>
      sentence(
        `${who(ctx)} paid ${inr(ctx.amount) ?? "a payment"}.`,
        ctx.remaining > 0 ? `${inr(ctx.remaining)} is left to collect.` : null
      ),
  },
  "payments.partialReceived": {
    category: "payments",
    target: booking,
    title: () => "Partial payment received",
    body: (ctx) =>
      sentence(
        `${who(ctx)} paid ${inr(ctx.amount) ?? "part of a payment"}${inr(ctx.due) ? ` of ${inr(ctx.due)}` : ""}.`,
        inr(ctx.shortBy) ? `${inr(ctx.shortBy)} is still due for ${ctx.milestoneTitle || "this payment"}.` : null
      ),
  },
  "payments.fullyPaid": {
    category: "payments",
    target: booking,
    title: () => "Booking fully paid",
    body: (ctx) => `${who(ctx)} has paid the full amount for ${pkg(ctx)}.`,
  },
  "payments.scheduleChanged": {
    category: "payments",
    target: booking,
    title: () => "Payment schedule changed by Eventory",
    body: (ctx) => `${pkg(ctx)}. Check the new due dates and amounts.`,
  },
  "payments.refundIssued": {
    category: "payments",
    target: booking,
    title: (ctx) => `Refund issued to ${who(ctx)}`,
    body: (ctx) =>
      inr(ctx.amount)
        ? `The booking was cancelled, so your payout is reduced by ${inr(ctx.amount)}.`
        : "The booking was cancelled, so your payout is reduced.",
  },
  "payments.payoutProcessed": {
    category: "payments",
    target: () => ({ kind: "payments", id: null }),
    title: () => "Payout processed",
    body: (ctx) => `${inr(ctx.amount) ?? "Your payout"} is on its way to your bank account.`,
  },

  // ── Package ──────────────────────────────────────────────────────────────
  "package.submitted": {
    category: "package",
    target: pkgTarget,
    showsPackageImage: (ctx) => Boolean(ctx.packageGroupId),
    title: () => "Package sent for verification",
    body: (ctx) => `${pkg(ctx)} is with our team. We'll tell you once it's reviewed.`,
  },
  "package.approved": {
    category: "package",
    needsAction: true,
    target: pkgTarget,
    showsPackageImage: (ctx) => Boolean(ctx.packageGroupId),
    title: () => "Package approved, go live",
    body: (ctx) => `${pkg(ctx)} is approved. Go live to start receiving bookings.`,
  },
  "package.changesNeeded": {
    category: "package",
    needsAction: true,
    target: pkgTarget,
    showsPackageImage: (ctx) => Boolean(ctx.packageGroupId),
    title: () => "Changes needed on your package",
    body: (ctx) => ctx.reason || `${pkg(ctx)} needs a few fixes before it can be approved.`,
  },
  "package.rejected": {
    category: "package",
    target: () => ({ kind: "packages", id: null }),
    title: () => "Package rejected",
    body: (ctx) => sentence(`${pkg(ctx)} was not approved.`, ctx.reason || null),
  },
  "package.live": {
    category: "package",
    target: pkgTarget,
    showsPackageImage: (ctx) => Boolean(ctx.packageGroupId),
    title: () => "Your package is live",
    body: (ctx) => `${pkg(ctx)} is now visible to customers.`,
  },
  "package.trashed": {
    category: "package",
    target: () => ({ kind: "packages", id: null }),
    title: () => "Package moved to trash",
    body: (ctx) => `${pkg(ctx)} is in trash.`,
  },

  // ── Profile ──────────────────────────────────────────────────────────────
  "profile.welcome": {
    category: "profile",
    target: () => ({ kind: "profile", id: null }),
    title: () => "Welcome to Eventory",
    body: () => "Your account is ready. Set up your business profile to start listing packages.",
  },
  "profile.verified": {
    category: "profile",
    target: () => ({ kind: "documents", id: null }),
    title: () => "Documents verified",
    body: () => "Your documents are approved. You can now send your packages for verification.",
  },
  "profile.changesRequested": {
    category: "profile",
    needsAction: true,
    target: () => ({ kind: "documents", id: null }),
    title: () => "Document needs re-upload",
    body: (ctx) => ctx.reason || "Some of your details need fixing. Update them to continue verification.",
  },
  "profile.rejected": {
    category: "profile",
    target: () => ({ kind: "documents", id: null }),
    title: () => "Verification unsuccessful",
    body: (ctx) => ctx.reason || "We couldn't verify your documents. Contact support for help.",
  },
  "profile.emAssigned": {
    category: "profile",
    target: () => ({ kind: "profile", id: null }),
    title: (ctx) => (ctx.emName ? `${ctx.emName} is your Event Manager` : "Event Manager assigned"),
    body: () => "They'll help you with your listings and bookings.",
  },

  // ── Support ──────────────────────────────────────────────────────────────
  "support.issueReported": {
    category: "support",
    needsAction: true,
    target: eventDay,
    title: (ctx) => `${who(ctx)} reported an issue`,
    body: (ctx) =>
      sentence(ctx.issueText ? `${ctx.issueText}.` : null, "Your Event Manager has been notified."),
  },
};

/** Action types a vendor clears by acting on the booking itself. */
export const BOOKING_RESPONSE_TYPES = [
  "booking.newRequest",
  "booking.newTokenPaid",
  "booking.newWithRequests",
  "booking.changesRequested",
  "booking.proposalAccepted",
];
