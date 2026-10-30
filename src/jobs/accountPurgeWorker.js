import Vendor from "../models/Vendor.js";
import {
  findVendorsDueForPurge,
  purgeVendor,
  retentionWindowMs,
} from "../utils/accountDeletion.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DEFAULT_RUN_HOUR_IST = 3;

const runHourIst = () => {
  const hour = Number(process.env.ACCOUNT_PURGE_HOUR_IST);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23
    ? hour
    : DEFAULT_RUN_HOUR_IST;
};

const msUntilNextRun = (now = Date.now()) => {
  const istNow = now + IST_OFFSET_MS;
  const todayRun = istNow - (istNow % DAY_MS) + runHourIst() * 60 * 60 * 1000;
  const next = todayRun > istNow ? todayRun : todayRun + DAY_MS;
  return next - istNow;
};

let running = false;

export async function runAccountPurge() {
  if (running) return { skipped: true };
  running = true;
  const summary = { due: 0, purged: 0, failed: 0 };
  try {
    const due = await findVendorsDueForPurge();
    summary.due = due.length;

    for (const { id } of due) {
      try {
        const cutoff = new Date(Date.now() - retentionWindowMs());
        const stillDue = await Vendor.exists({
          id,
          deletionRequestedAt: { $ne: null, $lte: cutoff },
        });
        if (!stillDue) continue;

        const result = await purgeVendor(id);
        if (result.purged) summary.purged += 1;
      } catch (error) {
        summary.failed += 1;
        console.error(`[account-purge] failed for vendor ${id}:`, error.message);
      }
    }

    if (summary.due > 0) {
      console.log(
        `[account-purge] due=${summary.due} purged=${summary.purged} failed=${summary.failed}`
      );
    }
    return summary;
  } catch (error) {
    console.error("[account-purge] run failed:", error.message);
    return { ...summary, error: error.message };
  } finally {
    running = false;
  }
}

export function startAccountPurgeWorker() {
  if (process.env.ACCOUNT_PURGE_WORKER === "off") {
    console.log("[account-purge] worker disabled via ACCOUNT_PURGE_WORKER=off");
    return;
  }

  const scheduleNext = () => {
    const timer = setTimeout(async () => {
      await runAccountPurge();
      scheduleNext();
    }, msUntilNextRun());
    timer.unref();
  };

  runAccountPurge();
  scheduleNext();
}
