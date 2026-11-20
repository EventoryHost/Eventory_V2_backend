import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import Customer from "../../src/models/Customer.js";
import { consentView, setWhatsAppConsent, syncConsentFromPreferences } from "../../src/services/whatsappConsentService.js";

// Stub the model lookup: a plain object with the bits of a document the
// service uses (set/save), so no database is needed.
const realFindOne = Customer.findOne;
let doc;
const makeDoc = (fields) => ({
  id: "CUS1",
  phone: "+919876543210",
  isPhoneVerified: true,
  preferences: { notification: { whatsapp: false } },
  whatsappConsent: { status: null, optedInAt: null, optedOutAt: null, source: null, phone: null },
  saved: 0,
  ...fields,
  set(path, value) {
    assert.equal(path, "preferences.notification.whatsapp");
    this.preferences.notification.whatsapp = value;
  },
  async save() {
    this.saved++;
  },
});

beforeEach(() => {
  doc = makeDoc();
  Customer.findOne = async () => doc;
});
after(() => {
  Customer.findOne = realFindOne;
});

test("opt-in records timestamp, source, number and mirrors the toggle", async () => {
  const { customer, changedToOptIn } = await setWhatsAppConsent("CUS1", true, "checkout");
  assert.equal(changedToOptIn, true);
  assert.equal(customer.whatsappConsent.status, "opted_in");
  assert.ok(customer.whatsappConsent.optedInAt instanceof Date);
  assert.equal(customer.whatsappConsent.source, "checkout");
  assert.equal(customer.whatsappConsent.phone, "+919876543210");
  assert.equal(customer.preferences.notification.whatsapp, true);
  assert.equal(consentView(customer).optedIn, true);
});

test("opting in again keeps the original consent and sends no second welcome", async () => {
  const first = await setWhatsAppConsent("CUS1", true, "checkout");
  const optedInAt = first.customer.whatsappConsent.optedInAt;
  const again = await setWhatsAppConsent("CUS1", true, "settings");
  assert.equal(again.changedToOptIn, false);
  assert.equal(again.customer.whatsappConsent.optedInAt, optedInAt);
  assert.equal(again.customer.whatsappConsent.source, "checkout");
});

test("opt-out is recorded and respected", async () => {
  await setWhatsAppConsent("CUS1", true, "checkout");
  const { customer, changedToOptIn } = await setWhatsAppConsent("CUS1", false, "settings");
  assert.equal(changedToOptIn, false);
  assert.equal(customer.whatsappConsent.status, "opted_out");
  assert.ok(customer.whatsappConsent.optedOutAt instanceof Date);
  assert.equal(customer.preferences.notification.whatsapp, false);
  assert.equal(consentView(customer).optedIn, false);
});

test("a new phone number needs fresh consent", async () => {
  await setWhatsAppConsent("CUS1", true, "checkout");
  doc.phone = "+919123456789";
  const { customer, changedToOptIn } = await setWhatsAppConsent("CUS1", true, "profile");
  assert.equal(changedToOptIn, true);
  assert.equal(customer.whatsappConsent.phone, "+919123456789");
  assert.equal(customer.whatsappConsent.source, "profile");
});

test("profile toggle syncs consent only when it was explicitly sent", async () => {
  assert.equal((await syncConsentFromPreferences(doc, { isDarkMode: true })).changedToOptIn, false);
  assert.equal(doc.saved, 0, "an unrelated preferences change records nothing");
  const turnedOn = await syncConsentFromPreferences(doc, { notification: { whatsapp: true } });
  assert.equal(turnedOn.changedToOptIn, true);
  assert.equal(doc.whatsappConsent.source, "profile");
  const turnedOff = await syncConsentFromPreferences(doc, { notification: { whatsapp: false } });
  assert.equal(turnedOff.customer.whatsappConsent.status, "opted_out");
});

test("a consent write failure doesn't fail the profile update", async () => {
  Customer.findOne = async () => {
    throw new Error("db down");
  };
  const result = await syncConsentFromPreferences(doc, { notification: { whatsapp: true } });
  assert.equal(result.changedToOptIn, false);
  assert.equal(result.customer, doc);
});
