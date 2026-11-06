/**
 * Monthly Commercial Engine demand review (PRD §5.6): recomputes every
 * vendor's demand tier from Pre-Eventory data + behaviour counters + ratings
 * and logs each change to VendorCategoryHistory. Schedule monthly (cron /
 * GitHub Action); same as POST /api/admin/commercial/vendors/refresh-all.
 *
 *   node refreshVendorTiers.mjs
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "./src/config/db.js";
import { refreshAllVendorTiers } from "./src/services/commercial/commercialService.js";

const run = async () => {
  try {
    await connectDB();
    const summary = await refreshAllVendorTiers({ by: "refreshVendorTiers.mjs" });
    console.log(`✅ ${summary.total} vendors reviewed, ${summary.changed.length} tier changes, ${summary.failed.length} failures`);
    for (const c of summary.changed) console.log(`   ${c.vendorId}: ${c.from ?? "—"} -> ${c.to}`);
    for (const f of summary.failed) console.log(`   ✗ ${f.vendorId}: ${f.error}`);
  } catch (error) {
    console.error("❌ Tier refresh failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
