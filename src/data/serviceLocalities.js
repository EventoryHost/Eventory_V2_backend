/**
 * The 9 main NCR service areas a vendor picks a chip for in onboarding
 * ("What is your Service area?" — see Vendor.serviceAreas and
 * utils/serviceAreas.js), each with its own curated real localities.
 * Same data as the customer-facing frontend's
 * customer-become-vendor/data/serviceAreas.ts ("We are live in 200+
 * Localities") and the vendor listing page's "Service Localities" sidebar
 * filter — generated from the same source, ncr_service_areas_v2 (1).csv
 * (PM-supplied 2026-10-04). Kept as a hand-mirrored copy here rather than a
 * shared package: the dataset is small (9 entries) and stable.
 */
export const SERVICE_AREAS = [
  {
    area: "Gurgaon",
    localities: [
      "Old Gurgaon", "Sector 14", "Sector 29", "South City 1", "MG Road", "DLF Cyber City",
      "DLF Phase 1", "DLF Phase 2", "DLF Phase 3", "DLF Phase 4", "DLF Phase 5", "Sushant Lok",
      "Golf Course Road", "Golf Course Extension Road", "Sector 56", "Sector 57", "Sohna Road",
      "Nirvana Country", "Palam Vihar", "Udyog Vihar", "Manesar",
    ],
  },
  {
    area: "Faridabad",
    localities: [
      "NIT Faridabad", "Neelam Chowk", "Old Faridabad", "Sector 16", "Sector 17", "Sector 15",
      "Sector 28", "Sector 37", "Sector 46", "Surajkund", "Ballabgarh",
      "Greater Faridabad (Sectors 75-89)", "Sector 21", "Sainik Colony", "Sector 9", "Badkhal",
    ],
  },
  {
    area: "Ghaziabad",
    localities: [
      "Indirapuram", "Vaishali", "Kaushambi", "Vasundhara", "Brij Vihar", "Ramprastha",
      "Sahibabad", "Shalimar Garden", "Rajendra Nagar", "Mohan Nagar", "Raj Nagar", "Kavi Nagar",
      "Shastri Nagar", "Nehru Nagar", "Raj Nagar Extension", "Crossings Republik", "Govindpuram",
      "Vijay Nagar", "Pratap Vihar", "Loni", "Modinagar", "Muradnagar",
    ],
  },
  {
    area: "Noida",
    localities: [
      "Noida Sector 12", "Noida Sector 15", "Noida Sector 16 (Film City)", "Noida Sector 18",
      "Noida Sector 19", "Noida Sector 25", "Noida Sector 27", "Noida Sector 38A (GIP Mall)",
      "Noida Sector 44", "Noida Sector 50", "Noida Sector 51", "Noida Sector 62", "Noida Sector 63",
      "Noida Sector 76", "Noida Sector 78", "Noida Sector 93", "Noida Sector 104", "Noida Sector 128",
      "Noida Sector 135", "Noida Sector 137", "Noida Sector 150", "Noida Sector 168",
      "Noida Expressway (Sectors 93-168)", "Jaypee Wish Town",
    ],
  },
  {
    area: "Greater Noida",
    localities: [
      "Pari Chowk", "Knowledge Park", "Alpha 1 & 2", "Beta 1 & 2", "Gamma 1 & 2",
      "Jagat Farm (Gamma 1)", "Delta 1-3", "Omega 1-3", "Chi sectors", "Sigma sectors",
      "Zeta 1 & 2", "Techzone / Ecotech", "Kasna", "Surajpur", "Dadri",
      "Greater Noida West (Noida Extension)", "Gaur City", "Bisrakh", "Techzone 4",
      "Gaur Chowk (Ek Murti)",
    ],
  },
  {
    area: "Central Delhi",
    localities: [
      "Karol Bagh", "Dev Nagar", "Pusa Road", "Anand Parbat", "Rajinder Nagar", "Patel Nagar",
      "West Patel Nagar", "Baljeet Nagar", "Shadipur", "Paharganj", "Jhandewalan", "Inderpuri",
      "Naraina", "Naraina Vihar", "Kirti Nagar", "Moti Nagar", "Ramesh Nagar", "Rajouri Garden",
      "Punjabi Bagh",
    ],
  },
  {
    area: "South Delhi",
    localities: [
      "Hauz Khas", "Green Park", "Safdarjung Enclave", "Malviya Nagar", "Saket", "Panchsheel Park",
      "Sheikh Sarai", "Mehrauli", "Chhatarpur", "Vasant Kunj", "Mahipalpur", "Greater Kailash I",
      "Greater Kailash II", "Kailash Colony", "South Extension", "Defence Colony", "Lajpat Nagar",
      "Jangpura", "Nizamuddin", "Kalkaji", "Nehru Place", "Chittaranjan Park", "Alaknanda",
      "East of Kailash", "New Friends Colony", "Jasola", "Okhla Industrial Area", "Sarita Vihar",
      "Badarpur",
    ],
  },
  {
    area: "Old Delhi",
    localities: [
      "Chandni Chowk", "Jama Masjid", "Chawri Bazar", "Ballimaran", "Lal Kuan", "Khari Baoli",
      "Fatehpuri", "Nai Sarak", "Kinari Bazar", "Dariba Kalan", "Katra Neel", "Kucha Pati Ram",
      "Turkman Gate", "Daryaganj", "Delhi Gate", "Sadar Bazar", "Kashmere Gate", "Mori Gate",
      "Tis Hazari", "Civil Lines", "Kamla Nagar", "Shakti Nagar",
    ],
  },
  {
    area: "New Delhi",
    localities: [
      "Connaught Place", "Janpath", "Barakhamba Road", "Gole Market", "Mandir Marg", "Chanakyapuri",
      "Moti Bagh", "Lodhi Colony", "Lodhi Road", "Khan Market", "Golf Links", "Jor Bagh",
      "Sunder Nagar", "Sarojini Nagar", "Kidwai Nagar", "Netaji Nagar", "R K Puram", "Vasant Vihar",
      "Munirka", "Delhi Cantonment",
    ],
  },
];

const norm = (s) => String(s || "").trim().toLowerCase();

const AREA_NAMES = new Set(SERVICE_AREAS.map((entry) => norm(entry.area)));

/** True when `name` is one of the 9 curated main area names (case-insensitive). */
export function isKnownServiceArea(name) {
  return AREA_NAMES.has(norm(name));
}

/** The curated area entry (area + localities) for a given area name, or null. */
export function findServiceArea(name) {
  return SERVICE_AREAS.find((entry) => norm(entry.area) === norm(name)) ?? null;
}
