/**
 * Abandoned-checkout recovery against a real MongoDB — the model hook,
 * ownership scoping, payment/booking correctness and resume.
 *
 * Needs a THROWAWAY database (it drops it):
 *   RECOVERY_TEST_MONGO_URI=mongodb://127.0.0.1:27099/recovery_test \
 *     node --test test/checkoutRecovery/
 * Skipped when the variable is not set. Never point it at a shared DB.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

const URI = process.env.RECOVERY_TEST_MONGO_URI;
const skip = !URI && "RECOVERY_TEST_MONGO_URI not set";

const HOUR = 60 * 60 * 1000;
const later = (ms) => new Date(Date.now() + ms);

let CheckoutSession, CheckoutRecovery, Payment, Package, CartItem, cashfree, service;

const ids = () => ({
  customer: new mongoose.Types.ObjectId().toString(),
  cart: new mongoose.Types.ObjectId().toString(),
  pkg: new mongoose.Types.ObjectId(),
  cartItem: new mongoose.Types.ObjectId(),
});

async function waitFor(fn, label) {
  for (let i = 0; i < 100; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function seedPackage(_id, overrides = {}) {
  await Package.collection.insertOne({
    _id,
    packageStatus: "Live",
    vendorId: "VEN_TEST",
    vendorType: "Decorator",
    step1_eventAndCrew: { packageName: "Royal Mandap Decor", capacity: { minGuests: 10, maxGuests: 500 } },
    step4_sampleMedia: { media: [{ url: "https://cdn.example/mandap.jpg", type: "image" }] },
    ...overrides,
  });
}

async function startCheckout(k, { date = later(30 * 24 * HOUR), source = "cart" } = {}) {
  await CartItem.collection.updateOne(
    { _id: k.cartItem },
    { $set: { cartId: k.cart, packageId: String(k.pkg), selectedForCheckout: true } },
    { upsert: true }
  );
  const session = await new CheckoutSession({
    customerId: k.customer,
    source,
    sourceCartId: source === "cart" ? k.cart : null,
    lines: [
      {
        vendorId: "v1",
        packageId: String(k.pkg),
        sourceCartItemId: source === "cart" ? String(k.cartItem) : null,
        packageSnapshot: { name: "Royal Mandap Decor", image: "https://cdn.example/old.jpg", price: 45000 },
        eventDetails: { eventType: "Wedding", date, guestCount: 150, location: "Gurugram" },
      },
    ],
    contactDetails: { name: "Test", phone: "+919000000000" },
    status: "Active",
    expiresAt: later(30 * 60 * 1000),
  }).save();
  await waitFor(() => CheckoutRecovery.findOne({ checkoutSessionId: String(session._id) }), "recovery sync");
  return session;
}

const prompt = (k, offsetMs = 2 * HOUR) => service.getPromptForCustomer(k.customer, { now: later(offsetMs) });

// Scenario timings below are written against these values, independent of
// the shipped defaults (which are covered in policy.test.mjs).
const PINNED_ENV = {
  CHECKOUT_RECOVERY_INACTIVITY_MINUTES: "60",
  CHECKOUT_RECOVERY_IMPRESSION_COOLDOWN_MINUTES: "720",
  CHECKOUT_RECOVERY_MAX_IMPRESSIONS: "3",
  CHECKOUT_RECOVERY_DISMISS_COOLDOWN_HOURS: "72",
  CHECKOUT_RECOVERY_MAX_DISMISSALS: "2",
};

before(async () => {
  if (skip) return;
  Object.assign(process.env, PINNED_ENV);
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  ({ default: CheckoutSession } = await import("../../src/models/CheckoutSession.js"));
  ({ default: CheckoutRecovery } = await import("../../src/models/CheckoutRecovery.js"));
  ({ default: Payment } = await import("../../src/models/Payment.js"));
  ({ default: Package } = await import("../../src/models/Package.js"));
  ({ default: CartItem } = await import("../../src/models/CartItem.js"));
  ({ default: cashfree } = await import("../../src/config/cashfree.js"));
  service = await import("../../src/services/checkoutRecoveryService.js");
  await CheckoutRecovery.init();
});

after(async () => {
  if (skip) return;
  for (const key of Object.keys(PINNED_ENV)) delete process.env[key];
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(() => {
  if (skip) return;
  cashfree.PGFetchOrder = async () => {
    throw new Error("gateway not reachable in tests");
  };
});

test("1/2: checkout start creates a recovery; shown only after inactivity, without contact data", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  await startCheckout(k);

  assert.equal(await service.getPromptForCustomer(k.customer), null, "too recent right after checkout");
  const p = await prompt(k);
  assert.ok(p);
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].name, "Royal Mandap Decor");
  assert.equal(p.items[0].image, "https://cdn.example/mandap.jpg", "image read live, not the stale snapshot");
  assert.equal(p.items[0].guestCount, 150);
  assert.equal(p.paymentState, "none");
  assert.equal(JSON.stringify(p).includes("9000000000"), false);
  assert.equal(JSON.stringify(p).includes("45000"), false, "no stale price exposed");
});

test("3: completed checkout converts the recovery and never prompts", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  const session = await startCheckout(k);
  await service.resume(k.customer, (await prompt(k)).id, { now: later(2 * HOUR) });

  session.status = "Completed";
  await session.save();
  const rec = await waitFor(
    () => CheckoutRecovery.findOne({ checkoutSessionId: String(session._id), status: "Converted" }),
    "conversion"
  );
  assert.equal(rec.convertedAfterPrompt, true);
  assert.equal(await prompt(k), null);
});

test("3: a PAID payment row closes it even if the session record is gone", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  const session = await startCheckout(k);
  await CheckoutSession.deleteOne({ _id: session._id }); // what the 30-minute TTL does
  await Payment.create({
    checkoutSessionId: String(session._id),
    customerId: k.customer,
    paymentType: "Token",
    amount: 1000,
    cfOrderId: `cf_${k.customer}`,
    idempotencyKey: `idem_${k.customer}`,
    status: "PAID",
  });
  assert.equal(await prompt(k), null);
  assert.equal((await CheckoutRecovery.findOne({ checkoutSessionId: String(session._id) })).status, "Converted");
});

test("11: pending payment — unknown or PAID gateway status suppresses; ACTIVE (dropped at gateway) prompts", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  const session = await startCheckout(k);
  await Payment.create({
    checkoutSessionId: String(session._id),
    customerId: k.customer,
    paymentType: "Token",
    amount: 1000,
    cfOrderId: `cfp_${k.customer}`,
    idempotencyKey: `idemp_${k.customer}`,
    status: "PENDING",
  });

  assert.equal(await prompt(k), null, "gateway unreachable → uncertain");
  cashfree.PGFetchOrder = async () => ({ data: { order_status: "PAID" } });
  assert.equal(await prompt(k), null, "gateway says paid → leave it to the webhook");
  assert.equal((await CheckoutRecovery.findOne({ checkoutSessionId: String(session._id) })).status, "Open", "recovery never writes payment state");
  assert.equal((await Payment.findOne({ cfOrderId: `cfp_${k.customer}` })).status, "PENDING");

  cashfree.PGFetchOrder = async () => ({ data: { order_status: "ACTIVE" } });
  const p = await prompt(k);
  assert.equal(p?.paymentState, "failed");
});

test("11: an in-flight payment blocks resume even on click", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  const session = await startCheckout(k);
  const id = (await prompt(k)).id;
  await Payment.create({
    checkoutSessionId: String(session._id),
    customerId: k.customer,
    paymentType: "Token",
    amount: 1000,
    cfOrderId: `cfr_${k.customer}`,
    idempotencyKey: `idemr_${k.customer}`,
    status: "PENDING",
  });
  const result = await service.resume(k.customer, id);
  assert.equal(result.error?.code, "PAYMENT_PENDING");
});

test("4/E: impressions are capped per window; dismissal cools down, then retires", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  const session = await startCheckout(k);
  const id = (await prompt(k)).id;
  const at = (ms) => ({ now: later(ms) });

  await service.recordImpression(k.customer, id, at(2 * HOUR));
  await service.recordImpression(k.customer, id, at(2 * HOUR + 1000));
  let rec = await CheckoutRecovery.findById(id);
  assert.equal(rec.impressions.count, 1, "same window counted once");
  assert.equal(await prompt(k, 3 * HOUR), null, "impression cooldown");

  await service.dismiss(k.customer, id, at(3 * HOUR));
  assert.equal(await prompt(k, 20 * HOUR), null, "dismiss cooldown");
  assert.ok(await prompt(k, 80 * HOUR), "back after the cooldown");

  await service.dismiss(k.customer, id, at(80 * HOUR));
  rec = await CheckoutRecovery.findById(id);
  assert.equal(rec.status, "Retired");
  assert.equal(await prompt(k, 200 * HOUR), null);

  // A genuinely new checkout attempt gets a fresh prompt.
  session.lines[0].quantity = 2;
  const fresh = await startCheckout(k);
  assert.notEqual(String(fresh._id), String(session._id));
  assert.ok(await prompt(k));
});

test("5: multiple incomplete checkouts — only the newest is prompted", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  const first = await startCheckout(k);
  const second = await startCheckout(k);
  const p = await prompt(k);
  assert.equal(String((await CheckoutRecovery.findById(p.id)).checkoutSessionId), String(second._id));
  assert.equal((await CheckoutRecovery.findOne({ checkoutSessionId: String(first._id) })).status, "Superseded");
});

test("5: two checkouts created at once (two tabs) leave exactly one Open", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  await Promise.all([startCheckout(k), startCheckout(k), startCheckout(k)]);
  await new Promise((r) => setTimeout(r, 200)); // let every supersede pass finish
  assert.equal(await CheckoutRecovery.countDocuments({ customerId: k.customer, status: "Open" }), 1);
});

test("5: newest-by-activity wins even when it was recorded first", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  const line = { vendorId: "v1", packageId: String(k.pkg), eventDetails: {}, packageSnapshot: {} };
  const fake = (updatedAt) => ({
    _id: new mongoose.Types.ObjectId(),
    customerId: k.customer,
    source: "direct",
    status: "Active",
    lines: [line],
    updatedAt,
  });
  const newer = fake(new Date(Date.now() - 1000));
  const older = fake(new Date(Date.now() - 5000));
  await service.syncFromCheckoutSession(newer); // recorded first…
  await service.syncFromCheckoutSession(older); // …but this one is older
  const open = await CheckoutRecovery.find({ customerId: k.customer, status: "Open" });
  assert.deepEqual(open.map((r) => r.checkoutSessionId), [String(newer._id)]);
});

test("conversion after Continue Booking is attributed even though checkout restarts fresh", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  const original = await startCheckout(k);
  await CheckoutSession.deleteOne({ _id: original._id });
  const id = (await prompt(k)).id;
  assert.equal((await service.resume(k.customer, id)).action, "checkout");

  const fresh = await startCheckout(k); // what /booking-summary does next
  const freshRec = await CheckoutRecovery.findOne({ checkoutSessionId: String(fresh._id) });
  assert.equal(freshRec.resumedFrom, id);
  assert.equal((await CheckoutRecovery.findById(id)).status, "Superseded");

  fresh.status = "Completed";
  await fresh.save();
  const converted = await waitFor(
    () => CheckoutRecovery.findOne({ checkoutSessionId: String(fresh._id), status: "Converted" }),
    "conversion"
  );
  assert.equal(converted.convertedAfterPrompt, true);
});

test("6: package taken off the platform invalidates it", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  const session = await startCheckout(k);
  await Package.collection.updateOne({ _id: k.pkg }, { $set: { packageStatus: "Paused" } });
  assert.equal(await prompt(k), null);
  const rec = await CheckoutRecovery.findOne({ checkoutSessionId: String(session._id) });
  assert.equal(rec.status, "Invalidated");
  assert.equal(rec.statusReason, "package_unavailable");
});

test("7: event date already passed invalidates it", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  const session = await startCheckout(k, { date: later(36 * HOUR) });
  assert.equal(await prompt(k, 4 * 24 * HOUR), null);
  assert.equal((await CheckoutRecovery.findOne({ checkoutSessionId: String(session._id) })).statusReason, "event_date_passed");
});

test("cancelled checkout (customer edited the cart) never prompts", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  const session = await startCheckout(k);
  session.status = "Cancelled";
  await session.save();
  await waitFor(
    async () => (await CheckoutRecovery.findOne({ checkoutSessionId: String(session._id) }))?.status === "Invalidated",
    "invalidation"
  );
  assert.equal(await prompt(k), null);
});

test("8: another customer can't read, dismiss or resume someone else's recovery", { skip }, async () => {
  const owner = ids();
  const other = ids();
  await seedPackage(owner.pkg);
  await startCheckout(owner);
  const id = (await prompt(owner)).id;

  assert.equal(await prompt(other), null);
  assert.equal((await service.recordImpression(other.customer, id)).error?.status, 404);
  assert.equal((await service.dismiss(other.customer, id)).error?.status, 404);
  assert.equal((await service.resume(other.customer, id)).error?.status, 404);
  const rec = await CheckoutRecovery.findById(id);
  assert.equal(rec.dismissals.count, 0);
  assert.equal(rec.ctaClicks.count, 0);
});

test("D/12: resume restores the cart selection; repeated clicks are harmless", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  const session = await startCheckout(k);
  const extra = new mongoose.Types.ObjectId();
  await CartItem.collection.insertOne({ _id: extra, cartId: k.cart, packageId: "something-else", selectedForCheckout: true });
  await CartItem.collection.updateOne({ _id: k.cartItem }, { $set: { selectedForCheckout: false } });
  await CheckoutSession.deleteOne({ _id: session._id }); // session hold expired + TTL-purged
  const id = (await prompt(k)).id;

  const first = await service.resume(k.customer, id, { now: later(2 * HOUR) });
  const second = await service.resume(k.customer, id, { now: later(2 * HOUR) });
  assert.deepEqual(first, { ok: true, action: "checkout", checkoutSessionId: null, unavailableItemCount: 0 });
  assert.deepEqual(second, first);
  assert.equal((await CartItem.collection.findOne({ _id: k.cartItem })).selectedForCheckout, true);
  assert.equal((await CartItem.collection.findOne({ _id: extra })).selectedForCheckout, false);
  assert.equal((await CheckoutRecovery.findById(id)).ctaClicks.count, 2);
});

test("D: a still-live session is resumed as-is; a direct checkout restarts at the package", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  const session = await startCheckout(k);
  const id = (await prompt(k)).id;
  const live = await service.resume(k.customer, id);
  assert.equal(live.checkoutSessionId, String(session._id));

  const d = ids();
  await seedPackage(d.pkg);
  await startCheckout(d, { source: "direct" });
  const direct = await service.resume(d.customer, (await prompt(d)).id, { now: later(2 * HOUR) });
  assert.deepEqual(direct, { ok: true, action: "package", packageId: String(d.pkg), unavailableItemCount: 0 });
});

test("shipped defaults: shows within a 10-15 minute visit, then again on a later visit", { skip }, async () => {
  for (const key of Object.keys(PINNED_ENV)) delete process.env[key];
  try {
    const k = ids();
    await seedPackage(k.pkg);
    await startCheckout(k);
    const MIN = 60 * 1000;
    assert.equal(await prompt(k, 5 * MIN), null, "still too fresh 5 min after leaving checkout");
    const p = await prompt(k, 11 * MIN);
    assert.ok(p, "eligible 11 min after leaving checkout — same visit");
    await service.recordImpression(k.customer, p.id, { now: later(11 * MIN) });
    assert.equal(await prompt(k, 20 * MIN), null, "not again within 15 min");
    assert.ok(await prompt(k, 40 * MIN), "available again on a later visit");
  } finally {
    Object.assign(process.env, PINNED_ENV);
  }
});

test("disabled: nothing is recorded or shown", { skip }, async () => {
  const k = ids();
  await seedPackage(k.pkg);
  process.env.CHECKOUT_RECOVERY_ENABLED = "false";
  try {
    const session = await new CheckoutSession({
      customerId: k.customer,
      source: "direct",
      lines: [{ vendorId: "v1", packageId: String(k.pkg), eventDetails: {} }],
      status: "Active",
      expiresAt: later(HOUR),
    }).save();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(await CheckoutRecovery.exists({ checkoutSessionId: String(session._id) }), null);
    assert.equal(await prompt(k), null);
  } finally {
    delete process.env.CHECKOUT_RECOVERY_ENABLED;
  }
});
