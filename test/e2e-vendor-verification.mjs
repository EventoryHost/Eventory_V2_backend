import "dotenv/config";
import axios from "axios";
import mongoose from "mongoose";
import { runVendorVerificationCases } from "./vendorVerificationCases.mjs";

/**
 * Just the vendor step-verification cases, for a server whose database has
 * none of the fixtures e2e-full-suite.mjs expects (e.g. a local mongod).
 *
 *   node --env-file=.env server.js            # in one shell
 *   node --env-file=.env test/e2e-vendor-verification.mjs
 *
 * Creates two throwaway vendors and deletes them afterwards (needs MONGO_URI
 * for the cleanup). Exits non-zero if any case fails.
 */

const BASE = `http://localhost:${process.env.PORT || 4000}/api`;
let currentSection = "General";
const results = [];

const section = (name) => {
  currentSection = name;
};

async function call({ method, path, body, headers = {}, description, expect }) {
  let status = null;
  let data = null;
  let error = null;
  try {
    const res = await axios({ method, url: `${BASE}${path}`, data: body, headers, validateStatus: () => true });
    status = res.status;
    data = res.data;
  } catch (err) {
    error = err.message;
  }
  const pass = error ? false : Boolean(expect(status, data));
  results.push({ section: currentSection, description, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${method.toUpperCase()} ${path} -> ${status} :: ${description}`);
  if (!pass) console.log("   ", error || JSON.stringify(data)?.slice(0, 600));
  return { status, data };
}

const suffix = Date.now();
let ids = [];
try {
  ids = await runVendorVerificationCases({ call, section, suffix });
} finally {
  if (process.env.MONGO_URI && ids.length) {
    await mongoose.connect(process.env.MONGO_URI);
    await mongoose.connection.db.collection("vendors").deleteMany({ id: { $in: ids } });
    await mongoose.disconnect();
  }
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== SUMMARY: ${results.length - failed}/${results.length} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
