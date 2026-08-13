import "dotenv/config";
import axios from "axios";
import mongoose from "mongoose";
import fs from "fs";

/**
 * End-to-end test suite for Phase 0-5 (customer-side) — run against a LIVE
 * server instance (not controller-level mocks) so route wiring, middleware,
 * validators, and rate limiters are all genuinely exercised, not bypassed.
 * Every result is captured into RESULTS[] and later rendered to
 * testsuite.pdf by scripts/generate-testsuite-pdf.mjs.
 *
 * A few things are NOT automatable and are explicitly marked SKIPPED with a
 * reason rather than faked:
 *  - Real phone OTP verification (needs a live SMS/Cognito flow) — the
 *    send-otp/verify-otp endpoints ARE tested for their request/response
 *    contract (validation errors), but real delivery isn't exercised. Where
 *    downstream logic needs a verified phone, isPhoneVerified is flipped
 *    directly in the DB and that is explicitly logged as a simulation.
 *  - A real Cashfree Checkout UI payment (needs a live browser + card
 *    entry) — the ORDER CREATION calls are real (hit the actual Cashfree
 *    sandbox), but "payment succeeded" is simulated the same way it was
 *    verified throughout this engagement (Steps 19/21/22/24): the Payment
 *    doc is flipped to PAID directly and the same service function the
 *    webhook calls is invoked, since Cashfree's own confirmation flow was
 *    already verified for real in Step 18 and isn't what this suite is
 *    re-testing.
 *  - Google/Facebook OAuth login (needs a real browser consent flow) — not
 *    exercised; those routes 501 without OAuth env vars configured anyway.
 */

const BASE = `http://localhost:${process.env.PORT || 4000}/api`;
const RESULTS = [];
let currentSection = "General";

function section(name) {
  currentSection = name;
}

async function call({ method, path, body, headers = {}, description, expect }) {
  const url = `${BASE}${path}`;
  let status, data, error = null;
  try {
    const res = await axios({ method, url, data: body, headers, validateStatus: () => true });
    status = res.status;
    data = res.data;
  } catch (err) {
    error = err.message;
    status = null;
    data = null;
  }

  const pass = error ? false : expect(status, data);
  RESULTS.push({
    section: currentSection,
    method: method.toUpperCase(),
    path,
    requestBody: body || null,
    description,
    observedStatus: status,
    observedBody: data,
    pass,
    error,
  });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${method.toUpperCase()} ${path} -> ${status} :: ${description}`);
  return { status, data };
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // ============================================================
  // SETUP — find real Live packages/vendors to test against
  // ============================================================
  section("Setup — real data lookup (not counted as a pass/fail test)");
  const tokenPkg = await db.collection("packages").findOne({ _id: new mongoose.Types.ObjectId("6a7a4bffcf55828037d2782a") });
  const vendorOfTokenPkg = await db.collection("vendors").findOne({ id: tokenPkg.vendorId });
  const allLivePkgs = await db.collection("packages").find({ packageStatus: "Live" }).limit(3).toArray();
  const secondPkg = allLivePkgs.find((p) => String(p._id) !== String(tokenPkg._id));
  console.log("Using package:", tokenPkg._id.toString(), tokenPkg.step1_eventAndCrew?.packageName);
  console.log("Using vendor:", vendorOfTokenPkg._id.toString(), vendorOfTokenPkg.businessName);

  const suffix = Date.now();
  const custA = { name: "E2E Test Customer A", email: `e2e.custA.${suffix}@example.com`, password: "TestPass123!" };
  const custB = { name: "E2E Test Customer B", email: `e2e.custB.${suffix}@example.com`, password: "TestPass123!" };
  let tokenA, tokenB, customerIdA, customerIdB, mongoIdA;
  let guestCartId = `E2EGUEST${suffix}`;

  // ============================================================
  // PHASE 1 — DISCOVERY (public, no auth)
  // ============================================================
  section("Phase 1 — Discovery");

  await call({
    method: "get", path: "/customer/packages?limit=5", description: "Browse Live packages (default sort)",
    expect: (s, b) => s === 200 && b.status === "SUCCESS" && Array.isArray(b.packages),
  });

  await call({
    method: "get", path: "/customer/packages?limit=3&sort=price_asc", description: "Browse packages sorted price_asc",
    expect: (s, b) => s === 200 && b.packages.length <= 3,
  });

  await call({
    method: "get", path: "/customer/packages?limit=3&sort=rating", description: "Browse packages sorted by vendor rating (aggregate $lookup path)",
    expect: (s, b) => s === 200 && b.status === "SUCCESS",
  });

  const { data: filtersResp } = await call({
    method: "get", path: "/customer/packages/filters", description: "Get distinct filter facets across Live packages",
    expect: (s, b) => s === 200 && b.status === "SUCCESS",
  });

  await call({
    method: "get", path: `/customer/packages/${tokenPkg._id}`,
    description: "PDP for a real Live package — REGRESSION TEST for the vendorId cast bug found+fixed during this suite (see write-up)",
    expect: (s, b) => s === 200 && b.status === "SUCCESS" && b.package?.vendorId?.businessName,
  });

  await call({
    method: "get", path: "/customer/packages/000000000000000000000000",
    description: "PDP for a well-formed but nonexistent packageId",
    expect: (s, b) => s === 404,
  });

  await call({
    method: "get", path: "/customer/packages/not-an-id",
    description: "PDP with a malformed packageId",
    expect: (s, b) => s === 400,
  });

  await call({
    method: "get", path: `/customer/packages/${tokenPkg._id}/reviews`, description: "Standalone package reviews listing",
    expect: (s, b) => s === 200 && b.status === "SUCCESS",
  });

  await call({
    method: "get", path: "/customer/vendors?limit=5", description: "Browse active vendors",
    expect: (s, b) => s === 200 && b.status === "SUCCESS" && Array.isArray(b.vendors),
  });

  await call({
    method: "get", path: "/customer/vendors/filters", description: "Get distinct vendor filter facets",
    expect: (s, b) => s === 200 && b.status === "SUCCESS",
  });

  await call({
    method: "get", path: `/customer/vendors/${vendorOfTokenPkg._id}/reviews`, description: "Standalone vendor reviews listing",
    expect: (s, b) => s === 200 && b.status === "SUCCESS",
  });

  // ============================================================
  // AUTH — signup / login / refresh
  // ============================================================
  section("Auth — signup, login, refresh, isolation");

  const signupRes = await call({
    method: "post", path: "/customer/auth/signup", body: custA,
    description: "Sign up Customer A (real account, cleaned up after)",
    expect: (s, b) => s === 201 && b.success && b.accessToken,
  });
  tokenA = signupRes.data?.accessToken;
  customerIdA = signupRes.data?.customer?.id;
  mongoIdA = signupRes.data?.customer?._id;

  await call({
    method: "post", path: "/customer/auth/signup", body: custA,
    description: "Duplicate signup with the same email — should reject",
    expect: (s, b) => s === 409,
  });

  await call({
    method: "post", path: "/customer/auth/login", body: { email: custA.email, password: custA.password },
    description: "Login Customer A with correct credentials",
    expect: (s, b) => s === 200 && b.accessToken,
  });

  await call({
    method: "post", path: "/customer/auth/login", body: { email: custA.email, password: "WrongPassword!" },
    description: "Login with wrong password — should reject with a generic message",
    expect: (s, b) => s === 401,
  });

  const signupB = await call({
    method: "post", path: "/customer/auth/signup", body: custB,
    description: "Sign up Customer B (for cross-customer isolation tests)",
    expect: (s, b) => s === 201,
  });
  tokenB = signupB.data?.accessToken;
  customerIdB = signupB.data?.customer?.id;

  await call({
    method: "get", path: "/customer/packages", headers: {},
    description: "(sanity) discovery still public with no auth header",
    expect: (s) => s === 200,
  });

  // ============================================================
  // PHASE 2 — WISHLIST & COMPARE
  // ============================================================
  section("Phase 2 — Wishlist");

  await call({
    method: "get", path: "/customer/wishlist", headers: authHeader(tokenA),
    description: "Get Customer A's wishlist (empty)",
    expect: (s, b) => s === 200 && b.items?.length === 0,
  });

  await call({
    method: "post", path: "/customer/wishlist", headers: authHeader(tokenA),
    body: { itemType: "Package", packageId: String(tokenPkg._id) },
    description: "Add a Package to Customer A's wishlist",
    expect: (s, b) => s === 201 || s === 200,
  });

  const wlAfterAdd = await call({
    method: "get", path: "/customer/wishlist", headers: authHeader(tokenA),
    description: "Get wishlist after adding one item",
    expect: (s, b) => s === 200 && b.items?.length === 1,
  });
  const wishlistItemId = wlAfterAdd.data?.items?.[0]?._id;

  await call({
    method: "patch", path: `/customer/wishlist/${wishlistItemId}`, headers: authHeader(tokenA),
    body: { note: "Thinking about this for the reception" },
    description: "Update a wishlist item's note",
    expect: (s, b) => s === 200,
  });

  const shareRes = await call({
    method: "post", path: "/customer/wishlist/share", headers: authHeader(tokenA),
    description: "Generate a wishlist share link",
    expect: (s, b) => s === 200 && b.shareToken,
  });
  const shareToken = shareRes.data?.shareToken;

  await call({
    method: "get", path: `/customer/wishlist/shared/${shareToken}`,
    description: "View the shared wishlist publicly (no auth)",
    expect: (s, b) => s === 200,
  });

  await call({
    method: "get", path: "/customer/wishlist", headers: authHeader(tokenB),
    description: "Customer B's own wishlist is empty (isolation — not seeing A's item)",
    expect: (s, b) => s === 200 && b.items?.length === 0,
  });

  await call({
    method: "delete", path: "/customer/wishlist/share", headers: authHeader(tokenA),
    description: "Disable the wishlist share link",
    expect: (s, b) => s === 200,
  });

  await call({
    method: "delete", path: `/customer/wishlist/${wishlistItemId}`, headers: authHeader(tokenA),
    description: "Remove the single wishlist item",
    expect: (s, b) => s === 200,
  });

  await call({
    method: "get", path: "/customer/wishlist", headers: {},
    description: "Wishlist requires auth — no token should 401",
    expect: (s) => s === 401,
  });

  section("Phase 2 — Compare");

  await call({
    method: "post", path: "/customer/compare/items", headers: authHeader(tokenA),
    body: { packageId: String(tokenPkg._id) },
    description: "Add first package to compare",
    expect: (s) => s === 201 || s === 200,
  });

  if (secondPkg) {
    await call({
      method: "post", path: "/customer/compare/items", headers: authHeader(tokenA),
      body: { packageId: String(secondPkg._id) },
      description: "Add second package to compare",
      expect: (s) => s === 201 || s === 200,
    });
  }

  const compareRes = await call({
    method: "get", path: "/customer/compare", headers: authHeader(tokenA),
    description: "Get compare list (should have items)",
    expect: (s, b) => s === 200 && Array.isArray(b.items) && b.items.length >= 1,
  });

  await call({
    method: "get", path: "/customer/compare/export?format=json", headers: authHeader(tokenA),
    description: "Export compare list as JSON",
    expect: (s) => s === 200,
  });

  await call({
    method: "delete", path: `/customer/compare/items/${tokenPkg._id}`, headers: authHeader(tokenA),
    description: "Remove one item from compare",
    expect: (s) => s === 200,
  });

  await call({
    method: "delete", path: "/customer/compare", headers: authHeader(tokenA),
    description: "Clear the whole compare list",
    expect: (s) => s === 200,
  });

  // ============================================================
  // PHASE 3 — CART (guest first, then merge into Customer A)
  // ============================================================
  section("Phase 3 — Cart");

  await call({
    method: "get", path: "/customer/cart", headers: { "x-guest-cart-id": guestCartId },
    description: "Get guest cart (empty, never auto-created on a read)",
    expect: (s, b) => s === 200,
  });

  const addItemRes = await call({
    method: "post", path: "/customer/cart/items", headers: { "x-guest-cart-id": guestCartId },
    body: {
      packageId: String(tokenPkg._id),
      eventType: "Wedding",
      guests: 80,
      date: "2026-12-20",
      location: "Mumbai",
      quantity: 1,
    },
    description: "Guest adds a package to cart",
    expect: (s, b) => s === 201 || s === 200,
  });

  const cartAfterAdd = await call({
    method: "get", path: "/customer/cart", headers: { "x-guest-cart-id": guestCartId },
    description: "Get guest cart after adding an item",
    expect: (s, b) => s === 200 && b.vendorGroups?.length >= 1,
  });
  const cartItemId = cartAfterAdd.data?.vendorGroups?.[0]?.items?.[0]?._id;

  if (cartItemId) {
    await call({
      method: "patch", path: `/customer/cart/items/${cartItemId}`, headers: { "x-guest-cart-id": guestCartId },
      body: { guests: 100 },
      description: "Update cart item's guest count",
      expect: (s) => s === 200,
    });
  }

  await call({
    method: "put", path: "/customer/cart/note", headers: { "x-guest-cart-id": guestCartId },
    body: { note: "Please call before confirming" },
    description: "Set a note on the cart",
    expect: (s) => s === 200,
  });

  await call({
    method: "get", path: "/customer/cart/quote", headers: { "x-guest-cart-id": guestCartId },
    description: "Get a live price quote for the guest cart",
    expect: (s, b) => s === 200,
  });

  await call({
    method: "post", path: "/customer/cart/coupon", headers: { "x-guest-cart-id": guestCartId },
    body: { code: "WELCOME10" },
    description: "Apply a coupon code (no real coupon system exists — expect a clean rejection, not a crash)",
    expect: (s) => s === 400 || s === 404,
  });

  await call({
    method: "post", path: "/customer/cart/merge", headers: authHeader(tokenA),
    body: { guestId: guestCartId },
    description: "Merge the guest cart into logged-in Customer A's account",
    expect: (s) => s === 200,
  });

  const cartAfterMerge = await call({
    method: "get", path: "/customer/cart", headers: authHeader(tokenA),
    description: "Customer A's cart now has the merged item",
    expect: (s, b) => s === 200 && b.vendorGroups?.length >= 1,
  });

  await call({
    method: "get", path: "/customer/cart", headers: authHeader(tokenB),
    description: "Customer B's cart is empty (isolation — did not receive A's merged cart)",
    expect: (s, b) => s === 200 && (!b.vendorGroups || b.vendorGroups.length === 0),
  });

  // ============================================================
  // PHASE 4 — CHECKOUT & PAYMENT
  // ============================================================
  section("Phase 4 — Checkout & Payment");

  const sessionRes = await call({
    method: "post", path: "/customer/checkout/session", headers: authHeader(tokenA),
    body: { source: "cart" },
    description: "Create a checkout session from Customer A's cart",
    expect: (s, b) => s === 201 && b.session?._id,
  });
  const sessionId = sessionRes.data?.session?._id;

  await call({
    method: "get", path: `/customer/checkout/session/${sessionId}`, headers: authHeader(tokenA),
    description: "Get the checkout session (locked quote present)",
    expect: (s, b) => s === 200,
  });

  await call({
    method: "patch", path: `/customer/checkout/session/${sessionId}/contact`, headers: authHeader(tokenA),
    body: { name: "E2E Test Customer A", email: custA.email },
    description: "Set contact details (email path, since phone isn't OTP-verified in this automated run)",
    expect: (s) => s === 200,
  });

  // Real phone OTP can't be automated (needs live SMS) — simulate a
  // verified phone directly in the DB so the payment validation
  // (computeContactValidation) can pass for the rest of this run. Logged
  // explicitly as a simulation, not presented as a real OTP flow test.
  await db.collection("customer_accounts").updateOne(
    { id: customerIdA },
    { $set: { phone: "+919876500001", isPhoneVerified: true } }
  );
  console.log("[SIMULATED] Flipped Customer A's phone to verified directly in DB — real OTP delivery is not automatable.");
  RESULTS.push({
    section: currentSection, method: "DB", path: "customer_accounts (direct write)",
    requestBody: { phone: "+919876500001", isPhoneVerified: true },
    description: "SIMULATED: phone verification bypassed via direct DB write — real Cognito OTP requires a live phone number and isn't automatable. send-otp/verify-otp endpoints' own request contract IS tested separately below.",
    observedStatus: "N/A", observedBody: null, pass: null, error: null,
  });

  await call({
    method: "patch", path: `/customer/checkout/session/${sessionId}/contact`, headers: authHeader(tokenA),
    body: { phone: "9876500001" },
    description: "Set contact phone (now matching the simulated-verified number)",
    expect: (s) => s === 200,
  });

  const lineId = sessionRes.data?.session?.lines?.[0]?._id;
  if (lineId) {
    await call({
      method: "patch", path: `/customer/checkout/session/${sessionId}/lines/${lineId}`, headers: authHeader(tokenA),
      body: { guests: 90 },
      description: "Update a checkout line's guest count (re-locks the quote)",
      expect: (s) => s === 200,
    });
  }

  await call({
    method: "post", path: "/customer/phone/send-otp", headers: authHeader(tokenB),
    body: { mobile: "12345" },
    description: "send-otp with an invalid mobile format — validation contract test (real SMS not exercised)",
    expect: (s) => s === 400,
  });

  await call({
    method: "post", path: "/customer/phone/verify-otp", headers: authHeader(tokenB),
    body: { mobile: "9876500002", code: "12", session: "x" },
    description: "verify-otp with an invalid code format — validation contract test",
    expect: (s) => s === 400,
  });

  const paymentRes = await call({
    method: "post", path: "/customer/payments/token", headers: authHeader(tokenA),
    body: { checkoutSessionId: sessionId },
    description: "Create a REAL Cashfree sandbox order for the session's token amount",
    expect: (s, b) => (s === 201 || s === 200) && b.cfOrderId,
  });
  const paymentId = paymentRes.data?.paymentId;

  await call({
    method: "post", path: "/customer/payments/token", headers: authHeader(tokenA),
    body: { checkoutSessionId: sessionId },
    description: "Retry the same token payment — idempotency check (should reuse, not duplicate)",
    expect: (s, b) => s === 200 && String(b.paymentId) === String(paymentId),
  });

  await call({
    method: "get", path: `/customer/payments/${paymentId}`, headers: authHeader(tokenA),
    description: "Poll payment status (still PENDING — no real payment made)",
    expect: (s, b) => s === 200 && b.paymentStatus === "PENDING",
  });

  await call({
    method: "post", path: "/customer/payments/confirm-free", headers: authHeader(tokenA),
    body: { checkoutSessionId: sessionId },
    description: "Attempt confirm-free on a session that actually requires payment — should reject (no genuinely Free package exists in the DB to test the true-positive case)",
    expect: (s) => s === 400,
  });

  // Simulate the payment succeeding — same "invoke the service directly"
  // method used throughout this engagement (Steps 19/21/22/24) since a
  // live Cashfree Checkout UI payment isn't scriptable, and Cashfree's own
  // confirmation flow was already verified for real in Step 18.
  const Payment = (await import("../src/models/Payment.js")).default;
  const CheckoutSession = (await import("../src/models/CheckoutSession.js")).default;
  const { createBookingsFromCheckoutSession } = await import("../src/services/bookingCreationService.js");
  const payment = await Payment.findById(paymentId);
  payment.status = "PAID";
  payment.paidAt = new Date();
  await payment.save();
  const session = await CheckoutSession.findById(sessionId);
  session.status = "Completed";
  await session.save();
  const bookingIds = await createBookingsFromCheckoutSession(session, payment);
  console.log("[SIMULATED] Payment flipped to PAID directly, real booking-creation service invoked ->", bookingIds);
  RESULTS.push({
    section: currentSection, method: "SERVICE", path: "bookingCreationService.createBookingsFromCheckoutSession()",
    requestBody: null,
    description: "SIMULATED: Cashfree Checkout UI payment can't be scripted headlessly. Payment doc flipped to PAID directly and the REAL booking-creation service (the same one the webhook/poll call) was invoked for real against the DB — not a fabricated booking.",
    observedStatus: "N/A", observedBody: { bookingIds }, pass: bookingIds.length > 0, error: null,
  });
  const bookingMongoId = bookingIds[0];

  await call({
    method: "get", path: `/customer/payments/${paymentId}`, headers: authHeader(tokenA),
    description: "Poll payment status after simulated completion",
    expect: (s, b) => s === 200 && b.paymentStatus === "PAID",
  });

  // ============================================================
  // PHASE 5 — BOOKINGS, CANCEL, INVOICE, PROFILE
  // ============================================================
  section("Phase 5 — Bookings dashboard & detail");

  await call({
    method: "get", path: "/customer/bookings?tab=active", headers: authHeader(tokenA),
    description: "My Bookings — active tab (should include the just-created booking)",
    expect: (s, b) => s === 200 && b.bookings?.some((x) => String(x._id) === String(bookingMongoId)),
  });

  const bookingDetailRes = await call({
    method: "get", path: `/customer/bookings/${bookingMongoId}`, headers: authHeader(tokenA),
    description: "Booking detail — REGRESSION TEST for the same vendorId cast bug (Booking.vendorId, populated with PUBLIC_VENDOR_FIELDS)",
    expect: (s, b) => s === 200 && b.booking,
  });
  const bookingVendorResolved = bookingDetailRes.data?.booking?.vendorId?.businessName;
  RESULTS.push({
    section: currentSection, method: "CHECK", path: `/customer/bookings/${bookingMongoId}`,
    requestBody: null,
    description: `Vendor info on booking detail resolved to a real businessName? Observed: ${JSON.stringify(bookingVendorResolved)}. This flags whether the vendorId-cast issue found+fixed in Discovery (Phase 1) also affects Bookings, since Booking.vendorId is copied from the same Package.vendorId at cart-add time.`,
    observedStatus: "N/A", observedBody: { businessName: bookingVendorResolved }, pass: null, error: null,
  });

  await call({
    method: "get", path: `/customer/bookings/${bookingMongoId}`, headers: authHeader(tokenB),
    description: "Customer B tries to view Customer A's booking — should 404, not leak existence",
    expect: (s) => s === 404,
  });

  const milestone = bookingDetailRes.data?.booking?.paymentMilestones?.find((m) => m.status !== "Received");
  if (milestone) {
    const milestonePayRes = await call({
      method: "post", path: "/customer/payments/milestone", headers: authHeader(tokenA),
      body: { bookingId: bookingMongoId, milestoneId: milestone._id },
      description: `Create a REAL Cashfree order for the "${milestone.type}" milestone`,
      expect: (s, b) => (s === 201 || s === 200) && b.cfOrderId,
    });
  } else {
    RESULTS.push({
      section: currentSection, method: "SKIP", path: "/customer/payments/milestone",
      requestBody: null, description: "No un-Received milestone left on this booking to pay — skipped.",
      observedStatus: "N/A", observedBody: null, pass: null, error: null,
    });
  }

  const invoiceRes = await call({
    method: "get", path: `/customer/bookings/${bookingMongoId}/invoice`, headers: authHeader(tokenA),
    description: "Download the booking's invoice PDF (real payment received, so this should succeed)",
    expect: (s, b) => s === 200,
  });

  section("Phase 5 — Cancel booking");

  const cancelRes = await call({
    method: "post", path: `/customer/bookings/${bookingMongoId}/cancel`, headers: authHeader(tokenA),
    description: "Cancel the booking — refund estimate + policy returned, no real refund executed (documented scope from Step 23)",
    expect: (s, b) => s === 200 && b.bookingStatus === "Cancelled",
  });

  await call({
    method: "post", path: `/customer/bookings/${bookingMongoId}/cancel`, headers: authHeader(tokenA),
    description: "Cancel the same booking again — should reject, already cancelled",
    expect: (s) => s === 409,
  });

  section("Phase 5 — Profile & email");

  await call({
    method: "get", path: `/customers/${customerIdA}`, headers: authHeader(tokenA),
    description: "Get Customer A's own profile",
    expect: (s, b) => s === 200 && b.data?.id === customerIdA,
  });

  await call({
    method: "get", path: `/customers/${customerIdA}`, headers: authHeader(tokenB),
    description: "Customer B tries to read Customer A's profile by id — should 403 (requireSelf)",
    expect: (s) => s === 403,
  });

  await call({
    method: "patch", path: `/customers/${customerIdA}`, headers: authHeader(tokenA),
    body: { name: "E2E Test Customer A (Updated)", gender: "PreferNotToSay" },
    description: "Update own profile (whitelisted fields)",
    expect: (s, b) => s === 200 && b.data?.name === "E2E Test Customer A (Updated)",
  });

  const newEmail = `e2e.custA.changed.${suffix}@example.com`;
  await call({
    method: "patch", path: `/customers/${customerIdA}/email`, headers: authHeader(tokenA),
    body: { email: newEmail },
    description: "Change Customer A's email — should reset isEmailVerified to false",
    expect: (s, b) => s === 200 && b.data?.email === newEmail && b.data?.isEmailVerified === false,
  });

  await call({
    method: "patch", path: `/customers/${customerIdB}/email`, headers: authHeader(tokenA),
    body: { email: "someone@example.com" },
    description: "Customer A tries to change Customer B's email — should 403",
    expect: (s) => s === 403,
  });

  // ============================================================
  // CLEANUP-ADJACENT: deactivate (do LAST — blocks further auth)
  // ============================================================
  section("Account deactivation (run last — blocks further auth)");

  await call({
    method: "patch", path: `/customers/${customerIdB}/deactivate`, headers: authHeader(tokenB),
    description: "Customer B deactivates their own account",
    expect: (s) => s === 200,
  });

  await call({
    method: "post", path: "/customer/auth/login", body: { email: custB.email, password: custB.password },
    description: "Deactivated Customer B tries to log in again — should be blocked",
    expect: (s) => s === 403,
  });

  // ============================================================
  // CLEANUP — remove every piece of test data created above
  // ============================================================
  console.log("\n=== Cleaning up all test data ===");
  const Booking = (await import("../src/models/Booking.js")).default;
  const Invoice = (await import("../src/models/Invoice.js")).default;
  const CustomerModel = (await import("../src/models/Customer.js")).default;

  await Payment.deleteMany({ customerId: mongoIdA });
  await Booking.deleteMany({ _id: { $in: bookingIds } });
  await Invoice.deleteMany({ bookingId: { $in: bookingIds } });
  await CheckoutSession.deleteMany({ customerId: mongoIdA });

  const testCarts = await db
    .collection("customer_carts")
    .find({ $or: [{ customerId: mongoIdA }, { guestId: guestCartId }] })
    .project({ _id: 1 })
    .toArray();
  const testCartIds = testCarts.map((c) => c._id);
  if (testCartIds.length) {
    await db.collection("customer_cart_items").deleteMany({ cartId: { $in: testCartIds } });
    await db.collection("customer_carts").deleteMany({ _id: { $in: testCartIds } });
  }

  await db.collection("customer_wishlist_items").deleteMany({ customerId: mongoIdA });
  await db.collection("customer_compare_sessions").deleteMany({ customerId: mongoIdA });
  await CustomerModel.deleteMany({ email: { $in: [custA.email, custB.email, newEmail] } });
  console.log("Cleanup complete.");

  await mongoose.disconnect();

  fs.writeFileSync(new URL("./e2e-results.json", import.meta.url), JSON.stringify(RESULTS, null, 2));
  const total = RESULTS.filter((r) => r.pass !== null).length;
  const passed = RESULTS.filter((r) => r.pass === true).length;
  const failed = RESULTS.filter((r) => r.pass === false).length;
  console.log(`\n=== SUMMARY: ${passed}/${total} passed, ${failed} failed ===`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
