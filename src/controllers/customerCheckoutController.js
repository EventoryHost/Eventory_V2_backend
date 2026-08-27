import mongoose from "mongoose";
import CheckoutSession from "../models/CheckoutSession.js";
import Cart from "../models/Cart.js";
import CartItem from "../models/CartItem.js";
import Package from "../models/Package.js";
import { computeQuoteForLines } from "../services/cartPricingService.js";
import { computeContactValidation, computeLinesValidation } from "../services/checkoutValidationService.js";
import { computeAvailability } from "../utils/packageAvailability.js";
import { resolveVendorRefId } from "../utils/resolveVendor.js";

/**
 * Checkout session — Phase 4 Steps 15-16. A short-lived, price-locked
 * snapshot of what's about to be paid for, built from either the
 * customer's Cart (selected items) or a direct "Book Now" purchase that
 * never touched the cart. See CheckoutSession.js for the model/TTL
 * reasoning. Every route requires protectCustomer — checkout has no guest
 * equivalent (Cart does; checkout is where identity is required, matching
 * the final BRD's phone/contact-detail requirements at this step).
 */

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes — the final BRD's own number (Sections 11 & 19), not a guessed default.

// Validates one package selection (Live status + capacity) and builds a
// CheckoutLine subdocument shape from it — shared by both entry paths
// (cart-sourced and direct "Book Now") so they can never validate
// differently by accident.
async function buildLine({
  packageId,
  sourceCartItemId,
  eventType,
  guests,
  date,
  timeSlot,
  location,
  selectedAddOns,
  selectedItems,
  specialRequest,
  quantity,
}) {
  const pkg = await Package.findOne({ _id: packageId, packageStatus: "Live" });
  if (!pkg) {
    return { error: { status: 404, message: `Package ${packageId} not found or not currently available` } };
  }

  const cap = pkg.step1_eventAndCrew?.capacity || {};
  if (guests !== undefined) {
    const withinCapacity = (cap.minGuests == null || guests >= cap.minGuests) && (cap.maxGuests == null || guests <= cap.maxGuests);
    if (!withinCapacity) {
      return {
        error: {
          status: 400,
          message: `Guest count must be between ${cap.minGuests ?? 0} and ${cap.maxGuests ?? "unlimited"} for "${pkg.step1_eventAndCrew?.packageName}"`,
        },
      };
    }
  }

  // pkg.vendorId is stored as the Vendor's business-id string (e.g.
  // "VEN20260511163553528") rather than its Mongo _id for every currently-
  // seeded package — resolve to the real Vendor._id before writing it into
  // CheckoutSession.lines[].vendorId (a required ObjectId field). See
  // src/utils/resolveVendor.js for the full write-up.
  const resolvedVendorId = await resolveVendorRefId(pkg.vendorId);
  if (!resolvedVendorId) {
    return { error: { status: 500, message: "This package's vendor could not be resolved" } };
  }

  return {
    line: {
      vendorId: resolvedVendorId,
      packageId: pkg._id,
      packageGroupId: pkg.packageGroupId,
      sourceCartItemId: sourceCartItemId || null,
      packageSnapshot: {
        name: pkg.step1_eventAndCrew?.packageName,
        price: pkg.step3_policiesAndCharges?.packagePricing?.price ?? null,
        billingUnit: pkg.step3_policiesAndCharges?.packagePricing?.billingUnit ?? null,
        image: pkg.step4_sampleMedia?.media?.[0]?.url,
        vendorType: pkg.vendorType,
        variantType: pkg.variantType,
      },
      eventDetails: {
        eventType: eventType || null,
        date: date || null,
        timeSlot: timeSlot || null,
        guestCount: guests || null,
        location: location || null,
      },
      selectedAddOns: selectedAddOns || [],
      selectedItems: selectedItems || [],
      specialRequest: specialRequest || "",
      quantity: quantity || 1,
    },
  };
}

// Re-runs computeQuoteForLines against the session's current lines and
// stores the result — called on creation and after every line edit/removal
// ("lock" the price version at that point in time, per Step 15's own
// wording). Also slides expiresAt forward — see CheckoutSession.js for why
// sliding rather than fixed-from-creation.
async function lockQuote(session, discount = 0) {
  const lines = session.lines.map((l) => ({
    lineId: l._id,
    vendorId: l.vendorId,
    packageId: l.packageId,
    quantity: l.quantity,
    selectedAddOns: l.selectedAddOns,
    selectedItems: l.selectedItems,
    eventDetails: l.eventDetails,
    packageSnapshot: l.packageSnapshot,
  }));
  session.lockedQuote = lines.length ? await computeQuoteForLines(lines, discount) : null;
  session.lockedAt = new Date();
  session.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
}

// Live per-line availability — always recomputed fresh on read, unlike the
// locked quote (price), since availability is inherently time-sensitive
// (another customer could book the same slot at any moment) and re-
// checking it costs nothing to keep current. Matches the final BRD's
// "every vendor still available on the chosen date (re-checked at
// Continue)" (Section 10.5).
async function computeLinesAvailability(session) {
  const packageIds = [...new Set(session.lines.map((l) => String(l.packageId)))];
  const packages = await Package.find({ _id: { $in: packageIds } })
    .select("packageStatus vendorId step1_eventAndCrew.capacity availabilityCalendar availabilitySettings bookingCapacity")
    .lean();
  const packageById = new Map(packages.map((p) => [String(p._id), p]));

  const results = await Promise.all(
    session.lines.map(async (line) => {
      const pkg = packageById.get(String(line.packageId));
      if (!pkg || pkg.packageStatus !== "Live") {
        return { lineId: line._id, packageStillAvailable: false, availability: null };
      }
      const availability = await computeAvailability(pkg, {
        date: line.eventDetails?.date || undefined,
        guests: line.eventDetails?.guestCount || undefined,
      });
      return { lineId: line._id, packageStillAvailable: true, availability };
    })
  );

  // Only an explicit false blocks payment-readiness — null (not enough
  // signal) is never treated as a block, same philosophy as everywhere
  // else availability is computed in this codebase.
  const readyForPayment =
    session.status === "Active" &&
    session.lines.length > 0 &&
    results.every((r) => r.packageStillAvailable && r.availability?.overall !== false);

  return { perLine: results, readyForPayment };
}

// computeContactValidation/computeLinesValidation moved to
// src/services/checkoutValidationService.js (Phase 4 Step 18) so the
// payment controller can run the exact same "Validation before Continue"
// checks before letting a customer pay — imported at the top of this file.

function respondWithSession(res, status, session, availabilityResult, customer) {
  const contact = computeContactValidation(session.contactDetails, customer);
  const lines = computeLinesValidation(session.lines);
  const canContinue = session.status === "Active" && availabilityResult.readyForPayment && contact.valid && lines.valid;

  return res.status(status).json({
    status: "SUCCESS",
    session,
    availability: availabilityResult.perLine,
    readyForPayment: availabilityResult.readyForPayment,
    validation: {
      contact,
      lines,
      canContinue,
      note: "Does not check choose-N group completeness — no max_selectable-style field exists on Package to validate against. See info.txt Phase 4 Step 17.",
    },
  });
}

/**
 * @desc Create a checkout session — Phase 4 Step 15. source:"cart" pulls
 * the customer's currently-selected cart items; source:"direct" is a
 * one-off "Book Now" purchase from the PDP that never touched the cart.
 * Either way, every line is re-validated (Live + capacity) and the price is
 * locked via the same pricing engine Cart's quote endpoint uses.
 */
export const createCheckoutSession = async (req, res) => {
  try {
    const { source } = req.body;
    let lines = [];
    let sourceCartId = null;
    let bookingNote = "";
    let discount = 0;

    if (source === "cart") {
      const cart = await Cart.findOne({ customerId: req.customer._id });
      const cartItems = cart ? await CartItem.find({ cartId: cart._id, selectedForCheckout: true }) : [];
      if (cartItems.length === 0) {
        return res.status(400).json({ status: "FAILED", message: "Your cart has no selected items to check out" });
      }

      for (const item of cartItems) {
        const built = await buildLine({
          packageId: item.packageId,
          sourceCartItemId: item._id,
          eventType: item.eventDetails?.eventType || undefined,
          guests: item.eventDetails?.guestCount || undefined,
          date: item.eventDetails?.date || undefined,
          timeSlot: item.eventDetails?.timeSlot || undefined,
          location: item.eventDetails?.location || undefined,
          selectedAddOns: item.selectedAddOns,
          selectedItems: item.selectedItems,
          specialRequest: item.specialRequest,
          quantity: item.quantity,
        });
        if (built.error) return res.status(built.error.status).json({ status: "FAILED", message: built.error.message });
        lines.push(built.line);
      }
      sourceCartId = cart._id;
      bookingNote = cart.bookingNote || "";
      // Carried over from the cart's own coupon slot — still always 0 today
      // per Step 13's honest placeholder (no Coupon/Offer model exists
      // yet), but wired through so it starts working the moment that does.
      discount = cart.coupon?.discountAmount || 0;
    } else {
      const { packageId, eventType, guests, date, timeSlot, location, selectedAddOns, selectedItems, specialRequest, quantity } = req.body;
      const built = await buildLine({
        packageId,
        eventType,
        guests,
        date,
        timeSlot,
        location,
        selectedAddOns,
        selectedItems,
        specialRequest,
        quantity,
      });
      if (built.error) return res.status(built.error.status).json({ status: "FAILED", message: built.error.message });
      lines.push(built.line);
    }

    // Pre-fill contact details from the customer's own profile — "capture/
    // edit" starts from "edit" when there's already something on file,
    // rather than a blank form every time.
    const contactDetails = {
      name: req.customer.name || null,
      phone: req.customer.phone || null,
      email: req.customer.email || null,
    };

    const session = new CheckoutSession({
      customerId: req.customer._id,
      source,
      sourceCartId,
      lines,
      bookingNote,
      contactDetails,
      status: "Active",
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    await lockQuote(session, discount);
    await session.save();

    const availabilityResult = await computeLinesAvailability(session);
    return respondWithSession(res, 201, session, availabilityResult, req.customer);
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to create checkout session", error: error.message });
  }
};

// Shared ownership + expiry + status resolution for every /:sessionId route.
async function resolveSession(req, { requireActive } = {}) {
  const { sessionId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(sessionId)) return { error: { status: 400, message: "Invalid sessionId" } };

  const session = await CheckoutSession.findOne({ _id: sessionId, customerId: req.customer._id });
  if (!session) return { error: { status: 404, message: "Checkout session not found" } };

  // TTL will eventually physically delete this document, but the sweep
  // isn't instant — check the deadline in application code too so an
  // about-to-expire session never silently accepts a mutation.
  if (session.status === "Active" && session.expiresAt < new Date()) {
    session.status = "Expired";
    await session.save();
  }

  if (requireActive && session.status !== "Active") {
    return { error: { status: 410, message: `This checkout session is ${session.status.toLowerCase()} — start a new one` } };
  }

  return { session };
}

/**
 * @desc Get a checkout session — Phase 4 Step 16 (booking breakdown view).
 * Returns the LOCKED quote (what will actually be charged) alongside a
 * freshly-recomputed per-line availability check.
 */
export const getCheckoutSession = async (req, res) => {
  try {
    const resolved = await resolveSession(req);
    if (resolved.error) return res.status(resolved.error.status).json({ status: "FAILED", message: resolved.error.message });

    const availabilityResult = await computeLinesAvailability(resolved.session);
    return respondWithSession(res, 200, resolved.session, availabilityResult, req.customer);
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to fetch checkout session", error: error.message });
  }
};

/**
 * @desc Edit one line pre-payment — event details, add-ons, choose-N
 * selections, special request, quantity, or switch to a sibling VARIANT of
 * the same logical package (packageId, validated against packageGroupId —
 * this is not a way to swap to an unrelated package). Re-locks the quote
 * for the whole session afterward, since one line changing can affect
 * nothing else's total but the session's overall numbers still need
 * refreshing, and slides the 30-minute expiry forward.
 */
export const updateCheckoutLine = async (req, res) => {
  try {
    const resolved = await resolveSession(req, { requireActive: true });
    if (resolved.error) return res.status(resolved.error.status).json({ status: "FAILED", message: resolved.error.message });
    const { session } = resolved;

    const line = session.lines.id(req.params.lineId);
    if (!line) return res.status(404).json({ status: "FAILED", message: "Line not found in this checkout session" });

    const { packageId, eventType, guests, date, timeSlot, location, selectedAddOns, selectedItems, specialRequest, quantity } = req.body;

    if (packageId && packageId !== String(line.packageId)) {
      const newPkg = await Package.findOne({ _id: packageId, packageStatus: "Live" });
      if (!newPkg) return res.status(404).json({ status: "FAILED", message: "Target package not found or not currently available" });
      if (String(newPkg.packageGroupId) !== String(line.packageGroupId)) {
        return res.status(400).json({
          status: "FAILED",
          message: "packageId must be a variant of the same package (matching packageGroupId) — use Cart to add a different package entirely",
        });
      }
      line.packageId = newPkg._id;
      line.vendorId = newPkg.vendorId;
      line.packageSnapshot = {
        name: newPkg.step1_eventAndCrew?.packageName,
        price: newPkg.step3_policiesAndCharges?.packagePricing?.price ?? null,
        billingUnit: newPkg.step3_policiesAndCharges?.packagePricing?.billingUnit ?? null,
        image: newPkg.step4_sampleMedia?.media?.[0]?.url,
        vendorType: newPkg.vendorType,
        variantType: newPkg.variantType,
      };
    }

    if (guests !== undefined) {
      // Re-validate capacity against whichever package is active on this
      // line now (possibly just switched above).
      const activePkg = await Package.findById(line.packageId).select("step1_eventAndCrew.capacity step1_eventAndCrew.packageName");
      const cap = activePkg?.step1_eventAndCrew?.capacity || {};
      const withinCapacity = (cap.minGuests == null || guests >= cap.minGuests) && (cap.maxGuests == null || guests <= cap.maxGuests);
      if (!withinCapacity) {
        return res.status(400).json({
          status: "FAILED",
          message: `Guest count must be between ${cap.minGuests ?? 0} and ${cap.maxGuests ?? "unlimited"}`,
        });
      }
      line.eventDetails.guestCount = guests;
    }
    if (eventType !== undefined) line.eventDetails.eventType = eventType;
    if (date !== undefined) line.eventDetails.date = date;
    if (timeSlot !== undefined) line.eventDetails.timeSlot = timeSlot;
    if (location !== undefined) line.eventDetails.location = location;
    if (selectedAddOns !== undefined) line.selectedAddOns = selectedAddOns;
    if (selectedItems !== undefined) line.selectedItems = selectedItems;
    if (specialRequest !== undefined) line.specialRequest = specialRequest;
    if (quantity !== undefined) line.quantity = quantity;

    await lockQuote(session, session.lockedQuote?.discount || 0);
    await session.save();

    const availabilityResult = await computeLinesAvailability(session);
    return respondWithSession(res, 200, session, availabilityResult, req.customer);
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to update checkout line", error: error.message });
  }
};

/**
 * @desc Remove one line pre-payment (e.g. a vendor turned out to be
 * unavailable). Cancels the whole session if it was the last line.
 */
export const removeCheckoutLine = async (req, res) => {
  try {
    const resolved = await resolveSession(req, { requireActive: true });
    if (resolved.error) return res.status(resolved.error.status).json({ status: "FAILED", message: resolved.error.message });
    const { session } = resolved;

    const line = session.lines.id(req.params.lineId);
    if (!line) return res.status(404).json({ status: "FAILED", message: "Line not found in this checkout session" });

    line.deleteOne();

    if (session.lines.length === 0) {
      session.status = "Cancelled";
      session.lockedQuote = null;
      await session.save();
      return res.status(200).json({ status: "SUCCESS", message: "Last line removed — checkout session cancelled", session });
    }

    await lockQuote(session, session.lockedQuote?.discount || 0);
    await session.save();

    const availabilityResult = await computeLinesAvailability(session);
    return respondWithSession(res, 200, session, availabilityResult, req.customer);
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to remove checkout line", error: error.message });
  }
};

/**
 * @desc Explicitly cancel a checkout session (e.g. customer backs out).
 * Soft-cancel (status change), not a delete — kept for the same reason
 * nothing else in this codebase hard-deletes transactional-ish records.
 */
export const cancelCheckoutSession = async (req, res) => {
  try {
    const resolved = await resolveSession(req);
    if (resolved.error) return res.status(resolved.error.status).json({ status: "FAILED", message: resolved.error.message });

    resolved.session.status = "Cancelled";
    await resolved.session.save();
    return res.status(200).json({ status: "SUCCESS", message: "Checkout session cancelled", session: resolved.session });
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to cancel checkout session", error: error.message });
  }
};

/**
 * @desc Capture/edit contact details — Phase 4 Step 17. Only the fields
 * sent are touched. Setting a phone here does NOT verify it — verification
 * still only happens through the existing Phase 0 OTP flow
 * (POST /api/customer/phone/send-otp + /verify-otp), which is what
 * actually updates Customer.phone/isPhoneVerified. `validation.contact` in
 * the response reflects the CURRENT verified state live, so re-checking
 * this endpoint after verifying elsewhere shows the up-to-date result
 * without needing to PATCH again.
 */
export const updateContactDetails = async (req, res) => {
  try {
    const resolved = await resolveSession(req, { requireActive: true });
    if (resolved.error) return res.status(resolved.error.status).json({ status: "FAILED", message: resolved.error.message });
    const { session } = resolved;

    const { name, phone, email } = req.body;
    if (name !== undefined) session.contactDetails.name = name;
    if (phone !== undefined) session.contactDetails.phone = phone;
    if (email !== undefined) session.contactDetails.email = email;
    await session.save();

    const availabilityResult = await computeLinesAvailability(session);
    return respondWithSession(res, 200, session, availabilityResult, req.customer);
  } catch (error) {
    return res.status(500).json({ status: "ERROR", message: "Failed to update contact details", error: error.message });
  }
};
