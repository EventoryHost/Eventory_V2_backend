import mongoose from "mongoose";
import { refreshAllVendorTiers } from "./commercialService.js";

/**
 * Monthly vendor demand review (PRD §5.6), in-process.
 *
 * Checks hourly; the first check in a new IST calendar month runs
 * refreshAllVendorTiers once. A unique run document per month
 * (commercial_job_runs, _id "tier-refresh-YYYY-MM") is the lock, so
 * several server instances never run it twice. Opt-in: set
 * COMMERCIAL_TIER_SCHEDULER=on (leave unset when an external cron runs
 * refreshVendorTiers.mjs instead, or before the first manual run).
 */

const CHECK_EVERY_MS = 60 * 60 * 1000;
const FIRST_CHECK_MS = 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const monthKey = (d = new Date()) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 7);

async function runIfDue() {
  const runs = mongoose.connection.collection("commercial_job_runs");
  const _id = `tier-refresh-${monthKey()}`;
  try {
    await runs.insertOne({ _id, startedAt: new Date(), status: "RUNNING" });
  } catch (err) {
    if (err.code === 11000) return; // this month already ran (or is running)
    throw err;
  }
  try {
    const summary = await refreshAllVendorTiers({ by: "tierScheduler" });
    await runs.updateOne(
      { _id },
      {
        $set: {
          status: "DONE",
          finishedAt: new Date(),
          total: summary.total,
          changed: summary.changed,
          failed: summary.failed,
        },
      }
    );
    console.log(`[tierScheduler] ${_id}: ${summary.total} vendors, ${summary.changed.length} tier changes`);
  } catch (err) {
    await runs.updateOne({ _id }, { $set: { status: "FAILED", finishedAt: new Date(), error: err.message } });
    console.error(`[tierScheduler] ${_id} failed:`, err.message);
  }
}

export function startTierScheduler() {
  if (String(process.env.COMMERCIAL_TIER_SCHEDULER || "").toLowerCase() !== "on") return;
  const tick = () => runIfDue().catch((err) => console.error("[tierScheduler]", err.message));
  setTimeout(tick, FIRST_CHECK_MS).unref();
  setInterval(tick, CHECK_EVERY_MS).unref();
}
