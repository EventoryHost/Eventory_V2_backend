/**
 * Package / variant integrity — integration tests.
 *
 *   node --test test/package-variants.test.mjs
 *
 * Boots the real Express app against a THROWAWAY database on the MONGO_URI
 * cluster (eventory_variant_test_<timestamp>), seeds it, exercises the HTTP
 * API end to end, and drops it afterwards. Nothing touches dev/prod data.
 *
 * Covers the 16 scenarios of the variant-management spec plus a regression
 * test for each root cause fixed alongside it.
 */
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import { execFileSync } from "child_process";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

process.env.VENDOR_AUTH_MODE = "off";
process.env.CONVENIENCE_FEE_DISABLED = process.env.CONVENIENCE_FEE_DISABLED ?? "true";

const DB = `eventory_variant_test_${Date.now()}`;
assert.match(DB, /^eventory_variant_test_\d+$/);
await mongoose.connect(process.env.MONGO_URI, { dbName: DB });
assert.equal(mongoose.connection.db.databaseName, DB, "refusing to run outside the throwaway database");

const { default: app } = await import("../src/app.js");
const { default: Vendor } = await import("../src/models/Vendor.js");
const { default: Package } = await import("../src/models/Package.js");
const { default: Booking } = await import("../src/models/Booking.js");
const { default: Customer } = await import("../src/models/Customer.js");
const { getModelForVendor } = await import("../src/utils/modelRegistry.js");
const { invalidateHiddenVendors } = await import("../src/utils/customerVisibility.js");

let server;
let BASE;
before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  BASE = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  server.closeAllConnections(); // fetch keeps sockets alive; close() would wait on them
  await new Promise((r) => server.close(r));
  // The Atlas test user may not dropDatabase; dropping every collection
  // removes the (then empty) database just the same.
  if (mongoose.connection.db.databaseName === DB) {
    for (const { name } of await mongoose.connection.db.listCollections().toArray()) {
      await mongoose.connection.db.dropCollection(name).catch(() => mongoose.connection.db.collection(name).deleteMany({}));
    }
  }
  await mongoose.disconnect();
});

// ── helpers ────────────────────────────────────────────────────────────────

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

let seq = 0;
const makeVendor = async (name) => {
  const v = await Vendor.create({
    businessName: name,
    vendorType: "Decorator",
    phone: `90000${String(++seq).padStart(5, "0")}`,
  });
  // The pre-save hook derives completionPercent from the real verification
  // steps; set it directly so the vendor is customer-visible.
  // A demand tier lets the Commercial Engine resolve a pricing category.
  await Vendor.collection.updateOne(
    { _id: v._id },
    { $set: { "verification.completionPercent": 100, "commercial.tierOverride": { tier: "MODERATE" } } }
  );
  invalidateHiddenVendors();
  return v;
};

const Decorator = getModelForVendor("Decorator");
const variantDoc = (vendor, groupId, name, price, extra = {}) => ({
  vendorId: vendor.id,
  vendorType: "Decorator",
  packageStatus: "Live",
  packageGroupId: groupId,
  variantType: name,
  step1_eventAndCrew: { packageName: extra.packageName ?? "Wedding Decor", capacity: { minGuests: 1, maxGuests: 500 } },
  step2_productsAndPricing: { included: [`${name} inclusion A`, `${name} inclusion B`] },
  step3_policiesAndCharges: { packagePricing: { price, billingUnit: "per event" } },
  bookingSettings: { bookingType: "Ready-to-Book", paymentType: "Free" },
  ...extra,
});

/**
 * Seeds one logical package with the given variant names (prices
 * priceStep × 1, × 2, …). `bookable` adds the Commercial Engine inputs a real
 * Live package carries (an EM-approved criticality), so checkout can price it
 * at a fixed price instead of refusing it for commercial review.
 */
const makePackage = async (vendor, names, { packageName, groupId, priceStep = 1000, bookable = false } = {}) => {
  const gid = groupId ?? `PKG_GRP_TEST_${++seq}`;
  const docs = [];
  for (let i = 0; i < names.length; i++) {
    const extra = { packageName };
    if (bookable) extra.commercial = { eventoryApprovedCriticality: "NON_CRITICAL" };
    // Sequential, so createdAt order == names order.
    docs.push(await Decorator.create(variantDoc(vendor, gid, names[i], (i + 1) * priceStep, extra)));
  }
  return { gid, docs };
};

const pdp = (id) => call("GET", `/customer/packages/${id}`);

// ── fixtures shared by several tests ──────────────────────────────────────

let vendorA, vendorB;
before(async () => {
  vendorA = await makeVendor("Vendor A");
  vendorB = await makeVendor("Vendor B");
});

// ── 1-4, 10, 11: every variant opens as itself; the group is complete ─────

for (const size of [1, 2, 5, 10]) {
  test(`package with ${size} variant(s): each variant opens as the selected one`, async () => {
    const names = Array.from({ length: size }, (_, i) => `Tier ${i + 1}`);
    const { gid, docs } = await makePackage(vendorA, names);
    for (const [i, doc] of docs.entries()) {
      const { status, data } = await pdp(doc._id);
      assert.equal(status, 200);
      assert.equal(String(data.selectedVariantId), String(doc._id), "selected = the clicked variant, never a default");
      assert.equal(data.package.variantType, names[i]);
      assert.equal(data.package.step3_policiesAndCharges.packagePricing.price, (i + 1) * 1000);
      assert.deepEqual(data.package.step2_productsAndPricing.included, [`${names[i]} inclusion A`, `${names[i]} inclusion B`]);
      assert.equal(data.packageGroupId, gid);
      assert.equal(data.variants.length, size);
      assert.deepEqual(data.variants.map((v) => v.variantType), names, "every variant, in creation order");
      const me = data.variants.find((v) => String(v._id) === String(doc._id));
      assert.equal(me.price, (i + 1) * 1000);
      assert.deepEqual(me.included, [`${names[i]} inclusion A`, `${names[i]} inclusion B`]);
    }
    const group = await call("GET", `/customer/packages/group/${gid}?variantId=${docs.at(-1)._id}`);
    assert.equal(group.status, 200);
    assert.equal(group.data.count, size);
    assert.equal(String(group.data.selectedVariantId), String(docs.at(-1)._id));
    assert.ok(group.data.packages.every((p) => Array.isArray(p.step2_productsAndPricing?.included)));
  });
}

test("group endpoint: a variantId outside the group is not echoed as selected", async () => {
  const a = await makePackage(vendorA, ["Basic", "Premium"]);
  const b = await makePackage(vendorA, ["Solo"]);
  const { data } = await call("GET", `/customer/packages/group/${a.gid}?variantId=${b.docs[0]._id}`);
  assert.equal(data.selectedVariantId, null);
});

// ── 5, 15: similarly named packages never merge ────────────────────────────

test("vendors with similarly named packages, and one vendor with several packages, stay separate", async () => {
  const a1 = await makePackage(vendorA, ["Basic", "Premium"], { packageName: "Wedding Photography" });
  const a2 = await makePackage(vendorA, ["Basic", "Premium"], { packageName: "Wedding Photography" });
  const b1 = await makePackage(vendorB, ["Basic", "Premium"], { packageName: "Wedding Photography" });
  for (const pkg of [a1, a2, b1]) {
    const { data } = await pdp(pkg.docs[0]._id);
    assert.equal(data.variants.length, 2);
    assert.deepEqual(new Set(data.variants.map((v) => String(v._id))), new Set(pkg.docs.map((d) => String(d._id))));
  }
  const listing = await call("GET", `/customer/packages?limit=50`);
  assert.equal(listing.status, 200);
  const ids = new Set(listing.data.packages.map((p) => String(p._id)));
  for (const d of [...a1.docs, ...a2.docs, ...b1.docs]) assert.ok(ids.has(String(d._id)), "each variant is its own listing card");
  const card = listing.data.packages.find((p) => String(p._id) === String(b1.docs[1]._id));
  assert.equal(String(card.packageGroupId), b1.gid);
  assert.equal(card.variantType, "Premium");
});

test("a sibling stored under another vendor is excluded from the customer views", async () => {
  const pkg = await makePackage(vendorA, ["Basic", "Premium"]);
  const rogue = await Decorator.create(variantDoc(vendorB, pkg.gid, "Rogue", 1));
  const { data } = await pdp(pkg.docs[0]._id);
  assert.ok(!data.variants.some((v) => String(v._id) === String(rogue._id)));
  const group = await call("GET", `/customer/packages/group/${pkg.gid}`);
  assert.ok(!group.data.packages.some((p) => String(p._id) === String(rogue._id)));
  assert.equal(group.data.count, 2);
});

// ── 6: adding a variant ───────────────────────────────────────────────────

test("admin adds a variant: same group and vendor, new _id, Draft until approved", async () => {
  const pkg = await makePackage(vendorA, ["Basic", "Premium"]);
  const res = await call("POST", `/admin/packages/group/${pkg.gid}/variants`, { variantType: "Deluxe" });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const added = await Package.findById(res.data.data.packageId).lean();
  assert.equal(added.packageGroupId, pkg.gid);
  assert.equal(added.vendorId, vendorA.id);
  assert.equal(added.packageStatus, "Draft");
  assert.ok(!pkg.docs.some((d) => String(d._id) === String(added._id)));
  assert.equal((await pdp(pkg.docs[0]._id)).data.variants.length, 2, "a Draft is not shown to customers");

  const clash = await call("POST", `/admin/packages/group/${pkg.gid}/variants`, { variantType: "  deluxe " });
  assert.equal(clash.status, 409, "names are unique per package, ignoring case/whitespace");
});

test("vendor add-variant: refuses another vendor's package and duplicate names", async () => {
  const pkg = await makePackage(vendorA, ["Basic"]);
  const foreign = await call("POST", `/packages/initialize`, {
    vendorId: vendorB.id, vendorType: "Decorator", packageGroupId: pkg.gid, variantType: "Hijack",
  });
  assert.equal(foreign.status, 403);
  const wrongType = await call("POST", `/packages/initialize`, {
    vendorId: vendorA.id, vendorType: "Caterer", packageGroupId: pkg.gid, variantType: "Food",
  });
  assert.equal(wrongType.status, 400);
  const ok = await call("POST", `/packages/initialize`, {
    vendorId: vendorA.id, vendorType: "Decorator", packageGroupId: pkg.gid, variantType: "Standard",
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.packageGroupId, pkg.gid);
  const dup = await call("POST", `/packages/${pkg.docs[0]._id}/duplicate-variant`, { variantType: "BASIC" });
  assert.equal(dup.status, 409);
});

// ── 7: renaming ────────────────────────────────────────────────────────────

test("renaming changes only the display name", async () => {
  const pkg = await makePackage(vendorA, ["Basic", "Premium"]);
  const res = await call("PUT", `/admin/packages/${pkg.docs[0]._id}/variant-name`, { variantType: "Starter" });
  assert.equal(res.status, 200);
  const doc = await Package.findById(pkg.docs[0]._id).lean();
  assert.equal(doc.variantType, "Starter");
  assert.equal(doc.packageGroupId, pkg.gid);
  assert.equal((await Package.findById(pkg.docs[1]._id).lean()).variantType, "Premium", "sibling untouched");
  const clash = await call("PUT", `/admin/packages/${pkg.docs[0]._id}/variant-name`, { variantType: "premium" });
  assert.equal(clash.status, 409);
  const empty = await call("PUT", `/admin/packages/${pkg.docs[0]._id}/variant-name`, { variantType: "  " });
  assert.equal(empty.status, 400);
});

test("vendor rename / restore cannot create duplicate names", async () => {
  const pkg = await makePackage(vendorA, ["Basic", "Premium"]);
  await Package.updateMany({ _id: { $in: pkg.docs.map((d) => d._id) } }, { $set: { packageStatus: "Draft" } });
  assert.equal((await call("PUT", `/packages/${pkg.docs[0]._id}`, { variantType: "PREMIUM" })).status, 409);
  await call("PUT", `/packages/${pkg.docs[0]._id}`, { packageStatus: "Deleted" });
  assert.equal((await call("PUT", `/packages/${pkg.docs[1]._id}`, { variantType: "Basic" })).status, 200);
  const restore = await call("PUT", `/packages/${pkg.docs[0]._id}`, { packageStatus: "Draft" });
  assert.equal(restore.status, 409, "restoring 'Basic' would collide with the renamed sibling");
});

// ── 8, 9: pricing and activation are per variant ───────────────────────────

test("editing one variant's price leaves its siblings alone", async () => {
  const pkg = await makePackage(vendorA, ["Basic", "Premium"]);
  const res = await call("PUT", `/admin/packages/${pkg.docs[1]._id}/edit-step/3`, { packagePricing: { price: 9999, billingUnit: "per event" } });
  assert.equal(res.status, 200);
  const { data } = await pdp(pkg.docs[0]._id);
  assert.equal(data.variants.find((v) => String(v._id) === String(pkg.docs[1]._id)).price, 9999);
  assert.equal(data.variants.find((v) => String(v._id) === String(pkg.docs[0]._id)).price, 1000);
});

test("deactivating a variant hides only that variant; activating restores it", async () => {
  const pkg = await makePackage(vendorA, ["Basic", "Standard", "Premium"]);
  assert.equal((await call("PUT", `/admin/packages/${pkg.docs[1]._id}/deactivate`, {})).status, 200);
  assert.equal((await pdp(pkg.docs[1]._id)).status, 404);
  const { data } = await pdp(pkg.docs[0]._id);
  assert.deepEqual(data.variants.map((v) => v.variantType), ["Basic", "Premium"]);
  assert.equal((await Package.findById(pkg.docs[2]._id).lean()).packageStatus, "Live", "siblings stay Live");
  assert.equal((await call("PUT", `/admin/packages/${pkg.docs[1]._id}/deactivate`, {})).status, 409, "already paused");
  assert.equal((await call("PUT", `/admin/packages/${pkg.docs[1]._id}/activate`, {})).status, 200);
  assert.equal((await pdp(pkg.docs[0]._id)).data.variants.length, 3);
});

test("admin library paginates whole packages, never splitting variants across pages", async () => {
  const vendorC = await makeVendor("Vendor C");
  const p1 = await makePackage(vendorC, ["A", "B", "C"]);
  const p2 = await makePackage(vendorC, ["A", "B", "C", "D"]);
  const page1 = await call("GET", `/admin/packages/all?groupBy=package&vendorId=${vendorC.id}&limit=1&page=1`);
  const page2 = await call("GET", `/admin/packages/all?groupBy=package&vendorId=${vendorC.id}&limit=1&page=2`);
  assert.equal(page1.data.pagination.total, 2);
  const counts = [page1.data.data[0].variantCount, page2.data.data[0].variantCount].sort();
  assert.deepEqual(counts, [3, 4]);
  assert.deepEqual(new Set([page1.data.data[0].packageGroupId, page2.data.data[0].packageGroupId]), new Set([p1.gid, p2.gid]));
});

// ── 12-14: booking lifecycle with a non-default variant ────────────────────

const customerToken = async () => {
  const phone = `98${String(Date.now() % 1e5).padStart(5, "0")}${String(++seq).padStart(3, "0")}`;
  const customer = await Customer.create({ name: "Test Customer", phone, isPhoneVerified: true });
  const token = jwt.sign({ id: customer.id, role: "customer" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  return { customer, phone, auth: { Authorization: `Bearer ${token}` } };
};

const startCheckout = async (auth, phone, packageId) => {
  const eventDate = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  const session = await call("POST", `/customer/checkout/session`, {
    source: "direct", packageId, eventType: "Wedding", date: eventDate, guests: 100, location: "Delhi",
  }, auth);
  assert.equal(session.status, 201, JSON.stringify(session.data));
  const sid = session.data.session?._id ?? session.data.sessionId ?? session.data.data?._id;
  assert.ok(sid, `no session id in ${JSON.stringify(session.data).slice(0, 300)}`);
  const contact = await call("PATCH", `/customer/checkout/session/${sid}/contact`, { name: "Test Customer", phone, email: "t@example.com" }, auth);
  assert.equal(contact.status, 200, JSON.stringify(contact.data));
  return { sid, lineId: session.data.session?.lines?.[0]?._id };
};

test("booking a non-default variant persists that exact variant, and history survives later edits", async () => {
  const pkg = await makePackage(vendorA, ["Basic", "Standard", "Premium"], { packageName: "Wedding Photography", priceStep: 20000, bookable: true });
  const standard = pkg.docs[1];
  const { auth, phone, customer } = await customerToken();
  const { sid } = await startCheckout(auth, phone, standard._id);

  const confirm = await call("POST", `/customer/payments/confirm-free`, { checkoutSessionId: sid }, auth);
  assert.equal(confirm.status, 201, JSON.stringify(confirm.data));

  const booking = await Booking.findOne({ customerId: customer._id }).lean();
  assert.ok(booking, "booking created");
  assert.equal(String(booking.packageId), String(standard._id));
  assert.equal(booking.packageGroupId, pkg.gid);
  assert.equal(booking.vendorId, vendorA.id);
  assert.equal(booking.packageSnapshot.variantType, "Standard");
  assert.equal(booking.packageSnapshot.name, "Wedding Photography");
  assert.equal(booking.packageSnapshot.price, 40000, "the server-side price of the selected variant");
  assert.deepEqual(booking.packageSnapshot.deliverables.included, ["Standard inclusion A", "Standard inclusion B"]);

  // 13: edit the booked variant (rename + reprice), then 14: view history.
  await call("PUT", `/admin/packages/${standard._id}/variant-name`, { variantType: "Classic" });
  await call("PUT", `/admin/packages/${standard._id}/edit-step/3`, { packagePricing: { price: 77777 } });
  await call("PUT", `/admin/packages/${standard._id}/deactivate`, {});
  const detail = await call("GET", `/customer/bookings/${booking.bookingId}`, undefined, auth);
  assert.equal(detail.status, 200, JSON.stringify(detail.data).slice(0, 300));
  assert.equal(detail.data.booking.packageSnapshot.variantType, "Standard", "historic name kept after rename");
  assert.equal(detail.data.booking.packageSnapshot.price, 40000, "historic price kept after repricing");
  const list = await call("GET", `/customer/bookings`, undefined, auth);
  assert.equal(list.status, 200);
});

test("checkout variant switch stays inside the package; a repriced variant is re-quoted before charging", async () => {
  const pkg = await makePackage(vendorA, ["Basic", "Premium"], { priceStep: 20000, bookable: true });
  const other = await makePackage(vendorA, ["Solo"], { priceStep: 20000, bookable: true });
  const { auth, phone } = await customerToken();
  const { sid, lineId } = await startCheckout(auth, phone, pkg.docs[0]._id);
  const line = lineId ?? (await call("GET", `/customer/checkout/session/${sid}`, undefined, auth)).data.session.lines[0]._id;

  const cross = await call("PATCH", `/customer/checkout/session/${sid}/lines/${line}`, { packageId: String(other.docs[0]._id) }, auth);
  assert.equal(cross.status, 400);
  const sw = await call("PATCH", `/customer/checkout/session/${sid}/lines/${line}`, { packageId: String(pkg.docs[1]._id) }, auth);
  assert.equal(sw.status, 200, JSON.stringify(sw.data).slice(0, 300));

  // Admin reprices the selected variant after the quote was locked.
  await call("PUT", `/admin/packages/${pkg.docs[1]._id}/edit-step/3`, { packagePricing: { price: 55555 } });
  const stale = await call("POST", `/customer/payments/confirm-free`, { checkoutSessionId: sid }, auth);
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, "QUOTE_CHANGED");
  const retry = await call("POST", `/customer/payments/confirm-free`, { checkoutSessionId: sid }, auth);
  assert.equal(retry.status, 201, JSON.stringify(retry.data).slice(0, 300));
  const booking = await Booking.findOne({ packageId: String(pkg.docs[1]._id) }).lean();
  assert.equal(booking.packageSnapshot.variantType, "Premium");
  assert.equal(booking.pricing.basePrice, 55555, "charged the current price, not the stale one");
});

test("vendor manual booking / admin repoint refuse another vendor's package", async () => {
  const mine = await makePackage(vendorA, ["Basic"]);
  const theirs = await makePackage(vendorB, ["Basic"]);
  const manual = await call("POST", `/bookings/vendor/${vendorA.id}`, {
    packageId: String(theirs.docs[0]._id), customer: { name: "Walk In", phone: "9999999999" },
    eventDate: new Date(Date.now() + 86400000 * 50).toISOString(), startTime: "10:00", endTime: "14:00", paymentType: "FreeBooking",
  });
  assert.equal(manual.status, 400, JSON.stringify(manual.data).slice(0, 300));
  const ok = await call("POST", `/bookings/vendor/${vendorA.id}`, {
    packageId: String(mine.docs[0]._id), customer: { name: "Walk In", phone: "9999999999" },
    eventDate: new Date(Date.now() + 86400000 * 51).toISOString(), startTime: "10:00", endTime: "14:00", paymentType: "FreeBooking",
  });
  assert.ok([200, 201].includes(ok.status), JSON.stringify(ok.data).slice(0, 300));
  const created = await Booking.findOne({ packageId: String(mine.docs[0]._id) }).lean();
  assert.equal(created.packageGroupId, mine.gid);
  const repoint = await call("PUT", `/admin/bookings/${created.bookingId}`, { packageId: String(theirs.docs[0]._id) });
  assert.equal(repoint.status, 400);
});

// ── 16: legacy / inconsistent group ids ────────────────────────────────────

test("legacy ObjectId group: adding a String-typed sibling no longer hides the legacy variants", async () => {
  const legacyGid = new mongoose.Types.ObjectId();
  const base = (name, price) => ({ ...variantDoc(vendorA, "x", name, price), packageGroupId: legacyGid, createdAt: new Date(), updatedAt: new Date() });
  const raw = await Package.collection.insertMany([base("Basic", 100), base("Premium", 300)]);
  const ids = Object.values(raw.insertedIds);

  const added = await call("POST", `/admin/packages/group/${legacyGid}/variants`, { variantType: "Standard", sourceVariantId: String(ids[0]) });
  assert.equal(added.status, 201, JSON.stringify(added.data));
  await Package.updateOne({ _id: added.data.data.packageId }, { $set: { packageStatus: "Live" } });
  const types = await Package.collection.find({ _id: { $in: [...ids, new mongoose.Types.ObjectId(added.data.data.packageId)] } }).toArray();
  assert.deepEqual(new Set(types.map((d) => typeof d.packageGroupId)), new Set(["object", "string"]), "group is now mixed-type");

  const group = await call("GET", `/customer/packages/group/${legacyGid}`);
  assert.equal(group.data.count, 3, "all three variants, both BSON types");
  assert.equal((await pdp(ids[1])).data.variants.length, 3);
  assert.equal((await call("GET", `/packages/group/${legacyGid}`)).data.count, 3, "vendor group endpoint too");

  const dupPackage = await call("POST", `/packages/${ids[0]}/duplicate`, {});
  assert.equal(dupPackage.status, 201, "duplicating a legacy group no longer crashes");
  assert.equal(dupPackage.data.count, 3);
});

test("a document with no packageGroupId is a package of one", async () => {
  const doc = await Decorator.create(variantDoc(vendorA, "tmp", "Only", 500));
  await Package.collection.updateOne({ _id: doc._id }, { $unset: { packageGroupId: "" } });
  const { status, data } = await pdp(doc._id);
  assert.equal(status, 200);
  assert.equal(data.packageGroupId, String(doc._id));
  assert.equal(data.variants.length, 1);
});

test("migration: dry run writes nothing; apply normalises ids and backfills bookings; re-run is a no-op", async () => {
  const run = (...flags) =>
    execFileSync(process.execPath, ["migrate_package_groups.mjs", "--db", DB, ...flags], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, DOTENV_CONFIG_QUIET: "true" },
      encoding: "utf8",
    });
  const legacyBefore = await Package.collection.countDocuments({ packageGroupId: { $type: "objectId" } });
  assert.ok(legacyBefore > 0);
  await Booking.collection.updateMany({}, { $unset: { packageGroupId: "" } });

  run();
  assert.equal(await Package.collection.countDocuments({ packageGroupId: { $type: "objectId" } }), legacyBefore, "dry run wrote nothing");

  const out = run("--apply", "--confirm-db", DB);
  assert.match(out, /APPLIED/);
  assert.equal(await Package.collection.countDocuments({ packageGroupId: { $type: "objectId" } }), 0);
  assert.equal(await Package.collection.countDocuments({ packageGroupId: { $in: [null, ""] } }), 0);
  assert.equal(await Booking.collection.countDocuments({ packageGroupId: { $in: [null] } }), 0);
  const total = await Package.collection.countDocuments();

  const again = run("--apply", "--confirm-db", DB);
  assert.match(again, /APPLIED: 0 group id\(s\) retyped, 0 group id\(s\) assigned, 0 booking\(s\) backfilled/);
  assert.equal(await Package.collection.countDocuments(), total, "no document deleted");
});

// ── regression: admin commercial "apply to group" ──────────────────────────

test("commercial applyToGroup only touches the package's own variants", async () => {
  const pkg = await makePackage(vendorA, ["Basic", "Premium"]);
  const bystander = await makePackage(vendorB, ["Solo"]);
  const res = await call("PUT", `/admin/commercial/packages/${pkg.docs[0]._id}`, { negotiationMode: "LIMITED", applyToGroup: true });
  assert.equal(res.status, 200, JSON.stringify(res.data).slice(0, 300));
  const sibling = await Package.findById(pkg.docs[1]._id).select("+commercial").lean();
  const other = await Package.findById(bystander.docs[0]._id).select("+commercial").lean();
  assert.equal(sibling.commercial.negotiationMode, "LIMITED");
  assert.notEqual(other.commercial?.negotiationMode, "LIMITED", "other vendors' packages untouched");
});

// ── review follow-ups ──────────────────────────────────────────────────────

test("admin-added variant starts with clean review state", async () => {
  const pkg = await makePackage(vendorA, ["Basic"]);
  await Package.updateOne({ _id: pkg.docs[0]._id }, { $set: { "submission.count": 3, reviewHistory: [{ event: "Approved", at: new Date() }] } });
  const res = await call("POST", `/admin/packages/group/${pkg.gid}/variants`, { variantType: "Plus" });
  assert.equal(res.status, 201);
  const added = await Package.findById(res.data.data.packageId).lean();
  assert.equal(added.submission?.count ?? 0, 0);
  assert.equal((added.reviewHistory || []).length, 0);
  assert.equal(added.deletedAt ?? null, null);
});

const runMigration = (...flags) =>
  execFileSync(process.execPath, ["migrate_package_groups.mjs", "--db", DB, ...flags], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, DOTENV_CONFIG_QUIET: "true" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

test("migration --apply refuses without --confirm-db naming the connected database", () => {
  assert.throws(() => runMigration("--apply"), /Refusing to write/);
  assert.throws(() => runMigration("--apply", "--confirm-db", "dev"), /Refusing to write/);
});

test("migration --merge-file: merges only a reviewed, same-vendor plan; bookings follow; ids unchanged", async () => {
  const fs = await import("fs");
  const os = await import("os");
  const keep = await makePackage(vendorA, ["Basic"], { packageName: "Split Pkg" });
  const split = await makePackage(vendorA, ["Premium"], { packageName: "Split Pkg" });
  const foreign = await makePackage(vendorB, ["Deluxe"], { packageName: "Split Pkg" });
  await Booking.collection.insertOne({ bookingId: "EVT_MERGE_TEST", packageId: String(split.docs[0]._id), packageGroupId: split.gid, vendorId: vendorA.id });
  const plan = `${os.tmpdir()}/merge-plan-${Date.now()}.json`;
  fs.writeFileSync(plan, JSON.stringify([
    { packageGroupId: keep.gid, packageIds: [String(split.docs[0]._id)] },
    { packageGroupId: keep.gid, packageIds: [String(foreign.docs[0]._id)] },
    { packageGroupId: keep.gid, packageIds: ["not-an-id"] },
  ]));

  const dry = runMigration("--merge-file", plan);
  assert.match(dry, /✓ .*move 1 variant/);
  assert.match(dry, /different vendors/);
  assert.match(dry, /not valid package ids/);
  assert.equal((await Package.findById(split.docs[0]._id).lean()).packageGroupId, split.gid, "dry run moved nothing");

  runMigration("--merge-file", plan, "--apply", "--confirm-db", DB);
  assert.equal((await Package.findById(split.docs[0]._id).lean()).packageGroupId, keep.gid);
  assert.equal((await Package.findById(foreign.docs[0]._id).lean()).packageGroupId, foreign.gid, "cross-vendor merge refused");
  assert.equal((await Booking.collection.findOne({ bookingId: "EVT_MERGE_TEST" })).packageGroupId, keep.gid);
  assert.equal((await pdp(keep.docs[0]._id)).data.variants.length, 2);
  fs.unlinkSync(plan);
});
