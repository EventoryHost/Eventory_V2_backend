import mongoose from "mongoose";
import Booking, {
  PRE_ACCEPTANCE_STATUSES,
  TERMINAL_STATUSES,
  isFullyPaid,
} from "../models/Booking.js";
import Package from "../models/Package.js";
import Customer from "../models/Customer.js";
import { generateISTId } from "../utils/idGenerator.js";
import { snapshotDeliverables } from "../utils/packageDeliverables.js";
import { packageCoverImage } from "../utils/packageCoverImage.js";
import { getEffectivePackagePrice } from "../utils/packagePrice.js";
import { releaseSlotIfUnused } from "../utils/releaseSlot.js";
import { normalizePhone } from "../utils/phone.js";
import { applyPricingBreakdown } from "../utils/pricingBreakdown.js";
import {
  DEFAULT_ADDITIONAL_CHARGES_LABEL,
  mergeAdditionalChargesIntoFinal,
} from "../utils/additionalCharges.js";
import { round2 } from "../utils/money.js";
import { resolveVendorRefId } from "../utils/resolveVendor.js";
import { generateGroundCode } from "../utils/groundLink.js";
import {
  detectConflict,
  milestonesFromPackage,
  pendingRequestCount,
  REVISED_PRICE_LABEL,
  RESPONSE_WINDOW_MS,
  syncPackageBooked,
} from "./bookingController.js";
import {
  bookingLookup,
  bookingNotFound,
  buildBookingDetail,
  isObjectIdString,
  saveValidationFailed,
  syncPackageCalendar,
} from "./adminBookingController.js";
import { recordVendorMilestoneDue } from "../services/vendorPayoutService.js";
import {
  contextFromDeal,
  notifyVendor,
  resolveVendorActions,
} from "../services/vendorNotificationService.js";
import { BOOKING_RESPONSE_TYPES } from "../constants/vendorNotificationTypes.js";

/**
 * Booking operations the Eventory team runs from the V2 admin portal, on the
 * vendor's or the customer's behalf: book a package for a customer, answer a
 * customisation request, acknowledge / decline / cancel, move the date or
 * venue, reassign to another vendor, act on the event day, and close the
 * event.
 *
 * Unlike the raw field editor (adminBookingController.updateBooking) each of
 * these is one workflow step with the same side effects the vendor's own
 * action has — package calendar, vendor inbox, payout due records — so the
 * booking stays consistent for the vendor app and the customer site.
 *
 * Every response is the full admin detail ({ success, data }), the same shape
 * GET /api/admin/bookings/:bookingId returns, so the admin screen can simply
 * replace its state with it.
 */

// ─── Helpers ────────────────────────────────────────────────

const fail = (res, code, message, extra = {}) =>
  res.status(code).json({ success: false, message, ...extra });

const serverError = (res, label, error) => {
  console.error(`[adminBookingOps] ${label}:`, error);
  return res.status(500).json({ success: false, message: error.message });
};

const respond = async (res, booking, extra = {}, code = 200) =>
  res.status(code).json({ success: true, data: await buildBookingDetail(booking), ...extra });

const loadBooking = async (req, res) => {
  const filter = bookingLookup(String(req.params.bookingId || ""));
  const booking = filter && (await Booking.findOne(filter));
  if (!booking) {
    bookingNotFound(res);
    return null;
  }
  return booking;
};

/** Saves, turning a model validation failure into a 400 instead of a 500. */
const saveOr400 = async (res, booking) => {
  try {
    await booking.save();
    return true;
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
      saveValidationFailed(res, error);
      return false;
    }
    throw error;
  }
};

const inr = (amount) => `₹${Math.round(Number(amount) || 0).toLocaleString("en-IN")}`;

// Requests carry no price of their own (pricing is one figure per breakdown
// row), so the price the admin sets on a line is kept on its note, in a form
// parsePriceNote can read back when the decision changes later.
const PRICE_NOTE = /^₹([\d,]+) · priced by Eventory/;
const priceNote = (price, note) => {
  const parts = [];
  if (price != null && price > 0) parts.push(`${inr(price)} · priced by Eventory`);
  if (note) parts.push(String(note).trim());
  const text = parts.join(" — ").slice(0, 500);
  return text || null;
};
const parsePriceNote = (vendorNote) => {
  const match = PRICE_NOTE.exec(vendorNote || "");
  return match ? Number(match[1].replace(/,/g, "")) : null;
};

const appendNote = (booking, line) => {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const entry = `[Eventory ${stamp}] ${line}`;
  booking.notes = booking.notes ? `${booking.notes}\n${entry}` : entry;
};

const formatDay = (date) =>
  date
    ? new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
    : "—";

const isEventDayValid = (booking) => booking.status === "Confirmed";

// The pricing row a customisation line moves: removals lower the price,
// additions and changes raise it.
const customizeRow = (requestType) => (requestType === "remove" ? "itemsRemoved" : "itemsAdded");
const changeRow = (changeType, itemKind) =>
  itemKind === "Addon"
    ? changeType === "Remove" ? "addonsRemoved" : "addonsAdded"
    : changeType === "Remove" ? "itemsRemoved" : "itemsAdded";

const bumpPricing = (booking, row, delta) => {
  if (!delta) return;
  booking.pricing[row] = Math.max(0, round2((booking.pricing[row] || 0) + delta));
};

/** An add-on becomes a selectedAddOns entry plus an accepted Addon change request. */
const addOnEntries = (addOn, { requestedAt = new Date() } = {}) => {
  const quantity = addOn.quantity || 1;
  const total = round2((addOn.price || 0) * quantity);
  return {
    total,
    selected: {
      addOnId: addOn.addOnId || (addOn.custom ? `custom-${new mongoose.Types.ObjectId()}` : null),
      name: addOn.name,
      price: addOn.price || 0,
      quantity,
      category: addOn.category ?? (addOn.custom ? "Custom" : null),
      subCategory: addOn.subCategory ?? null,
      color: addOn.color ?? null,
      image: addOn.image ?? null,
    },
    // The vendor app does not read selectedAddOns — add-ons reach it as
    // Addon change requests (booking_model.dart), so each one is mirrored.
    change: {
      changeType: "Add",
      itemKind: "Addon",
      category: addOn.category || (addOn.custom ? "Custom add-on" : "Add-ons"),
      item: addOn.name,
      qty: quantity,
      status: "Accepted",
      requestedAt,
      respondedAt: requestedAt,
      vendorNote: priceNote(total, addOn.custom ? "custom add-on" : null),
    },
  };
};

const customizeEntry = (line, index, now) => {
  const status = line.status || "Pending";
  return {
    setupId: line.setupId || "admin",
    itemId: line.itemId || `admin-${index + 1}`,
    requestType: line.requestType,
    label: line.label,
    quantity: line.quantity ?? null,
    type: line.type ?? null,
    colours: line.colours || [],
    volume: line.volume ?? null,
    status,
    requestedAt: now,
    respondedAt: status === "Pending" ? null : now,
    vendorNote: priceNote(line.price, line.note),
  };
};

/** Resolves the vendor and package and checks they belong together. */
const resolveTarget = async (vendorIdRaw, packageId) => {
  const vendorRef = await resolveVendorRefId(vendorIdRaw);
  if (!vendorRef) return { error: [404, "Vendor not found"] };
  const pkg = isObjectIdString(String(packageId)) ? await Package.findById(packageId) : null;
  if (!pkg) return { error: [404, "Package not found"] };
  const pkgVendorRef = pkg.vendorId ? await resolveVendorRefId(String(pkg.vendorId)) : null;
  if (pkgVendorRef && String(pkgVendorRef) !== String(vendorRef)) {
    return { error: [400, "That package belongs to a different vendor"] };
  }
  return { vendorRef: String(vendorRef), pkg };
};

/**
 * Finds the customer account for this phone, or opens one — the same
 * phone-only account the OTP login creates, so the customer's first login
 * lands on it and sees the booking.
 */
const findOrCreateCustomer = async ({ name, phone, email }) => {
  const canonical = normalizePhone(phone);
  if (!canonical) return null;
  let customer = await Customer.findOne({ phone: canonical });
  if (customer) {
    if (!customer.name && name) {
      customer.name = name;
      await customer.save();
    }
    return customer;
  }
  const emailFree = email ? !(await Customer.exists({ email: email.toLowerCase() })) : false;
  customer = await Customer.create({
    name,
    phone: canonical,
    ...(email && emailFree ? { email } : {}),
  });
  return customer;
};

/**
 * Builds (does not save) a booking the admin enters by hand. Shared by
 * POST /api/admin/bookings and reassignment. Returns { booking, pkg } or
 * { error: [code, message, extra?] }.
 */
const buildAdminBooking = async (input, { carry = {} } = {}) => {
  const target = await resolveTarget(input.vendorId, input.packageId);
  if (target.error) return target;
  const { vendorRef, pkg } = target;

  const status = input.status || "NewBooking";
  if (input.allowConflict !== true) {
    const conflict = await detectConflict(vendorRef, input.eventDate);
    if (conflict) {
      return {
        error: [409, "Vendor already has a booking or calendar block on this date", { conflict: true }],
      };
    }
  }

  const customer = carry.customerId
    ? { id: carry.customerId }
    : await findOrCreateCustomer(input.customer);
  const phone = normalizePhone(input.customer.phone) || input.customer.phone || null;
  const now = new Date();

  const pricing = {
    basePrice: input.pricing?.basePrice ?? null,
    itemsAdded: 0,
    itemsRemoved: 0,
    addonsAdded: 0,
    addonsRemoved: 0,
    substituteItemsAdded: input.pricing?.substituteItemsAdded || 0,
    additionalCharges: input.pricing?.additionalCharges || 0,
    additionalChargesLabel:
      input.pricing?.additionalChargesLabel?.trim() || DEFAULT_ADDITIONAL_CHARGES_LABEL,
    discountAmount: input.pricing?.discountAmount || 0,
    discountLabel: input.pricing?.discountLabel?.trim() || "Discount Allowed",
    taxRatePct:
      input.pricing?.taxRatePct ?? pkg.step3_policiesAndCharges?.gstRatePercent ?? 0,
    taxLabel: input.pricing?.taxLabel?.trim() || "GST",
    updatedAt: now,
  };

  // Chargeable setup choices are priced on top of the package, as at checkout.
  const selectedItems = (input.selectedItems || []).map((item) => ({
    groupKey: item.groupKey,
    itemId: item.itemId ?? null,
    itemName: item.itemName,
    price: item.price || 0,
    isChargeable: Boolean(item.isChargeable),
  }));
  pricing.itemsAdded += selectedItems
    .filter((item) => item.isChargeable)
    .reduce((sum, item) => sum + (item.price || 0), 0);

  const customizeRequests = (input.customizeRequests || []).map((line, index) => {
    const entry = customizeEntry(line, index, now);
    if (entry.status === "Accepted" && line.price) pricing[customizeRow(line.requestType)] += line.price;
    return entry;
  });

  const selectedAddOns = [];
  const changeRequests = [...(carry.changeRequests || [])];
  for (const addOn of input.addOns || []) {
    const { total, selected, change } = addOnEntries(addOn, { requestedAt: now });
    selectedAddOns.push(selected);
    changeRequests.push(change);
    pricing.addonsAdded += total;
  }
  for (const key of ["itemsAdded", "itemsRemoved", "addonsAdded"]) pricing[key] = round2(pricing[key]);
  if (carry.pricing) Object.assign(pricing, carry.pricing);

  const booking = new Booking({
    bookingId: generateISTId("EVT"),
    vendorId: vendorRef,
    packageId: String(pkg._id),
    customerId: customer?.id ?? null,
    customer: {
      name: input.customer.name.trim(),
      phone,
      email: input.customer.email || null,
    },
    eventType: input.eventType || null,
    eventDate: new Date(input.eventDate),
    guestRange: input.guestRange || undefined,
    location: input.location || null,
    mapLink: input.mapLink || null,
    startTime: input.startTime,
    endTime: input.endTime,
    eventTiming: input.eventTiming || undefined,
    alternateCoordinator: input.alternateCoordinator || undefined,
    packageSnapshot: {
      name: pkg.step1_eventAndCrew?.packageName || "Untitled Package",
      price: getEffectivePackagePrice(pkg),
      image: packageCoverImage(pkg),
      vendorType: pkg.vendorType || null,
      variantType: pkg.variantType || "Premium",
      gstRatePercent: pkg.step3_policiesAndCharges?.gstRatePercent ?? null,
      gstInclusive: pkg.step3_policiesAndCharges?.gstInclusive ?? false,
      deliverables: snapshotDeliverables(pkg),
    },
    paymentType: input.paymentType,
    status,
    respondByAt: new Date(now.getTime() + RESPONSE_WINDOW_MS),
    selectedItems,
    selectedAddOns,
    customizeRequests,
    changeRequests,
    pricing,
    notes: input.notes || null,
    eventNote: input.eventNote || null,
    calendarNote: input.calendarNote || null,
  });

  const breakdown = applyPricingBreakdown(booking);

  if (input.paymentMilestones?.length) {
    booking.paymentMilestones = input.paymentMilestones.map((m) => ({
      title: m.title,
      percentage: m.percentage ?? null,
      amount: round2(m.amount),
      dueDate: m.dueDate ?? null,
      status: m.status || "Pending",
      receivedDate: m.status === "Received" ? m.receivedDate || now : null,
    }));
  } else {
    const planned = milestonesFromPackage(pkg, breakdown.finalAmount);
    booking.paymentMilestones = planned.length
      ? planned
      : [{ title: "Final Payment", percentage: 100, amount: Math.round(breakdown.finalAmount), status: "Pending" }];
    // Paid in full off-platform: every instalment is in.
    if (input.paymentType === "FullPaid") {
      for (const m of booking.paymentMilestones) {
        m.status = "Received";
        m.receivedDate = now;
      }
    }
  }

  booking.totalReceived = round2(
    booking.paymentMilestones
      .filter((m) => m.status === "Received")
      .reduce((sum, m) => sum + (m.amount || 0), 0) + (carry.unattributedReceived || 0)
  );

  if (status === "Confirmed") {
    booking.confirmedAt = now;
    if (customizeRequests.length || changeRequests.length) {
      booking.proposalResponse = { status: "Accepted", respondedAt: now };
    }
  }

  return { booking, pkg };
};

/** Side effects of a booking the admin just created (after save). */
const afterAdminBookingCreated = async (booking, { notificationType } = {}) => {
  const warnings = [];
  if (booking.status === "Confirmed") {
    try {
      await syncPackageBooked(booking.packageId, booking.eventDate);
    } catch (error) {
      warnings.push(`package calendar not updated (${error.message})`);
    }
  }
  // Money already in hand is owed to the vendor — the same due records a
  // checkout payment leaves for the payout queue.
  for (const milestone of booking.paymentMilestones.filter((m) => m.status === "Received")) {
    try {
      await recordVendorMilestoneDue({
        booking,
        milestoneTitle: milestone.title,
        grossAmount: milestone.amount,
      });
    } catch (error) {
      warnings.push(`payout record for "${milestone.title}" not created (${error.message})`);
    }
  }

  const requestCount = booking.customizeRequests.filter((r) => r.status === "Pending").length;
  const token = booking.paymentMilestones.find((m) => m.status === "Received");
  const type =
    notificationType ||
    (booking.status === "Confirmed"
      ? "booking.confirmedByEventory"
      : requestCount > 0
        ? "booking.newWithRequests"
        : booking.paymentType !== "FreeBooking" && token?.amount > 0
          ? "booking.newTokenPaid"
          : "booking.newRequest");
  notifyVendor(type, {
    ...contextFromDeal(booking),
    requestCount,
    amount: token?.amount,
    dedupeKey: `booking.new:${booking.bookingId}`,
  });
  return warnings;
};

const warningOf = (warnings) =>
  warnings.length ? { warning: `Saved, but: ${warnings.join("; ")}` } : {};

// ─── POST /api/admin/bookings ───────────────────────────────

/**
 * @desc  The admin books a package for a customer (phone / offline sale).
 *        The booking is written exactly like the vendor's own manual booking
 *        plus everything checkout would carry — customer account, setup
 *        choices, customisation lines, add-ons, discount, payment plan — so
 *        it lists in the vendor app and on the customer's account.
 */
export const createAdminBooking = async (req, res) => {
  try {
    const built = await buildAdminBooking(req.body);
    if (built.error) {
      const [code, message, extra] = built.error;
      return fail(res, code, message, extra);
    }
    const { booking } = built;
    appendNote(booking, "Booked by the Eventory team from the admin portal.");
    if (!(await saveOr400(res, booking))) return;

    const warnings = await afterAdminBookingCreated(booking);
    return respond(res, booking, warningOf(warnings), 201);
  } catch (error) {
    return serverError(res, "create booking", error);
  }
};

// ─── Acknowledge / decline / cancel ─────────────────────────

/**
 * @route PUT /api/admin/bookings/:bookingId/acknowledge   (alias: /force-accept)
 * Confirms a booking for the vendor — token paid, free, or with requests
 * the admin has settled. No vendorConfirmBlock: the admin overrides it.
 */
export const acknowledgeBooking = async (req, res) => {
  try {
    const booking = await loadBooking(req, res);
    if (!booking) return;
    if (!PRE_ACCEPTANCE_STATUSES.includes(booking.status)) {
      return fail(res, 400, `Cannot acknowledge a booking with status "${booking.status}".`);
    }
    if (req.body?.allowConflict !== true) {
      const conflict = await detectConflict(booking.vendorId, booking.eventDate, booking._id);
      if (conflict) {
        return fail(res, 409, "Vendor already has a booking or calendar block on this date", { conflict: true });
      }
    }

    const before = { status: booking.status, packageId: booking.packageId, eventDate: booking.eventDate };
    const now = new Date();
    booking.status = "Confirmed";
    booking.confirmedAt = booking.confirmedAt || now;
    booking.vendorSeenAt = booking.vendorSeenAt || now;
    if (pendingRequestCount(booking) === 0 && (booking.customizeRequests.length || booking.changeRequests.length)) {
      booking.proposalResponse = { status: "Accepted", respondedAt: now };
    }
    appendNote(booking, "Acknowledged and confirmed by the Eventory team.");
    if (!(await saveOr400(res, booking))) return;

    resolveVendorActions(booking.vendorId, booking.bookingId, BOOKING_RESPONSE_TYPES);
    const failures = await syncPackageCalendar(before, booking);
    notifyVendor("booking.confirmedByEventory", contextFromDeal(booking));
    return respond(res, booking, warningOf(failures));
  } catch (error) {
    return serverError(res, "acknowledge booking", error);
  }
};

/** @route PUT /api/admin/bookings/:bookingId/decline   body { reason? } */
export const declineBooking = async (req, res) => {
  try {
    const booking = await loadBooking(req, res);
    if (!booking) return;
    if (!PRE_ACCEPTANCE_STATUSES.includes(booking.status)) {
      return fail(res, 400, `Cannot decline a booking with status "${booking.status}".`);
    }
    booking.status = "Declined";
    booking.declinedAt = new Date();
    booking.declineReason = req.body?.reason?.trim() || "Declined by Eventory";
    appendNote(booking, `Declined: ${booking.declineReason}`);
    if (!(await saveOr400(res, booking))) return;

    resolveVendorActions(booking.vendorId, booking.bookingId);
    notifyVendor("booking.updatedByEventory", {
      ...contextFromDeal(booking),
      changeSummary: "The Eventory team declined this booking request.",
    });
    return respond(res, booking);
  } catch (error) {
    return serverError(res, "decline booking", error);
  }
};

/**
 * @route PUT /api/admin/bookings/:bookingId/cancel   body { cancelledBy, reason }
 * cancelledBy is who the cancellation is attributed to (the model has no
 * Admin value): "Vendor" for a vendor not responding, "Customer" for a
 * customer request. The reason is prefixed so the trail shows Eventory did it.
 */
export const cancelBooking = async (req, res) => {
  try {
    const booking = await loadBooking(req, res);
    if (!booking) return;
    const result = await cancelInPlace(booking, req.body.cancelledBy, req.body.reason);
    if (result.error) return fail(res, 400, result.error);
    if (!(await saveOr400(res, booking))) return;
    await afterCancel(booking);
    notifyVendor("booking.updatedByEventory", {
      ...contextFromDeal(booking),
      changeSummary: "The Eventory team cancelled this booking.",
    });
    return respond(res, booking);
  } catch (error) {
    return serverError(res, "cancel booking", error);
  }
};

const cancelInPlace = async (booking, cancelledBy, reason) => {
  if (TERMINAL_STATUSES.includes(booking.status)) {
    return { error: `Cannot cancel a booking with status "${booking.status}".` };
  }
  booking.status = "Cancelled";
  booking.cancelledAt = new Date();
  booking.cancelledBy = cancelledBy === "Customer" ? "Customer" : "Vendor";
  booking.cancellationReason = `Cancelled by Eventory: ${String(reason || "").trim()}`.slice(0, 1000);
  // Money taken is for the team to refund by hand (PUT /:bookingId/refund).
  if ((booking.totalReceived || 0) > 0 && !booking.refund) {
    booking.refund = {
      paid: booking.totalReceived,
      amount: null,
      charges: null,
      policy: "Eventory",
      status: "team_review",
    };
  }
  appendNote(booking, booking.cancellationReason);
  return {};
};

const afterCancel = async (booking) => {
  resolveVendorActions(booking.vendorId, booking.bookingId);
  await releaseSlotIfUnused(booking.packageId, booking.eventDate, { excludeBookingId: booking._id });
};

// ─── POST /:bookingId/respond — customisation response, applied directly ───

/**
 * The admin answers the customer's requests and the answer is final: each
 * request is accepted or rejected with its price, new lines and add-ons go
 * straight in as accepted, the pricing rows move by the priced lines, the
 * unpaid instalments absorb the difference, and (by default) the booking is
 * confirmed — no Review Proposal round on the customer site.
 */
export const respondToRequests = async (req, res) => {
  try {
    const booking = await loadBooking(req, res);
    if (!booking) return;
    if (TERMINAL_STATUSES.includes(booking.status)) {
      return fail(res, 400, `Cannot change a booking with status "${booking.status}".`);
    }

    const { decisions = [], newItems = [], addOns = {}, pricing = {} } = req.body;
    const confirm = req.body.confirm !== false;
    const now = new Date();
    if (!booking.pricing) booking.pricing = {};
    // Pin the GST rate the booking is shown with (see adminBookingController.updateBooking).
    if (booking.pricing.$isDefault?.("taxRatePct") && booking.packageSnapshot?.gstRatePercent != null) {
      booking.pricing.taxRatePct = booking.packageSnapshot.gstRatePercent;
    }
    const previousTotal = booking.totalAmount || applyPricingBreakdown(booking).finalAmount;
    const summary = [];

    for (const decision of decisions) {
      const list = decision.kind === "change" ? booking.changeRequests : booking.customizeRequests;
      const request = list.id(decision.id);
      if (!request) return fail(res, 404, `Request "${decision.id}" not found`);

      const row =
        decision.kind === "change"
          ? changeRow(request.changeType, request.itemKind)
          : customizeRow(request.requestType);
      const oldPrice = parsePriceNote(request.vendorNote);
      const oldContribution = request.status === "Accepted" ? oldPrice || 0 : 0;
      const price = decision.price ?? oldPrice ?? 0;
      const newContribution = decision.status === "Accepted" ? price : 0;
      bumpPricing(booking, row, newContribution - oldContribution);

      if (decision.kind === "change" && decision.qty !== undefined) request.qty = decision.qty;
      request.status = decision.status;
      request.respondedAt = now;
      request.vendorNote = priceNote(decision.price ?? oldPrice, decision.note);
      summary.push(`${decision.status.toLowerCase()} "${request.label || request.item}"`);
    }

    newItems.forEach((line, index) => {
      const entry = customizeEntry(
        { ...line, status: line.status || "Accepted" },
        booking.customizeRequests.length + index,
        now
      );
      booking.customizeRequests.push(entry);
      if (entry.status === "Accepted") bumpPricing(booking, customizeRow(line.requestType), line.price || 0);
      summary.push(`${line.requestType} "${line.label}"`);
    });

    for (const addOn of addOns.add || []) {
      const { total, selected, change } = addOnEntries(addOn, { requestedAt: now });
      booking.selectedAddOns.push(selected);
      booking.changeRequests.push(change);
      bumpPricing(booking, "addonsAdded", total);
      summary.push(`added add-on "${addOn.name}"`);
    }
    for (const name of addOns.remove || []) {
      const index = booking.selectedAddOns.findIndex((a) => a.name === name);
      if (index === -1) return fail(res, 404, `Add-on "${name}" is not on this booking`);
      const removed = booking.selectedAddOns[index];
      const total = round2((removed.price || 0) * (removed.quantity || 1));
      booking.selectedAddOns.splice(index, 1);
      booking.changeRequests.push({
        changeType: "Remove",
        itemKind: "Addon",
        category: removed.category || "Add-ons",
        item: removed.name,
        qty: removed.quantity || 1,
        status: "Accepted",
        requestedAt: now,
        respondedAt: now,
        vendorNote: priceNote(total, "removed by Eventory"),
      });
      bumpPricing(booking, "addonsRemoved", total);
      summary.push(`removed add-on "${name}"`);
    }

    for (const key of [
      "basePrice",
      "substituteItemsAdded",
      "additionalCharges",
      "discountAmount",
      "taxRatePct",
    ]) {
      if (pricing[key] !== undefined) booking.pricing[key] = pricing[key];
    }
    if (pricing.discountLabel !== undefined) {
      booking.pricing.discountLabel = pricing.discountLabel?.trim() || "Discount Allowed";
    }
    if (pricing.additionalChargesLabel !== undefined) {
      booking.pricing.additionalChargesLabel =
        pricing.additionalChargesLabel?.trim() || DEFAULT_ADDITIONAL_CHARGES_LABEL;
    }
    if (pricing.taxLabel !== undefined) booking.pricing.taxLabel = pricing.taxLabel?.trim() || "GST";
    booking.pricing.updatedAt = now;

    // Every request now has an answer from Eventory — anything left Pending
    // is one the admin didn't touch.
    const stillPending = pendingRequestCount(booking);
    if (confirm && stillPending > 0) {
      return fail(res, 409, `Decide every request first (${stillPending} still pending).`, {
        code: "REQUESTS_PENDING",
      });
    }

    applyPricingBreakdown(booking);
    const totalDelta = round2((booking.totalAmount || 0) - previousTotal);
    // The unpaid instalments absorb the difference, final one first — the
    // same rule the vendor's own repricing follows.
    if (totalDelta !== 0) mergeAdditionalChargesIntoFinal(booking, totalDelta, REVISED_PRICE_LABEL);

    booking.proposalVersion = (booking.proposalVersion || 0) + 1;
    booking.proposalSentAt = now;
    booking.proposalResponse = { status: "Accepted", respondedAt: now };

    const before = { status: booking.status, packageId: booking.packageId, eventDate: booking.eventDate };
    if (confirm && booking.status !== "Confirmed") {
      if (req.body.allowConflict !== true) {
        const conflict = await detectConflict(booking.vendorId, booking.eventDate, booking._id);
        if (conflict) {
          return fail(res, 409, "Vendor already has a booking or calendar block on this date", { conflict: true });
        }
      }
      booking.status = "Confirmed";
      booking.confirmedAt = booking.confirmedAt || now;
    } else if (!confirm && PRE_ACCEPTANCE_STATUSES.includes(booking.status)) {
      booking.status = "InDiscussion";
    }

    appendNote(
      booking,
      `Requests answered by Eventory${summary.length ? `: ${summary.join(", ")}` : ""}. Total ${inr(previousTotal)} → ${inr(booking.totalAmount)}.`
    );
    if (!(await saveOr400(res, booking))) return;

    resolveVendorActions(booking.vendorId, booking.bookingId, [
      "booking.newWithRequests",
      "booking.changesRequested",
      "booking.customisationRequested",
      ...BOOKING_RESPONSE_TYPES,
    ]);
    const failures = await syncPackageCalendar(before, booking);
    if (totalDelta !== 0) notifyVendor("payments.scheduleChanged", contextFromDeal(booking));
    notifyVendor("booking.updatedByEventory", {
      ...contextFromDeal(booking),
      changeSummary: `The customer's requests were answered${confirm ? " and the booking is confirmed" : ""}. New total ${inr(booking.totalAmount)}.`,
    });
    return respond(res, booking, warningOf(failures));
  } catch (error) {
    return serverError(res, "respond to requests", error);
  }
};

// ─── PUT /:bookingId/details — date / venue / time change ───

export const changeBookingDetails = async (req, res) => {
  try {
    const booking = await loadBooking(req, res);
    if (!booking) return;
    if (TERMINAL_STATUSES.includes(booking.status)) {
      return fail(res, 400, `Cannot change a booking with status "${booking.status}".`);
    }

    const body = req.body;
    const before = {
      status: booking.status,
      packageId: booking.packageId,
      eventDate: booking.eventDate ? new Date(booking.eventDate) : null,
    };
    const changes = [];
    const describe = (label, from, to) => {
      if (String(from ?? "") !== String(to ?? "")) changes.push(`${label} ${from || "—"} → ${to || "—"}`);
    };

    if (body.eventDate) {
      describe("date", formatDay(booking.eventDate), formatDay(body.eventDate));
      booking.eventDate = body.eventDate;
    }
    if (body.startTime || body.endTime) {
      const from = [booking.startTime, booking.endTime].filter(Boolean).join("–");
      if (body.startTime) booking.startTime = body.startTime;
      if (body.endTime) booking.endTime = body.endTime;
      describe("slot", from, [booking.startTime, booking.endTime].filter(Boolean).join("–"));
    }
    if (body.eventTiming) {
      const from = [booking.eventTiming?.startTime, booking.eventTiming?.endTime].filter(Boolean).join("–");
      for (const key of ["startTime", "endTime"]) {
        if (body.eventTiming[key] !== undefined) booking.set(`eventTiming.${key}`, body.eventTiming[key]);
      }
      describe("event timing", from, [booking.eventTiming?.startTime, booking.eventTiming?.endTime].filter(Boolean).join("–"));
    }
    if (body.location !== undefined) {
      describe("venue", booking.location, body.location);
      booking.location = body.location;
    }
    if (body.mapLink !== undefined) booking.mapLink = body.mapLink;
    if (body.guestRange) {
      const from = [booking.guestRange?.min, booking.guestRange?.max].filter((v) => v != null).join("–");
      for (const key of ["min", "max"]) {
        if (body.guestRange[key] !== undefined) booking.set(`guestRange.${key}`, body.guestRange[key]);
      }
      describe("guests", from, [booking.guestRange?.min, booking.guestRange?.max].filter((v) => v != null).join("–"));
    }

    if (!changes.length && body.mapLink === undefined) {
      return fail(res, 400, "Nothing changed");
    }

    const dateMoved = before.eventDate && new Date(booking.eventDate).getTime() !== before.eventDate.getTime();
    if (dateMoved && body.allowConflict !== true) {
      const conflict = await detectConflict(booking.vendorId, booking.eventDate, booking._id);
      if (conflict) {
        return fail(res, 409, "Vendor already has a booking or calendar block on this date", { conflict: true });
      }
    }

    appendNote(booking, `Details changed (${changes.join("; ") || "map link"}). Reason: ${body.reason}`);
    if (!(await saveOr400(res, booking))) return;

    const failures = await syncPackageCalendar(before, booking);
    notifyVendor("booking.updatedByEventory", {
      ...contextFromDeal(booking),
      changeSummary: `Changed: ${changes.join("; ") || "map link"}.`,
    });
    return respond(res, booking, warningOf(failures));
  } catch (error) {
    return serverError(res, "change booking details", error);
  }
};

// ─── PUT /:bookingId/reassign — move the booking to another vendor ───

/**
 * packageSnapshot is immutable, so a booking can't simply be pointed at a
 * different vendor's package — it would keep showing the old package. The
 * booking is cloned for the new vendor and package (customer, event,
 * requests, add-ons, discount, money already received) and the old one is
 * cancelled with a cross-reference.
 */
export const reassignBooking = async (req, res) => {
  try {
    const old = await loadBooking(req, res);
    if (!old) return;
    if (["Completed"].includes(old.status)) {
      return fail(res, 400, "A completed booking cannot be reassigned.");
    }
    const { newVendorId, newPackageId, reason, keepDecisions, allowConflict } = req.body;

    const receivedMilestones = old.paymentMilestones.filter((m) => m.status === "Received");
    const receivedTotal = receivedMilestones.reduce((sum, m) => sum + (m.amount || 0), 0);
    const unattributed = Math.max(0, round2((old.totalReceived || 0) - receivedTotal));

    const input = {
      customer: {
        name: old.customer?.name,
        phone: old.customer?.phone || "",
        email: old.customer?.email || null,
      },
      vendorId: newVendorId,
      packageId: newPackageId,
      eventType: old.eventType,
      eventDate: old.eventDate,
      startTime: old.startTime,
      endTime: old.endTime,
      eventTiming: old.eventTiming?.toObject?.() ?? old.eventTiming,
      guestRange: old.guestRange?.toObject?.() ?? old.guestRange,
      location: old.location,
      mapLink: old.mapLink,
      alternateCoordinator: old.alternateCoordinator?.toObject?.() ?? old.alternateCoordinator,
      selectedItems: old.selectedItems.map((i) => i.toObject()),
      customizeRequests: old.customizeRequests.map((r) => ({
        setupId: r.setupId,
        itemId: r.itemId,
        requestType: r.requestType,
        label: r.label,
        quantity: r.quantity,
        type: r.type,
        colours: r.colours,
        volume: r.volume,
        status: keepDecisions ? r.status : "Pending",
        price: keepDecisions ? parsePriceNote(r.vendorNote) ?? undefined : undefined,
      })),
      addOns: old.selectedAddOns.map((a) => ({ ...a.toObject(), custom: false })),
      pricing: {
        discountAmount: old.pricing?.discountAmount || 0,
        discountLabel: old.pricing?.discountLabel,
        additionalCharges: old.pricing?.additionalCharges || 0,
        additionalChargesLabel: old.pricing?.additionalChargesLabel,
      },
      paymentType: old.paymentType,
      status: "NewBooking",
      notes: old.notes,
      eventNote: old.eventNote,
      calendarNote: old.calendarNote,
      allowConflict,
    };

    const built = await buildAdminBooking(input, {
      carry: {
        customerId: old.customerId,
        unattributedReceived: unattributed,
        // Customer-asked item changes travel with the booking; the add-on
        // mirrors are rebuilt from selectedAddOns.
        changeRequests: old.changeRequests
          .filter((c) => c.itemKind !== "Addon")
          .map((c) => ({
            changeType: c.changeType,
            itemKind: c.itemKind,
            category: c.category,
            item: c.item,
            qty: c.qty,
            status: keepDecisions ? c.status : "Pending",
            requestedAt: c.requestedAt,
          })),
      },
    });
    if (built.error) {
      const [code, message, extra] = built.error;
      return fail(res, code, message, extra);
    }
    const { booking } = built;

    // Money the customer already paid moves with the booking: the received
    // instalments are carried over and the new plan covers only the rest.
    if (receivedMilestones.length) {
      const carried = receivedMilestones.map((m) => ({
        title: m.title,
        percentage: null,
        amount: m.amount,
        dueDate: m.dueDate,
        status: "Received",
        receivedDate: m.receivedDate,
      }));
      const remaining = Math.max(0, round2((booking.totalAmount || 0) - receivedTotal - unattributed));
      const open = booking.paymentMilestones.filter((m) => m.status !== "Received");
      const openTotal = open.reduce((sum, m) => sum + (m.amount || 0), 0) || 1;
      const scaled = open.map((m) => ({
        title: m.title,
        percentage: null,
        amount: round2((remaining * (m.amount || 0)) / openTotal),
        dueDate: m.dueDate,
        status: "Pending",
      }));
      booking.paymentMilestones = [...carried, ...(remaining > 0 ? scaled : [])];
      booking.totalReceived = round2(receivedTotal + unattributed);
    }
    booking.convenienceFee = old.convenienceFee ?? null;
    appendNote(booking, `Reassigned by Eventory from ${old.bookingId} (vendor ${old.vendorId}). Reason: ${reason}`);
    if (!(await saveOr400(res, booking))) return;

    await cancelInPlace(old, "Vendor", `Reassigned to ${booking.bookingId} — ${reason}`);
    // The refund record would double-count money that moved to the new booking.
    old.refund = null;
    await old.save();
    // Releases the old package's date if nothing else holds it.
    await afterCancel(old);

    // Payout dues for money already received now belong to the new vendor.
    const warnings = await afterAdminBookingCreated(booking, { notificationType: "booking.reassigned" });
    notifyVendor("booking.updatedByEventory", {
      ...contextFromDeal(old),
      changeSummary: "The Eventory team moved this booking to another vendor.",
    });

    return respond(res, booking, { previousBookingId: old.bookingId, ...warningOf(warnings) }, 201);
  } catch (error) {
    return serverError(res, "reassign booking", error);
  }
};

// ─── PUT /:bookingId/complete ───────────────────────────────

export const completeBooking = async (req, res) => {
  try {
    const booking = await loadBooking(req, res);
    if (!booking) return;
    if (booking.status === "Completed") return fail(res, 400, "Already completed.");
    const force = req.body?.force === true;

    if (!force) {
      if (booking.status !== "Confirmed") {
        return fail(res, 409, `Only a confirmed booking can be completed (this one is ${booking.status}).`, {
          code: "NOT_CONFIRMED",
        });
      }
      const pending = pendingRequestCount(booking);
      if (pending > 0) {
        return fail(res, 409, `${pending} request(s) still pending.`, { code: "REQUESTS_PENDING" });
      }
      if (!isFullyPaid(booking)) {
        return fail(res, 409, "Not every payment milestone is received.", {
          code: "NOT_FULLY_PAID",
          unpaid: booking.paymentMilestones
            .filter((m) => m.status !== "Received")
            .map((m) => ({ title: m.title, amount: m.amount, status: m.status })),
        });
      }
    }

    const now = new Date();
    booking.status = "Completed";
    booking.completedAt = booking.completedAt || now;
    if (booking.checkedInAt && !booking.teardownCompletedAt) booking.teardownCompletedAt = now;
    appendNote(booking, `Marked completed by Eventory${force ? " (override)" : ""}.`);
    if (!(await saveOr400(res, booking))) return;
    resolveVendorActions(booking.vendorId, booking.bookingId);
    notifyVendor("booking.updatedByEventory", {
      ...contextFromDeal(booking),
      changeSummary: "The Eventory team marked this event completed.",
    });
    return respond(res, booking);
  } catch (error) {
    return serverError(res, "complete booking", error);
  }
};

// ─── Event day, on the vendor's behalf ──────────────────────

// Unlike the vendor's own steps (eventDayController.js) these carry no time
// gates — the team often back-fills a step after the fact — but they keep
// the order: nothing before check-in, teardown only after setup.
const EVENT_DAY_STEPS = {
  "check-in": (booking, at) => {
    if (booking.checkedInAt) return "Already checked in.";
    booking.checkedInAt = at;
  },
  setup: (booking, at, body) => {
    if (!booking.checkedInAt) return "Check in first.";
    if (body.photos) booking.setupPhotos = body.photos;
    booking.setupCompletedAt = at;
    resolveVendorActions(booking.vendorId, booking.bookingId, ["eventDay.setupDueSoon", "eventDay.setupOverdue"]);
  },
  "payment-request": (booking, at) => {
    if (!booking.checkedInAt) return "Check in first.";
    if (isFullyPaid(booking)) return "This booking is already fully paid.";
    booking.paymentRequestedAt = at;
    for (const milestone of booking.paymentMilestones) {
      if (milestone.status === "Received") continue;
      milestone.status = "PaymentDue";
      if (!milestone.dueDate || milestone.dueDate > at) milestone.dueDate = at;
    }
  },
  "payment-defer": (booking, at) => {
    if (!booking.checkedInAt) return "Check in first.";
    booking.paymentDeferredAt = at;
  },
  teardown: (booking, at) => {
    if (!booking.setupCompletedAt) return "Complete setup first.";
    booking.teardownCompletedAt = at;
  },
};

/** @route POST /api/admin/bookings/:bookingId/event-day/:step   body { photos?, at? } */
export const eventDayStep = async (req, res) => {
  try {
    const apply = EVENT_DAY_STEPS[req.params.step];
    if (!apply) return fail(res, 404, `Unknown event-day step "${req.params.step}"`);
    const booking = await loadBooking(req, res);
    if (!booking) return;
    if (!isEventDayValid(booking)) {
      return fail(res, 400, `Event-day actions need a confirmed booking (this one is ${booking.status}).`);
    }
    const at = req.body?.at || new Date();
    const problem = apply(booking, at, req.body || {});
    if (problem) return fail(res, 409, problem);
    appendNote(booking, `Event day: ${req.params.step} recorded by Eventory for the vendor.`);
    if (!(await saveOr400(res, booking))) return;
    return respond(res, booking);
  } catch (error) {
    return serverError(res, "event-day step", error);
  }
};

/** @route PUT /api/admin/bookings/:bookingId/event-day/ground-contact   body { name, phone } */
export const setGroundContact = async (req, res) => {
  try {
    const booking = await loadBooking(req, res);
    if (!booking) return;
    if (!isEventDayValid(booking)) return fail(res, 400, "Ground contact needs a confirmed booking.");
    const phone = normalizePhone(req.body.phone);
    if (!phone) return fail(res, 400, "phone must be a 10-digit Indian mobile number");
    booking.groundStaff = {
      name: req.body.name.trim(),
      phone,
      code: generateGroundCode(),
      assignedAt: new Date(),
    };
    if (!(await saveOr400(res, booking))) return;
    return respond(res, booking);
  } catch (error) {
    return serverError(res, "set ground contact", error);
  }
};

/** @route DELETE /api/admin/bookings/:bookingId/event-day/ground-contact */
export const removeGroundContact = async (req, res) => {
  try {
    const booking = await loadBooking(req, res);
    if (!booking) return;
    booking.groundStaff = null;
    if (!(await saveOr400(res, booking))) return;
    return respond(res, booking);
  } catch (error) {
    return serverError(res, "remove ground contact", error);
  }
};

/**
 * @route POST /api/admin/bookings/:bookingId/day-requests   body { text }
 * The customer asked the team for something during setup — logged on the
 * booking exactly as the customer's own request would be, and the vendor is
 * told. No event-day time gate.
 */
export const addDayRequest = async (req, res) => {
  try {
    const booking = await loadBooking(req, res);
    if (!booking) return;
    if (!isEventDayValid(booking)) return fail(res, 400, "Day requests need a confirmed booking.");
    const now = new Date();
    booking.dayRequests.push({ text: req.body.text, addedAt: now, status: "Pending" });
    if (!(await saveOr400(res, booking))) return;
    notifyVendor("eventDay.dayRequest", { ...contextFromDeal(booking), requestText: req.body.text });
    return respond(res, booking, {}, 201);
  } catch (error) {
    return serverError(res, "add day request", error);
  }
};

/** @route POST /api/admin/bookings/:bookingId/day-requests/:requestId/update   body { message?, photos? } */
export const updateDayRequest = async (req, res) => {
  try {
    const booking = await loadBooking(req, res);
    if (!booking) return;
    const request = mongoose.isValidObjectId(req.params.requestId)
      ? booking.dayRequests.id(req.params.requestId)
      : null;
    if (!request) return fail(res, 404, "Day request not found");
    request.update = {
      message: req.body.message || null,
      photos: req.body.photos || [],
      sentAt: new Date(),
    };
    request.status = "Updated";
    if (!booking.dayRequests.some((r) => r.status === "Pending")) {
      resolveVendorActions(booking.vendorId, booking.bookingId, ["eventDay.dayRequest", "eventDay.requestPending"]);
    }
    if (!(await saveOr400(res, booking))) return;
    return respond(res, booking);
  } catch (error) {
    return serverError(res, "update day request", error);
  }
};

/** @route PUT /api/admin/bookings/:bookingId/issues/:issueId   body { status } */
export const updateIssue = async (req, res) => {
  try {
    const booking = await loadBooking(req, res);
    if (!booking) return;
    const issue = mongoose.isValidObjectId(req.params.issueId) ? booking.issues.id(req.params.issueId) : null;
    if (!issue) return fail(res, 404, "Issue not found");
    issue.status = req.body.status;
    issue.resolvedAt = req.body.status === "Resolved" ? new Date() : null;
    appendNote(booking, `Issue "${issue.category}" marked ${req.body.status} by Eventory.`);
    if (!(await saveOr400(res, booking))) return;
    return respond(res, booking);
  } catch (error) {
    return serverError(res, "update issue", error);
  }
};
