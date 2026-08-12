/**
 * Booking Seed — creates one booking per testable app state
 *
 * Scenarios:
 *  1.  FREE_PENDING    – FreeBooking  + Pending   → Accept / Decline buttons
 *  2.  FREE_ACCEPTED   – FreeBooking  + Accepted  → Customise / Chat buttons + no Payment Timeline
 *  3.  FREE_DECLINED   – FreeBooking  + Declined
 *  4.  FREE_CANCELLED  – FreeBooking  + Cancelled
 *  5.  ADV_PENDING     – AdvancePaid  + Pending   → Contact Client button
 *  6.  ADV_ACCEPTED    – AdvancePaid  + Accepted  → Payment Timeline (Token received, Final pending)
 *  7.  FULL_ACCEPTED   – FullPaid     + Accepted  → All milestones Received
 *  8.  FULL_CANCELLED  – FullPaid     + Cancelled
 *  9.  COMPLETED       – FreeBooking  + Completed
 *  10. CONFLICT_PENDING – FreeBooking + Pending with same date as FREE_PENDING (triggers conflict flag)
 *
 * Run: node --env-file=.env seed_bookings.mjs
 */

import mongoose from "mongoose";
import Booking from "./src/models/Booking.js";

// ─── Seed Config ────────────────────────────────────────────────────────────

const VENDOR_OID = new mongoose.Types.ObjectId("6a4637c98f6f2df657127147");

const PKG = {
  djArtist: {
    id: new mongoose.Types.ObjectId("6a107211de8428d0439e2adc"),
    name: "New Package",
    price: 555,
    image:
      "https://d1u34m45xfa3ar.cloudfront.net/DJArtist/images/1780158888008-abby-savage-zNsSwsuyP3A-unsplash.jpg",
    vendorType: "DJArtist",
    variantType: "Premium",
  },
  makeup: {
    id: new mongoose.Types.ObjectId("6a15a9634b2c80cc7be50a42"),
    name: "Bridal Glow Package",
    price: 588,
    image:
      "https://d1u34m45xfa3ar.cloudfront.net/MakeupArtist/images/1780338762165-jesus-boscan-Q7j9MuUzFrM-unsplash.jpg",
    vendorType: "MakeupArtist",
    variantType: "Premium",
  },
  caterer: {
    id: new mongoose.Types.ObjectId("6a15ce269dcba14e3eeaad39"),
    name: "Royal Feast Package",
    price: 28000,
    image:
      "https://d1u34m45xfa3ar.cloudfront.net/Caterer/images/1779957180091-pexels-anastasia-ilina-makarova-140436704-11566303.jpg",
    vendorType: "Caterer",
    variantType: "Standard",
  },
  decorator: {
    id: new mongoose.Types.ObjectId(),
    name: "Floral Extravaganza",
    price: 45000,
    image: "https://loremflickr.com/200/200/flowers",
    vendorType: "Decorator",
    variantType: "Premium",
  },
  pav: {
    id: new mongoose.Types.ObjectId(),
    name: "Corporate AV Setup",
    price: 75000,
    image: "https://loremflickr.com/200/200/av",
    vendorType: "PAV",
    variantType: "Standard",
  },
  venue: {
    id: new mongoose.Types.ObjectId(),
    name: "Grand Ballroom",
    price: 150000,
    image: "https://loremflickr.com/200/200/venue",
    vendorType: "VenueProvider",
    variantType: "Luxury",
  }
};

const snap = (pkg) => ({
  name: pkg.name,
  price: pkg.price,
  image: pkg.image,
  vendorType: pkg.vendorType,
  variantType: pkg.variantType,
});

// Generate a stable-looking but unique bookingId for seeds
let seq = 1;
const genId = () => {
  const ts = `EVT2026SEED${String(seq++).padStart(3, "0")}`;
  return ts;
};

const BOOKINGS = [
  // ── 1. FREE_PENDING ─────────────────────────────────────────────────────
  {
    bookingId: genId(),
    vendorId: VENDOR_OID,
    packageId: PKG.djArtist.id,
    customer: { name: "Priya Sharma", phone: "9876543210", email: "priya@example.com" },
    eventType: "Corporate Party",
    eventDate: new Date("2026-10-15"),
    guestRange: { min: 50, max: 100 },
    location: "Grand Hyatt Ballroom, New Delhi",
    mapLink: "https://maps.google.com/?q=Grand+Hyatt+New+Delhi",
    startTime: "10:00",
    endTime: "14:00",
    packageSnapshot: snap(PKG.djArtist),
    paymentType: "FreeBooking",
    status: "Pending",
    paymentMilestones: [],
    charges: [],
    totalAmount: 0,
    totalReceived: 0,
    notes: "Client prefers Bollywood + EDM mix.",
    calendarNote: null,
  },

  // ── 2. FREE_ACCEPTED ────────────────────────────────────────────────────
  {
    bookingId: genId(),
    vendorId: VENDOR_OID,
    packageId: PKG.makeup.id,
    customer: { name: "Rahul Mehta", phone: "9123456780", email: "rahul@example.com" },
    eventType: "Wedding Ceremony",
    eventDate: new Date("2026-11-05"),
    guestRange: { min: 200, max: 300 },
    location: "The Lalit Hotel, Connaught Place",
    mapLink: "https://maps.google.com/?q=The+Lalit+Delhi",
    startTime: "08:00",
    endTime: "13:00",
    packageSnapshot: snap(PKG.makeup),
    paymentType: "FreeBooking",
    status: "Accepted",
    paymentMilestones: [],
    charges: [],
    totalAmount: 0,
    totalReceived: 0,
    notes: null,
    calendarNote: "Confirm trial session date with bride one week prior.",
  },

  // ── 3. FREE_DECLINED ────────────────────────────────────────────────────
  {
    bookingId: genId(),
    vendorId: VENDOR_OID,
    packageId: PKG.decorator.id,
    customer: { name: "Anjali Singh", phone: "9988776655", email: "anjali@example.com" },
    eventType: "Birthday Party",
    eventDate: new Date("2026-09-20"),
    guestRange: { min: 30, max: 50 },
    location: "Home Venue, Indirapuram",
    mapLink: null,
    startTime: "18:00",
    endTime: "22:00",
    packageSnapshot: snap(PKG.decorator),
    paymentType: "FreeBooking",
    status: "Declined",
    paymentMilestones: [],
    charges: [],
    totalAmount: 0,
    totalReceived: 0,
    notes: "Date conflict with another event.",
    calendarNote: null,
  },

  // ── 4. FREE_CANCELLED ───────────────────────────────────────────────────
  {
    bookingId: genId(),
    vendorId: VENDOR_OID,
    packageId: PKG.pav.id,
    customer: { name: "Kavita Reddy", phone: "9001122334", email: "kavita@example.com" },
    eventType: "Engagement Party",
    eventDate: new Date("2026-08-30"),
    guestRange: { min: 80, max: 120 },
    location: "ITC Maurya, Dwarka",
    mapLink: "https://maps.google.com/?q=ITC+Maurya+Delhi",
    startTime: "16:00",
    endTime: "21:00",
    packageSnapshot: snap(PKG.pav),
    paymentType: "FreeBooking",
    status: "Cancelled",
    paymentMilestones: [],
    charges: [],
    totalAmount: 0,
    totalReceived: 0,
    notes: "Customer cancelled due to venue change.",
    calendarNote: null,
  },

  // ── 5. ADV_PENDING ──────────────────────────────────────────────────────
  //    paymentType=AdvancePaid + status=Pending → shows "Contact Client" button
  {
    bookingId: genId(),
    vendorId: VENDOR_OID,
    packageId: PKG.caterer.id,
    customer: { name: "Vikram Kapoor", phone: "9812345670", email: "vikram@example.com" },
    eventType: "Anniversary Dinner",
    eventDate: new Date("2026-12-10"),
    guestRange: { min: 150, max: 200 },
    location: "Taj Palace Hotel, Golf Course Road",
    mapLink: "https://maps.google.com/?q=Taj+Palace+Delhi",
    startTime: "19:00",
    endTime: "23:00",
    packageSnapshot: snap(PKG.caterer),
    paymentType: "AdvancePaid",
    status: "Pending",
    paymentMilestones: [
      {
        type: "Token",
        amount: 5000,
        dueDate: new Date("2026-10-15"),
        status: "Received",
        receivedDate: new Date("2026-10-14"),
      },
      {
        type: "FinalClearance",
        amount: 23000,
        dueDate: new Date("2026-12-08"),
        status: "Pending",
        receivedDate: null,
      },
    ],
    charges: [
      { label: "₹140 × 200 guests", amount: 28000, type: "Base" },
    ],
    totalAmount: 28000,
    totalReceived: 5000,
    notes: "Vegetarian-only menu. No onion/garlic.",
    calendarNote: null,
  },

  // ── 6. ADV_ACCEPTED ─────────────────────────────────────────────────────
  //    paymentType=AdvancePaid + status=Accepted → Payment Timeline section visible
  {
    bookingId: genId(),
    vendorId: VENDOR_OID,
    packageId: PKG.makeup.id,
    customer: { name: "Meera Nair", phone: "9444556677", email: "meera@example.com" },
    eventType: "Baby Shower",
    eventDate: new Date("2026-11-20"),
    guestRange: { min: 40, max: 60 },
    location: "Lajpat Nagar Community Hall",
    mapLink: "https://maps.google.com/?q=Lajpat+Nagar+Community+Hall",
    startTime: "11:00",
    endTime: "15:00",
    packageSnapshot: snap(PKG.makeup),
    paymentType: "AdvancePaid",
    status: "Accepted",
    paymentMilestones: [
      {
        type: "Token",
        amount: 200,
        dueDate: new Date("2026-10-01"),
        status: "Received",
        receivedDate: new Date("2026-09-30"),
      },
      {
        type: "FinalClearance",
        amount: 388,
        dueDate: new Date("2026-11-18"),
        status: "PaymentDue",
        receivedDate: null,
      },
    ],
    charges: [
      { label: "Base Package", amount: 588, type: "Base" },
    ],
    totalAmount: 588,
    totalReceived: 200,
    notes: "Pastel pink theme preferred.",
    calendarNote: "Carry extra pastel shades for theme.",
  },

  // ── 7. FULL_ACCEPTED ────────────────────────────────────────────────────
  //    paymentType=FullPaid + status=Accepted → all milestones Received
  {
    bookingId: genId(),
    vendorId: VENDOR_OID,
    packageId: PKG.djArtist.id,
    customer: { name: "Arjun Sharma", phone: "9711223344", email: "arjun@example.com" },
    eventType: "Corporate Event",
    eventDate: new Date("2026-10-25"),
    guestRange: { min: 100, max: 150 },
    location: "Aerocity Convention Centre",
    mapLink: "https://maps.google.com/?q=Aerocity+Convention+Centre+Delhi",
    startTime: "18:00",
    endTime: "23:00",
    packageSnapshot: snap(PKG.djArtist),
    paymentType: "FullPaid",
    status: "Accepted",
    paymentMilestones: [
      {
        type: "Token",
        amount: 100,
        dueDate: new Date("2026-09-01"),
        status: "Received",
        receivedDate: new Date("2026-09-01"),
      },
      {
        type: "Advanced1",
        amount: 200,
        dueDate: new Date("2026-09-25"),
        status: "Received",
        receivedDate: new Date("2026-09-24"),
      },
      {
        type: "Advanced2",
        amount: 155,
        dueDate: new Date("2026-10-10"),
        status: "Received",
        receivedDate: new Date("2026-10-10"),
      },
      {
        type: "FinalClearance",
        amount: 100,
        dueDate: new Date("2026-10-23"),
        status: "Received",
        receivedDate: new Date("2026-10-23"),
      },
    ],
    charges: [
      { label: "DJ Package", amount: 555, type: "Base" },
    ],
    totalAmount: 555,
    totalReceived: 555,
    notes: "Tech/House music set. AV equipment provided by venue.",
    calendarNote: "Pack lighting rig — venue doesn't supply it.",
  },

  // ── 8. FULL_CANCELLED ───────────────────────────────────────────────────
  {
    bookingId: genId(),
    vendorId: VENDOR_OID,
    packageId: PKG.venue.id,
    customer: { name: "Sunita Verma", phone: "9555666777", email: "sunita@example.com" },
    eventType: "Farewell Party",
    eventDate: new Date("2026-09-12"),
    guestRange: { min: 200, max: 250 },
    location: "DLF Phase 1 Banquet Hall",
    mapLink: null,
    startTime: "13:00",
    endTime: "17:00",
    packageSnapshot: snap(PKG.venue),
    paymentType: "FullPaid",
    status: "Cancelled",
    paymentMilestones: [
      {
        type: "Token",
        amount: 5000,
        dueDate: new Date("2026-08-01"),
        status: "Received",
        receivedDate: new Date("2026-07-30"),
      },
      {
        type: "FinalClearance",
        amount: 145000,
        dueDate: new Date("2026-09-10"),
        status: "Pending",
        receivedDate: null,
      },
    ],
    charges: [
      { label: "Grand Ballroom Rental", amount: 150000, type: "Base" },
    ],
    totalAmount: 150000,
    totalReceived: 5000,
    notes: "Cancellation — venue double-booked.",
    calendarNote: null,
  },

  // ── 9. COMPLETED ────────────────────────────────────────────────────────
  {
    bookingId: genId(),
    vendorId: VENDOR_OID,
    packageId: PKG.makeup.id,
    customer: { name: "Dev Malhotra", phone: "9222333444", email: "dev@example.com" },
    eventType: "Graduation Party",
    eventDate: new Date("2026-05-15"),
    guestRange: { min: 20, max: 40 },
    location: "Vasundhara Club",
    mapLink: null,
    startTime: "17:00",
    endTime: "20:00",
    packageSnapshot: snap(PKG.makeup),
    paymentType: "FreeBooking",
    status: "Completed",
    paymentMilestones: [],
    charges: [],
    totalAmount: 0,
    totalReceived: 0,
    notes: null,
    calendarNote: "Event went great — ask for review.",
  },

  // ── 10. CONFLICT_PENDING ─────────────────────────────────────────────────
  //    Same date as FREE_PENDING (Oct 15 2026) → conflictDetected=true in API response
  {
    bookingId: genId(),
    vendorId: VENDOR_OID,
    packageId: PKG.caterer.id,
    customer: { name: "Ritu Agarwal", phone: "9333444555", email: "ritu@example.com" },
    eventType: "Wedding Reception",
    eventDate: new Date("2026-10-15"),
    guestRange: { min: 300, max: 400 },
    location: "Hauz Khas Village Lawn",
    mapLink: "https://maps.google.com/?q=Hauz+Khas+Village",
    startTime: "19:00",
    endTime: "23:00",
    packageSnapshot: snap(PKG.caterer),
    paymentType: "FreeBooking",
    status: "Pending",
    paymentMilestones: [],
    charges: [],
    totalAmount: 0,
    totalReceived: 0,
    notes: "Same-day conflict with booking 1 — tests conflict banner.",
    calendarNote: null,
  },
];

// ─── Run ─────────────────────────────────────────────────────────────────────

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected to MongoDB");

  // Clean up old seeds so we can re-run safely
  const result = await Booking.deleteMany({
    bookingId: { $regex: /^EVT2026SEED/ },
  });
  if (result.deletedCount > 0) {
    console.log(`🗑  Removed ${result.deletedCount} previous seed bookings`);
  }

  const inserted = await Booking.insertMany(BOOKINGS);
  console.log(`✅ Inserted ${inserted.length} seed bookings:\n`);
  inserted.forEach((b) =>
    console.log(`   ${b.bookingId}  ${b.paymentType.padEnd(12)}  ${b.status.padEnd(10)}  ${b.customer.name}`)
  );

  await mongoose.disconnect();
  console.log("\n✅ Done");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
