import {
  findPackagesDueForPurge,
  packageRetentionWindowMs,
  purgeDeletedPackage,
} from "../utils/packageDeletion.js";
import { runHourIst, scheduleDaily } from "./scheduleDaily.js";

const DEFAULT_RUN_HOUR_IST = 4;

let running = false;

export async function runPackagePurge() {
  if (running) return { skipped: true };
  running = true;
  const summary = { due: 0, archived: 0, removed: 0, failed: 0 };
  try {
    const cutoff = new Date(Date.now() - packageRetentionWindowMs());

    for await (const pkg of findPackagesDueForPurge(cutoff)) {
      summary.due += 1;
      try {
        const outcome = await purgeDeletedPackage(pkg, cutoff);
        if (outcome === "archived") summary.archived += 1;
        if (outcome === "removed") summary.removed += 1;
      } catch (error) {
        summary.failed += 1;
        console.error(`[package-purge] failed for package ${pkg._id}:`, error.message);
      }
    }

    if (summary.due > 0) {
      console.log(
        `[package-purge] due=${summary.due} archived=${summary.archived} removed=${summary.removed} failed=${summary.failed}`
      );
    }
    return summary;
  } catch (error) {
    console.error("[package-purge] run failed:", error.message);
    return { ...summary, error: error.message };
  } finally {
    running = false;
  }
}

export function startPackagePurgeWorker() {
  if (process.env.PACKAGE_PURGE_WORKER === "off") {
    console.log("[package-purge] worker disabled via PACKAGE_PURGE_WORKER=off");
    return;
  }
  scheduleDaily(
    runPackagePurge,
    runHourIst(process.env.PACKAGE_PURGE_HOUR_IST, DEFAULT_RUN_HOUR_IST)
  );
}
