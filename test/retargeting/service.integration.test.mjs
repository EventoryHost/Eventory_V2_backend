/**
 * Unified retargeting against a real MongoDB — campaign selection, browsing
 * recommendations, exclusions, frequency, ownership and conversion, plus the
 * HTTP auth guard.
 *
 * Needs a THROWAWAY database (it drops it):
 *   RECOVERY_TEST_MONGO_URI=mongodb://127.0.0.1:27099/retargeting_test \
 *     node --test "test/retargeting/*.test.mjs"
 * Skipped when the variable is not set. Never point it at a shared DB.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

const URI = process.env.RECOVERY_TEST_MONGO_URI?.replace(/\/[^/]*$/, "/retargeting_test");
const skip = !URI && "RECOVERY_TEST_MONGO_URI not set";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const ago = (ms) => new Date(Date.now() - ms);
const later = (ms) => new Date(Date.now() + ms);

let Package, ViewedItem, Booking, CheckoutSession, RetargetingCampaign, CheckoutRecovery, CommercialEvent, Customer, cashfree, svc;

const oid = () => new mongoose.Types.ObjectId();

async function seedPackage(overrides = {}) {
  const _id = oid();
  const doc = {
    _id,
    packageGroupId: `grp-${_id}`,
    variantType: "Premium",
    packageStatus: "Live",
    deletedAt: null,
    vendorId: "VEN_VISIBLE",
    vendorType: "Decorator",
    step1_eventAndCrew: { packageName: `Package ${_id}`, eventCategories: ["Wedding", "Engagement"], capacity: {} },
    step3_policiesAndCharges: { packagePricing: { price: 50000 } },
    step4_sampleMedia: { media: [{ url: `https://cdn.example/${_id}.jpg`, type: "image" }] },
    ...overrides,
  };
  await Package.collection.insertOne(doc);
  return doc;
}

const view = (customer, pkg, viewedAt = ago(30 * MIN), viewCount = 1) =>
  ViewedItem.collection.insertOne({ customerId: customer, packageId: String(pkg._id), viewedAt, viewCount });

const select = (customer, at = new Date()) => svc.selectCampaignForCustomer(customer, { now: at });

before(async () => {
  if (skip) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  ({ default: Package } = await import("../../src/models/Package.js"));
  ({ default: ViewedItem } = await import("../../src/models/ViewedItem.js"));
  ({ default: Booking } = await import("../../src/models/Booking.js"));
  ({ default: CheckoutSession } = await import("../../src/models/CheckoutSession.js"));
  ({ default: RetargetingCampaign } = await import("../../src/models/RetargetingCampaign.js"));
  ({ default: CheckoutRecovery } = await import("../../src/models/CheckoutRecovery.js"));
  ({ default: CommercialEvent } = await import("../../src/models/CommercialEvent.js"));
  ({ default: Customer } = await import("../../src/models/Customer.js"));
  ({ default: cashfree } = await import("../../src/config/cashfree.js"));
  svc = await import("../../src/services/retargetingCampaignService.js");
  const Vendor = (await import("../../src/models/Vendor.js")).default;
  await Vendor.collection.insertOne({ id: "VEN_VISIBLE", verification: { completionPercent: 100 } });
  await Vendor.collection.insertOne({ id: "VEN_HIDDEN", isDeactivated: true });
  await Promise.all([RetargetingCampaign.init(), CheckoutRecovery.init(), ViewedItem.init()]);
});

after(async () => {
  if (skip) return;
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(() => {
  if (skip) return;
  cashfree.PGFetchOrder = async () => {
    throw new Error("gateway not reachable in tests");
  };
});

test("no browsing history → no popup (handled gracefully)", { skip }, async () => {
  assert.equal(await select(oid().toString()), null);
});

test("RECENTLY_VIEWED: most interesting viewed package, with live details", { skip }, async () => {
  const customer = oid().toString();
  const once = await seedPackage();
  const often = await seedPackage({ step1_eventAndCrew: { packageName: "Royal Mandap", eventCategories: ["Wedding"] } });
  await view(customer, once, ago(20 * MIN), 1);
  await view(customer, often, ago(2 * HOUR), 4);

  const p = await select(customer);
  assert.equal(p.campaign, "RECENTLY_VIEWED");
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].packageId, String(often._id));
  assert.equal(p.items[0].name, "Royal Mandap");
  assert.equal(p.items[0].startingPrice, 50000);
  assert.equal(p.anchor.viewCount, 4);
  assert.equal((await RetargetingCampaign.findById(p.id)).anchorPackageGroupId, often.packageGroupId);
});

test("RECENTLY_VIEWED: not while the customer is still on it", { skip }, async () => {
  const customer = oid().toString();
  const pkg = await seedPackage();
  await view(customer, pkg, ago(1 * MIN));
  const p = await select(customer);
  assert.notEqual(p?.campaign, "RECENTLY_VIEWED");
});

test("already booked packages (any variant) are never retargeted or recommended", { skip }, async () => {
  const customer = oid().toString();
  const booked = await seedPackage();
  const sibling = await seedPackage({ packageGroupId: booked.packageGroupId, variantType: "Basic" });
  await view(customer, sibling, ago(HOUR), 3);
  await Booking.collection.insertOne({ bookingId: `BK-${oid()}`, customerId: customer, packageId: String(booked._id), status: "Confirmed" });
  assert.equal(await select(customer), null, "the only viewed package is booked and nothing else is similar");

  // A cancelled booking doesn't count as booked.
  const c2 = oid().toString();
  const cancelled = await seedPackage();
  await view(c2, cancelled, ago(HOUR));
  await Booking.collection.insertOne({ bookingId: `BK-${oid()}`, customerId: c2, packageId: String(cancelled._id), status: "Cancelled" });
  assert.equal((await select(c2))?.campaign, "RECENTLY_VIEWED");
});

test("checkout started for a package → left to abandoned checkout, not RECENTLY_VIEWED", { skip }, async () => {
  const customer = oid().toString();
  const pkg = await seedPackage({ vendorType: "UniqueTypeA", step1_eventAndCrew: { packageName: "X", eventCategories: ["Zzz"] } });
  await view(customer, pkg, ago(HOUR));
  await CommercialEvent.collection.insertOne({ type: "CHECKOUT_STARTED", customerId: customer, packageId: String(pkg._id), at: ago(30 * MIN) });
  const p = await select(customer);
  assert.notEqual(p?.campaign, "RECENTLY_VIEWED");
});

test("unavailable: viewed tier withdrawn → sibling tier shown as an alternative", { skip }, async () => {
  const customer = oid().toString();
  const gone = await seedPackage({ packageStatus: "Paused" });
  const sibling = await seedPackage({ packageGroupId: gone.packageGroupId, variantType: "Basic" });
  await view(customer, gone, ago(HOUR));
  const p = await select(customer);
  assert.equal(p.campaign, "RECENTLY_VIEWED");
  assert.equal(p.items[0].packageId, String(sibling._id));
  assert.equal(p.anchor.alternative, true);
});

test("unavailable: whole package gone (or vendor hidden) → SIMILAR_EVENTS alternatives, flagged unavailable", { skip }, async () => {
  const customer = oid().toString();
  const gone = await seedPackage({ packageStatus: "Paused", step1_eventAndCrew: { packageName: "Gone Decor", eventCategories: ["Wedding"] } });
  const hiddenVendor = await seedPackage({ vendorId: "VEN_HIDDEN" });
  const alt = await seedPackage({ step1_eventAndCrew: { packageName: "Alt Decor", eventCategories: ["Wedding"] } });
  await view(customer, gone, ago(HOUR));
  const p = await select(customer);
  assert.equal(p.campaign, "SIMILAR_EVENTS");
  assert.equal(p.anchor.available, false);
  assert.equal(p.anchor.name, "Gone Decor");
  const ids = p.items.map((i) => i.packageId);
  assert.ok(ids.includes(String(alt._id)));
  assert.equal(ids.includes(String(hiddenVendor._id)), false, "hidden vendor never recommended");
  assert.equal(ids.includes(String(gone._id)), false);
});

test("SIMILAR_EVENTS after RECENTLY_VIEWED is dismissed: related, unseen, unbooked, live", { skip }, async () => {
  const customer = oid().toString();
  const T = { vendorType: "SimDecor" };
  const anchor = await seedPackage({ ...T, step1_eventAndCrew: { packageName: "Anchor", eventCategories: ["SimWedding"] } });
  const similar = await seedPackage({ ...T, step1_eventAndCrew: { packageName: "Similar", eventCategories: ["SimWedding"] } });
  const bookedSimilar = await seedPackage({ ...T, step1_eventAndCrew: { packageName: "Booked", eventCategories: ["SimWedding"] } });
  const paused = await seedPackage({ ...T, packageStatus: "Paused" });
  const unrelated = await seedPackage({ vendorType: "DJ", step1_eventAndCrew: { packageName: "DJ", eventCategories: ["Corporate"] } });
  await view(customer, anchor, ago(HOUR));
  await Booking.collection.insertOne({ bookingId: `BK-${oid()}`, customerId: customer, packageId: String(bookedSimilar._id), status: "NewBooking" });

  const first = await select(customer);
  assert.equal(first.campaign, "RECENTLY_VIEWED");
  await svc.recordImpression(customer, first.id);
  await svc.dismiss(customer, first.id);
  assert.equal((await RetargetingCampaign.findById(first.id)).status, "Retired");

  // After the global pause + gap, the next campaign is SIMILAR_EVENTS.
  const p = await select(customer, later(7 * HOUR));
  assert.equal(p.campaign, "SIMILAR_EVENTS");
  assert.equal(p.anchor.name, "Anchor");
  const ids = p.items.map((i) => i.packageId);
  assert.deepEqual(ids, [String(similar._id)]);
  for (const excluded of [anchor, bookedSimilar, paused, unrelated]) assert.equal(ids.includes(String(excluded._id)), false);
  assert.ok(p.items[0].matchReasons.includes("same_category"));
});

test("priority: abandoned checkout beats browsing campaigns", { skip }, async () => {
  const customer = oid().toString();
  const viewed = await seedPackage();
  await view(customer, viewed, ago(HOUR));
  const inCheckout = await seedPackage({ vendorType: "Caterer" });
  const session = await new CheckoutSession({
    customerId: customer,
    source: "direct",
    lines: [{ vendorId: "v", packageId: String(inCheckout._id), eventDetails: { date: later(30 * 24 * HOUR) } }],
    status: "Active",
    expiresAt: later(30 * MIN),
  }).save();
  let rec;
  for (let i = 0; i < 100 && !rec; i++) {
    rec = await CheckoutRecovery.findOne({ checkoutSessionId: String(session._id) });
    await new Promise((r) => setTimeout(r, 20));
  }
  const p = await select(customer, later(2 * HOUR));
  assert.equal(p.campaign, "ABANDONED_CHECKOUT");
  assert.equal(p.id, String(rec._id));
  assert.equal(p.items[0].packageId, String(inCheckout._id));
});

test("frequency: one popup per gap, same campaign respects its cooldown, daily cap", { skip }, async () => {
  const customer = oid().toString();
  const pkgs = await Promise.all([1, 2, 3, 4, 5].map((n) => seedPackage({ vendorType: `Solo${n}`, step1_eventAndCrew: { packageName: `P${n}`, eventCategories: [`Only${n}`] } })));
  for (const [i, p] of pkgs.entries()) await view(customer, p, ago((i + 1) * HOUR));

  const t0 = new Date();
  const first = await select(customer, t0);
  await svc.recordImpression(customer, first.id, { now: t0 });
  await svc.recordImpression(customer, first.id, { now: t0 }); // duplicate impression
  assert.equal((await RetargetingCampaign.findById(first.id)).impressions.count, 1, "no duplicate impressions");
  assert.equal(await select(customer, new Date(t0.getTime() + 5 * MIN)), null, "customer-wide minimum gap");

  const second = await select(customer, new Date(t0.getTime() + 20 * MIN));
  assert.ok(second);
  assert.notEqual(second.id, first.id, "same campaign is cooling down; next interest is used");
  await svc.recordImpression(customer, second.id, { now: new Date(t0.getTime() + 20 * MIN) });
  const third = await select(customer, new Date(t0.getTime() + 40 * MIN));
  await svc.recordImpression(customer, third.id, { now: new Date(t0.getTime() + 40 * MIN) });
  assert.equal(await select(customer, new Date(t0.getTime() + 60 * MIN)), null, "daily cap of 3 browsing popups");
});

test("ownership: another customer can't see, dismiss or click someone's campaign", { skip }, async () => {
  const owner = oid().toString();
  const other = oid().toString();
  const pkg = await seedPackage({ vendorType: "Owned", step1_eventAndCrew: { packageName: "Mine", eventCategories: ["Mine"] } });
  await view(owner, pkg, ago(HOUR));
  const p = await select(owner);
  assert.equal(await select(other), null, "other customer has no history → sees nothing of the owner's");
  assert.equal((await svc.recordImpression(other, p.id)).error?.status, 404);
  assert.equal((await svc.dismiss(other, p.id)).error?.status, 404);
  assert.equal((await svc.recordClick(other, p.id, String(pkg._id))).error?.status, 404);
  const rec = await RetargetingCampaign.findById(p.id);
  assert.equal(rec.impressions.count + rec.dismissals.count + rec.ctaClicks.count, 0);
});

test("conversion: booking a shown package marks the campaign Converted, with click attribution", { skip }, async () => {
  const customer = oid().toString();
  const pkg = await seedPackage({ vendorType: "Conv", step1_eventAndCrew: { packageName: "Conv", eventCategories: ["Conv"] } });
  await view(customer, pkg, ago(HOUR));
  const p = await select(customer);
  await svc.recordImpression(customer, p.id);
  await svc.recordClick(customer, p.id, String(pkg._id));
  await svc.recordClick(customer, p.id, String(oid())); // a package it never showed isn't recorded
  assert.equal((await RetargetingCampaign.findById(p.id)).ctaClicks.lastPackageId, null);

  const session = await new CheckoutSession({
    customerId: customer,
    source: "direct",
    lines: [{ vendorId: "v", packageId: String(pkg._id), eventDetails: {} }],
    status: "Active",
    expiresAt: later(30 * MIN),
  }).save();
  session.status = "Completed"; // only ever set server-side after payment verification
  await session.save();
  let rec;
  for (let i = 0; i < 100; i++) {
    rec = await RetargetingCampaign.findById(p.id);
    if (rec.status === "Converted") break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(rec.status, "Converted");
  assert.equal(rec.convertedPackageId, String(pkg._id));
  assert.equal(rec.convertedAfterClick, true);
});

test("ViewedItem: repeat opens within 30 minutes are one visit; a later open is another", { skip }, async () => {
  const { recordViewedItem } = await import("../../src/controllers/customerViewedController.js");
  const customer = { _id: oid() };
  const pkg = await seedPackage();
  const call = () =>
    new Promise((resolve) => recordViewedItem({ body: { packageId: String(pkg._id) }, customer }, { status: () => ({ json: resolve }) }));
  await call();
  await call();
  let row = await ViewedItem.findOne({ customerId: String(customer._id), packageId: String(pkg._id) }).lean();
  assert.equal(row.viewCount, 1);
  await ViewedItem.updateOne({ _id: row._id }, { $set: { viewedAt: ago(2 * HOUR) } });
  await call();
  row = await ViewedItem.findById(row._id).lean();
  assert.equal(row.viewCount, 2);
  assert.equal(typeof row.customerId, "string");
});

test("HTTP: every retargeting route requires a customer login", { skip }, async () => {
  const { default: app } = await import("../../src/app.js");
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/customer/retargeting`;
  try {
    for (const [method, path] of [["GET", ""], ["POST", `/${oid()}/impression`], ["POST", `/${oid()}/dismiss`], ["POST", `/${oid()}/click`]]) {
      const res = await fetch(base + path, { method });
      assert.equal(res.status, 401, `${method} ${path}`);
    }
    const customer = await Customer.collection.insertOne({ id: "CUS_HTTP", name: "T", email: "t@example.invalid", authProviders: [] });
    const token = jwt.sign({ id: "CUS_HTTP", role: "customer" }, process.env.JWT_SECRET || "test-secret");
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret";
    const ok = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { status: "SUCCESS", prompt: null });
    const vendorToken = jwt.sign({ id: "VEN1" }, process.env.JWT_SECRET);
    assert.equal((await fetch(base, { headers: { Authorization: `Bearer ${vendorToken}` } })).status, 403);
    assert.ok(customer.insertedId);
  } finally {
    server.close();
  }
});
